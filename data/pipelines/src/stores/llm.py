from __future__ import annotations

import asyncio
import resource
from dataclasses import dataclass

import aiohttp

from scrapers.stores import LLM, LLMRequest, LLMResponse, LLMResponsePool


@dataclass(frozen=True)
class OpenAICompatibleConfig:
    model: str = "Qwen/Qwen3-14B"
    ports: tuple[int, ...] = tuple(range(6000, 6016))
    per_port_concurrency: int = 4
    request_timeout_seconds: int = 90
    retries: int = 3
    enable_thinking: bool = False
    # When base_url is set (e.g. https://openrouter.ai/api/v1) every request goes
    # there instead of http://localhost:<port>/v1; `ports` then act only as
    # concurrency lanes. api_key adds an "Authorization: Bearer" header.
    base_url: str | None = None
    api_key: str | None = None


@dataclass(frozen=True)
class _QueuedRequest:
    request_id: int
    request: LLMRequest


class OpenAICompatibleMultiPortLLM(LLM):
    def __init__(self, config: OpenAICompatibleConfig | None = None) -> None:
        self.config = config or OpenAICompatibleConfig()
        if not self.config.ports:
            raise ValueError("At least one LLM port must be configured")
        self._semaphores = {
            port: asyncio.Semaphore(self.config.per_port_concurrency)
            for port in self.config.ports
        }
        # Requests currently in flight per port (holding a semaphore slot). The
        # scheduler sends the next request to the port with the fewest in
        # flight, so fast servers fill up to their per-port concurrency cap
        # before a slow one is given more work.
        self._in_flight = {port: 0 for port in self.config.ports}
        self._equal_load_tiebreak = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.request_count = 0

    def _endpoint(self, port: int) -> str:
        if self.config.base_url:
            return self.config.base_url.rstrip("/")
        return f"http://localhost:{port}/v1"

    def _headers(self) -> dict[str, str]:
        if self.config.api_key:
            return {"Authorization": f"Bearer {self.config.api_key}"}
        return {}

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
                f"{self._endpoint(port)}/models",
                headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    return port, False, f"HTTP {resp.status}"
                return port, True, ""
        except Exception as exc:
            return port, False, str(exc)

    def response_pool(self) -> LLMResponsePool:
        return OpenAICompatibleResponsePool(self)

    def _pick_port(self) -> int:
        """The port with the fewest requests in flight.

        Ties are broken by round-robin so one server is not hammered while it
        catches up with the others. This keeps every port saturated to its
        ``per_port_concurrency`` cap before a slower one gets more work.
        """
        ports = self.config.ports
        least = min(self._in_flight[port] for port in ports)
        candidates = [port for port in ports if self._in_flight[port] == least]
        port = candidates[self._equal_load_tiebreak % len(candidates)]
        self._equal_load_tiebreak += 1
        return port

    async def _complete_with_retry(
        self,
        session: aiohttp.ClientSession,
        request: LLMRequest,
    ) -> LLMResponse:
        last_exc: Exception | None = None
        for attempt in range(1, self.config.retries + 1):
            port = self._pick_port()
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
        }
        if not self.config.base_url:
            # chat_template_kwargs is a vLLM extension; remote OpenAI-compatible
            # gateways (OpenRouter) reject unknown fields.
            payload["chat_template_kwargs"] = {
                "enable_thinking": (
                    request.enable_thinking or self.config.enable_thinking
                ),
            }
        async with self._semaphores[port]:
            self._in_flight[port] += 1
            try:
                async with session.post(
                    f"{self._endpoint(port)}/chat/completions",
                    json=payload,
                    headers=self._headers(),
                    timeout=aiohttp.ClientTimeout(
                        total=self.config.request_timeout_seconds
                    ),
                ) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
            finally:
                self._in_flight[port] -= 1
        choice = data["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
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
            finish_reason=finish_reason,
            port=port,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )


class OpenAICompatibleResponsePool(LLMResponsePool):
    def __init__(self, llm: OpenAICompatibleMultiPortLLM) -> None:
        self._llm = llm
        self._capacity_size = len(llm.config.ports) * llm.config.per_port_concurrency
        self._capacity = asyncio.Semaphore(self._capacity_size)
        self._request_queue: asyncio.Queue[_QueuedRequest | None] = asyncio.Queue(
            maxsize=self._capacity_size
        )
        self._response_queue: asyncio.Queue[tuple[int, LLMResponse | Exception]] = (
            asyncio.Queue()
        )
        self._next_request_id = 0
        self._session: aiohttp.ClientSession | None = None
        self._workers: list[asyncio.Task[None]] = []

    async def __aenter__(self) -> "OpenAICompatibleResponsePool":
        self._check_file_descriptor_limit()
        connector = aiohttp.TCPConnector(limit=self._capacity_size)
        self._session = aiohttp.ClientSession(connector=connector)
        self._workers = [
            asyncio.create_task(self._worker()) for _ in range(self._capacity_size)
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
                response: (
                    LLMResponse | Exception
                ) = await self._llm._complete_with_retry(
                    self._session,
                    queued.request,
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
