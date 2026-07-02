from __future__ import annotations

import asyncio
import itertools
import re
import resource
from dataclasses import dataclass

import aiohttp

from scrapers.stores import LLM, LLMRequest, LLMResponse, LLMResponsePool


def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


@dataclass(frozen=True)
class OpenAICompatibleConfig:
    model: str = "Qwen/Qwen3-14B"
    ports: tuple[int, ...] = tuple(range(6000, 6016))
    per_port_concurrency: int = 4
    request_timeout_seconds: int = 90
    retries: int = 3
    enable_thinking: bool = False


@dataclass(frozen=True)
class _QueuedRequest:
    request_id: int
    request: LLMRequest


class OpenAICompatibleMultiPortLLM(LLM):
    def __init__(self, config: OpenAICompatibleConfig | None = None) -> None:
        self.config = config or OpenAICompatibleConfig()
        if not self.config.ports:
            raise ValueError("At least one LLM port must be configured")
        self._port_cycle = itertools.cycle(self.config.ports)
        self._semaphores = {
            port: asyncio.Semaphore(self.config.per_port_concurrency)
            for port in self.config.ports
        }
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.request_count = 0

    async def check_health(self) -> None:
        async with aiohttp.ClientSession() as session:
            results = await asyncio.gather(
                *(self._check_port(session, port) for port in self.config.ports)
            )
        bad = [f"{port}: {detail}" for port, ok, detail in results if not ok]
        if bad:
            raise RuntimeError(
                "one or more LLM servers are unhealthy: " + "; ".join(bad)
            )

    async def _check_port(
        self,
        session: aiohttp.ClientSession,
        port: int,
    ) -> tuple[int, bool, str]:
        try:
            async with session.get(
                f"http://localhost:{port}/v1/models",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return port, False, f"HTTP {resp.status}"
                return port, True, ""
        except Exception as exc:
            return port, False, str(exc)

    async def chat(
        self,
        prompt: str,
        *,
        max_tokens: int,
        temperature: float = 0,
        model: str | None = None,
    ) -> str:
        response = await self.map_chat(
            [
                LLMRequest(
                    prompt=prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    model=model,
                )
            ]
        )
        return response[0].content

    async def map_chat(self, requests: list[LLMRequest]) -> list[LLMResponse]:
        results: list[LLMResponse | None] = [None] * len(requests)
        indexes_by_id: dict[int, int] = {}

        async with self.response_pool() as pool:
            for index, request in enumerate(requests):
                while pool.is_full():
                    request_id, response = await pool.get_response()
                    result_index = indexes_by_id.pop(request_id)
                    if isinstance(response, Exception):
                        raise response
                    results[result_index] = response

                request_id = await pool.put_request(request)
                indexes_by_id[request_id] = index

            while indexes_by_id:
                request_id, response = await pool.get_response()
                result_index = indexes_by_id.pop(request_id)
                if isinstance(response, Exception):
                    raise response
                results[result_index] = response
        return [result for result in results if result is not None]

    def response_pool(self) -> LLMResponsePool:
        return OpenAICompatibleResponsePool(self)

    async def _complete_with_retry(
        self,
        session: aiohttp.ClientSession,
        request: LLMRequest,
    ) -> LLMResponse:
        last_exc: Exception | None = None
        for attempt in range(1, self.config.retries + 1):
            port = next(self._port_cycle)
            try:
                return await self._complete_once(session, port, request)
            except Exception as exc:
                last_exc = exc
                if attempt < self.config.retries:
                    await asyncio.sleep(0.5 * attempt)
        assert last_exc is not None
        raise last_exc

    async def _complete_once(
        self,
        session: aiohttp.ClientSession,
        port: int,
        request: LLMRequest,
    ) -> LLMResponse:
        model = request.model or self.config.model
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": request.prompt}],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "chat_template_kwargs": {
                "enable_thinking": self.config.enable_thinking,
            },
        }
        async with self._semaphores[port]:
            async with session.post(
                f"http://localhost:{port}/v1/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(
                    total=self.config.request_timeout_seconds
                ),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
        content = strip_thinking(data["choices"][0]["message"]["content"])
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or 0)
        self.prompt_tokens += prompt_tokens
        self.completion_tokens += completion_tokens
        self.total_tokens += total_tokens
        self.request_count += 1
        return LLMResponse(
            content=content,
            port=port,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )


class OpenAICompatibleResponsePool(LLMResponsePool):
    def __init__(self, llm: OpenAICompatibleMultiPortLLM) -> None:
        self._llm = llm
        self._capacity_size = (
            len(llm.config.ports) * llm.config.per_port_concurrency
        )
        self._capacity = asyncio.Semaphore(self._capacity_size)
        self._request_queue: asyncio.Queue[_QueuedRequest | None] = asyncio.Queue(
            maxsize=self._capacity_size
        )
        self._response_queue: asyncio.Queue[
            tuple[int, LLMResponse | Exception]
        ] = asyncio.Queue()
        self._next_request_id = 0
        self._session: aiohttp.ClientSession | None = None
        self._workers: list[asyncio.Task[None]] = []

    async def __aenter__(self) -> "OpenAICompatibleResponsePool":
        self._check_file_descriptor_limit()
        connector = aiohttp.TCPConnector(limit=self._capacity_size)
        self._session = aiohttp.ClientSession(connector=connector)
        self._workers = [
            asyncio.create_task(self._worker())
            for _ in range(self._capacity_size)
        ]
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        if exc_type is None:
            for _ in self._workers:
                await self._request_queue.put(None)
            await asyncio.gather(*self._workers)
        else:
            for worker in self._workers:
                worker.cancel()
            await asyncio.gather(*self._workers, return_exceptions=True)

        if self._session is not None:
            await self._session.close()
            self._session = None

    def is_full(self) -> bool:
        return self._capacity.locked()

    async def put_request(self, request: LLMRequest) -> int:
        if self._session is None:
            raise RuntimeError("LLM response pool is not started")
        await self._capacity.acquire()
        request_id = self._next_request_id
        self._next_request_id += 1
        try:
            await self._request_queue.put(_QueuedRequest(request_id, request))
        except Exception:
            self._capacity.release()
            raise
        return request_id

    async def get_response(self) -> tuple[int, LLMResponse | Exception]:
        response = await self._response_queue.get()
        self._capacity.release()
        return response

    async def _worker(self) -> None:
        assert self._session is not None
        while True:
            queued = await self._request_queue.get()
            if queued is None:
                return
            try:
                response: LLMResponse | Exception = (
                    await self._llm._complete_with_retry(
                        self._session,
                        queued.request,
                    )
                )
            except Exception as exc:
                response = exc
            await self._response_queue.put((queued.request_id, response))

    def _check_file_descriptor_limit(self) -> None:
        soft_limit, _hard_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
        if soft_limit == resource.RLIM_INFINITY:
            return

        fd_reserve = 64
        if self._capacity_size + fd_reserve < soft_limit:
            return

        ports = len(self._llm.config.ports)
        raise RuntimeError(
            "LLM concurrency is too high for the process file descriptor limit: "
            f"{ports} ports * {self._llm.config.per_port_concurrency} "
            f"per-port concurrency = {self._capacity_size} concurrent HTTP "
            f"requests, but RLIMIT_NOFILE is {soft_limit}. "
            "Lower --llm-per-port-concurrency or raise the shell limit with "
            "`ulimit -n` before running the pipeline."
        )
