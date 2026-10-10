"""How far a long loop has got, said now and then on stdout.

Its own module rather than beside the loop it serves: `odpis_history`'s parse
cache is stamped with that module's source (`parser_version`), so a change to
how progress reads would there re-parse every odpis on file.
"""

import time
from collections.abc import Callable

#: How often `Progress` says how far it has got: every this many items, or
#: this many seconds, whichever comes first.
EVERY = 500
SECONDS = 60.0


def duration(seconds: float) -> str:
    """``12s``, ``41m 05s`` or ``1h 02m``."""
    whole = max(0, round(seconds))
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


class Progress:
    """How many of `total` items are done, how fast, and how long the rest
    will take, said every `EVERY` items or `SECONDS`, whichever comes first:
    ``  4,000/12,440 odpisy parsed, 4.0/s, 35m 10s left``.

    `step` once per item finished - not per item handed out, which on a pool
    runs a batch ahead. The time is looked at only then, so a single item
    that takes longer than `SECONDS` is a gap in the log all the same.
    Flushed, so a run whose output goes to a file rather than a terminal
    says so when it happens too.
    """

    def __init__(
        self,
        total: int,
        what: str,
        every: int | None = None,
        seconds: float | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.total = total
        self.what = what
        self.every = EVERY if every is None else every
        self.seconds = SECONDS if seconds is None else seconds
        self.clock = clock
        self.started = self.said_at = clock()
        self.done = self.said_done = 0

    def step(self) -> None:
        """One more item finished."""
        self.done += 1
        now = self.clock()
        if (
            self.done - self.said_done >= self.every
            or now - self.said_at >= self.seconds
        ):
            self.said_at, self.said_done = now, self.done
            print(f"  {self.line(now)}", flush=True)

    def line(self, now: float) -> str:
        counted = f"{self.done:,}/{self.total:,} {self.what}"
        elapsed = now - self.started
        if elapsed <= 0:
            return counted
        rate = self.done / elapsed
        left = duration((self.total - self.done) / rate)
        return f"{counted}, {rate:.1f}/s, {left} left"

    def finish(self) -> None:
        """How long it all took, if anything was done."""
        if self.done:
            elapsed = duration(self.clock() - self.started)
            print(f"  {self.done:,} {self.what} in {elapsed}", flush=True)
