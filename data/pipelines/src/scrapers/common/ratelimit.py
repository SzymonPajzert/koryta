"""Per-host token bucket, shared by both crawlers.

Extracted from the article crawler's `_can_crawl` so the BIP coordinator uses
the same politeness semantics: a host refills at one token per `interval_s`,
holds up to a burst window's worth, and each request costs one token.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

BURST_WINDOW_S = 60.0


class HostTokenBucket:
    def __init__(
        self,
        interval_s: float,
        burst_window_s: float = BURST_WINDOW_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.interval_s = interval_s
        self.burst_window_s = burst_window_s
        self._clock = clock
        self._lock = threading.Lock()
        self._buckets: dict[str, tuple[float, float]] = {}

    @property
    def rate_per_s(self) -> float:
        return 1.0 / self.interval_s if self.interval_s > 0 else float("inf")

    def acquire(self, key: str) -> bool:
        """Take one token for `key`, or return False when the bucket is empty."""
        if self.interval_s <= 0:
            return True
        capacity = max(1.0, self.burst_window_s * self.rate_per_s)
        with self._lock:
            now = self._clock()
            tokens, last = self._buckets.get(key, (capacity, now))
            tokens = min(capacity, tokens + (now - last) * self.rate_per_s)
            if tokens >= 1.0:
                self._buckets[key] = (tokens - 1.0, now)
                return True
            self._buckets[key] = (tokens, now)
            return False

    def next_available_in(self, key: str) -> float:
        """Seconds until `key` would have a token (0 when it has one now)."""
        if self.interval_s <= 0:
            return 0.0
        capacity = max(1.0, self.burst_window_s * self.rate_per_s)
        with self._lock:
            now = self._clock()
            tokens, last = self._buckets.get(key, (capacity, now))
            tokens = min(capacity, tokens + (now - last) * self.rate_per_s)
            if tokens >= 1.0:
                return 0.0
            return (1.0 - tokens) / self.rate_per_s
