"""Per-host request spacing.

Same token-bucket idea as the article crawler, but kept as an injectable object
(with a clock) so the crawler is testable without sleeping.
"""

from __future__ import annotations

import threading
import time
from typing import Callable


class HostRateLimiter:
    """Ensures at least `min_interval_s` between requests to the same host."""

    def __init__(
        self,
        min_interval_s: float = 1.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.min_interval_s = max(0.0, min_interval_s)
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._next_allowed: dict[str, float] = {}

    def wait(self, host: str) -> None:
        if self.min_interval_s <= 0:
            return
        with self._lock:
            now = self._clock()
            next_allowed = self._next_allowed.get(host, now)
            delay = max(0.0, next_allowed - now)
            self._next_allowed[host] = max(now, next_allowed) + self.min_interval_s
        if delay > 0:
            self._sleep(delay)
