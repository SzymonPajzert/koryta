"""Asking for odpisy down a list, politely, and stopping when the service tires.

The search service sits behind a WAF that degrades rather than refuses: served
documents slow down, then requests start dying at the gateway's 30 s deadline
with a 504. So the loop watches two things over the last `WINDOW` attempts and
stops on either, as the CRU crawl's `fetch_until_slow` did:

- served documents averaging above min(3 x the first window's average, 2.5 s);
- more than 10 attempts that never got an answer.

Unlike that crawler, "never got an answer" counts a dropped connection, a DNS
failure or a timeout as well as a 504 -- promo1 lost 83 entries to one wifi
blip that the old rule never saw -- and 20 of them in a row end the run
outright. Both kinds clear on a later try (40 of 40 504s came back on one
retry), so they get a second pass at the end unless the rule stopped the run;
an odpis that is simply not in either register is an answer, and is not asked
again.
"""

import statistics
import time
import typing
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import requests

from jobs.krs_odpis.plan import Ask
from jobs.krs_odpis.search import OdpisUnavailable

WINDOW = 50
MAX_CONSECUTIVE_FAILURES = 20

#: EX_TEMPFAIL: the service would not answer everything; try again later.
#: Anything else that goes wrong raises, and exits 1.
EXIT_UPSTREAM_REFUSING = 75

FETCHED = "fetched"
#: The service answered: the KRS is in neither register asked.
ABSENT = "absent"
#: The gateway gave up (504), or the network did. Says nothing of the company.
GATEWAY = "gateway"
NETWORK = "network"
#: Any other answer, or a bug. Not retried.
FAILED = "failed"

#: What a second try may fix.
TRANSIENT = frozenset({GATEWAY, NETWORK})
#: Every status, in the order a summary lists them.
STATUSES = (FETCHED, ABSENT, GATEWAY, NETWORK, FAILED)
#: How the stop for too many dead attempts in a row ends.
REFUSING = "attempts in a row got no answer"


@dataclass
class Outcome:
    """One attempt at one company, as the run record keeps it."""

    krs: str
    status: str
    reason: str
    refresh: bool
    attempt: int
    seconds: float
    register: str | None = None
    size: int | None = None
    error: str | None = None


@dataclass
class Result:
    outcomes: list[Outcome] = field(default_factory=list)
    stopped: str = ""

    def final(self) -> dict[str, Outcome]:
        """Each company's last outcome, which is the one that stands."""
        return {o.krs: o for o in self.outcomes}

    @property
    def unanswered(self) -> list[str]:
        return [k for k, o in self.final().items() if o.status in TRANSIENT | {FAILED}]

    @property
    def code(self) -> int:
        return EXIT_UPSTREAM_REFUSING if self.stopped or self.unanswered else 0


def stop_reason(
    served: Sequence[float], baseline: float | None, trouble: Sequence[int]
) -> str:
    """Why to stop now, or "" to go on.

    `served` holds the trailing served-document times (at most WINDOW),
    `baseline` the mean of the first WINDOW served, `trouble` 1 for each of the
    last WINDOW attempts that got no answer. Nothing stops before the window
    is full.
    """
    if sum(trouble) > 10 and len(trouble) == WINDOW:
        return f"{sum(trouble)} of the last {WINDOW} attempts got no answer"
    if len(served) == WINDOW and baseline:
        trailing = statistics.mean(served)
        ceiling = min(3 * baseline, 2.5)
        if trailing > ceiling:
            return (
                f"trailing-{WINDOW} mean {trailing:.2f}s over the {ceiling:.2f}s "
                f"ceiling (baseline {baseline:.2f}s)"
            )
    return ""


def classify(problem: Exception) -> tuple[str, str]:
    if isinstance(problem, OdpisUnavailable) and problem.status == 504:
        return GATEWAY, str(problem)
    if isinstance(problem, (requests.ConnectionError, requests.Timeout)):
        return NETWORK, f"{type(problem).__name__}: {problem}"[:200]
    return FAILED, f"{type(problem).__name__}: {problem}"[:200]


Fetch = Callable[[Ask], "tuple[str, bytes] | None"]


def attempt(
    ask: Ask, number: int, fetch: Fetch, clock: Callable[[], float]
) -> Outcome:
    """One try at one company, whatever happens: a broken one is not the run."""

    def outcome(status: str, seconds: float, **extra: typing.Any) -> Outcome:
        return Outcome(
            krs=ask.krs,
            status=status,
            reason=ask.reason,
            refresh=ask.refresh,
            attempt=number,
            seconds=seconds,
            **extra,
        )

    began = clock()
    try:
        fetched = fetch(ask)
    except Exception as problem:  # noqa: BLE001 - one company is not the run
        status, error = classify(problem)
        return outcome(status, clock() - began, error=error)
    seconds = clock() - began
    if fetched is None:
        return outcome(ABSENT, seconds)
    register, content = fetched
    return outcome(FETCHED, seconds, register=register, size=len(content))


def crawl(
    asks: Sequence[Ask],
    fetch: Fetch,
    record: Callable[[Outcome], typing.Any],
    interval: float,
    should_stop: Callable[[], bool] = lambda: False,
    sleep: Callable[[float], typing.Any] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    say: Callable[[str], typing.Any] = print,
) -> Result:
    """Ask about each company once, then once more about those the network ate."""
    result = Result()
    served: list[float] = []
    trouble: deque[int] = deque(maxlen=WINDOW)
    baseline: float | None = None
    in_a_row = 0

    def run_pass(todo: Sequence[Ask], number: int) -> bool:
        """One pass; False when the run has to stop."""
        nonlocal baseline, in_a_row
        for index, ask in enumerate(todo, 1):
            if should_stop():
                result.stopped = "asked to stop"
                say("Stopping: asked to")
                return False
            if result.outcomes:
                sleep(interval)
            outcome = attempt(ask, number, fetch, clock)
            result.outcomes.append(outcome)
            record(outcome)
            failed = outcome.status in TRANSIENT | {FAILED}
            in_a_row = in_a_row + 1 if failed else 0
            trouble.append(1 if outcome.status in TRANSIENT else 0)
            if outcome.status == FETCHED:
                served.append(outcome.seconds)
                if len(served) == WINDOW and baseline is None:
                    baseline = statistics.mean(served)
                    say(f"  baseline over the first {WINDOW}: {baseline:.2f}s")
            if index % 25 == 0 or failed:
                say(
                    f"{index:>5}/{len(todo)} {ask.krs} {outcome.status:<8} "
                    f"{outcome.seconds:6.2f}s"
                    + (f"  [{outcome.error}]" if outcome.error else "")
                )
            if in_a_row >= MAX_CONSECUTIVE_FAILURES:
                result.stopped = f"{in_a_row} {REFUSING}"
            else:
                result.stopped = stop_reason(served[-WINDOW:], baseline, trouble)
            if result.stopped:
                say(f"Stopping at {index} of {len(todo)}: {result.stopped}")
                return False
        return True

    if run_pass(asks, 1):
        retry = [a for a in asks if result.final()[a.krs].status in TRANSIENT]
        if retry:
            say(f"Second pass: {len(retry)} that got no answer")
            run_pass(retry, 2)
    return result
