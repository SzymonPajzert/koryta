from __future__ import annotations

import asyncio
import itertools
import re
from dataclasses import dataclass

import aiohttp

from scrapers.stores import LLM, LLMRequest, LLMResponse


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
        connector = aiohttp.TCPConnector(
            limit=len(self.config.ports) * self.config.per_port_concurrency
        )
        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [self._complete_with_retry(session, request) for request in requests]
            return list(await asyncio.gather(*tasks))

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
