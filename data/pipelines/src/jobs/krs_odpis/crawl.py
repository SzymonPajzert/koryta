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
again. Before that, a burst of no answers - three of the last five - gets a
minute's rest, a few times a run.

A service that has stopped answering altogether gets longer: when either
no-answer rule fires, the run rests `STALL_REST` and tries the next company,
`STALL_RESTS` times, before it gives up. The no-answer window is judged only
on an attempt that got no answer, since a served document says the service is
back.
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

# How an attempt ends. The run record's vocabulary, kept with its reader
# (`KrsOdpisAttempts`), which the paid job buys rejestr.io's feeds from.
from scrapers.krs.odpis_attempts import (
    ABSENT,
    FAILED,
    FETCHED,
    GATEWAY,
    NETWORK,
    TRANSIENT,
    UNANSWERED,
)

WINDOW = 50
MAX_CONSECUTIVE_FAILURES = 20

#: A pause when the service stops answering for a moment: `COOL_AFTER` of the
#: last `COOL_WINDOW` attempts got no answer. The 504s of 2026-10-02 came in
#: bursts, with the service answering as usual in between - 15 in ~30 attempts
#: in the evening run - and running on through one is what tripped the stop
#: rule at 310 of 1,000. A minute's rest first; the stop rule still ends a
#: burst that outlasts it.
COOL_WINDOW = 5
COOL_AFTER = 3
COOL_DOWN = 60.0
#: Pauses a run takes at most before it leaves the rest to the stop rule.
COOL_DOWNS = 5

#: The rest a run takes when a no-answer rule fires, and how many it takes
#: before it lets the rule end the run. On the nights of 2026-10-10, -12 and
#: -13 the service stopped answering at about 04:42 Warsaw: every attempt timed
#: out at `CRAWL_TIMEOUT`, between documents served in 0.5 s, while api-krs
#: answered as usual and the day runs before and after got every one. On the
#: 10th it was serving again about 10 minutes in and on the 12th 7 minutes in,
#: just as the rules ended the run - the 12th's last 21 attempts were all
#: served. Three rests of five minutes cover that, inside the night's 45.
STALL_REST = 300.0
STALL_RESTS = 3

#: EX_TEMPFAIL: the service would not answer everything; try again later.
#: Anything else that goes wrong raises, and exits 1.
EXIT_UPSTREAM_REFUSING = 75

#: How each stop for no answers ends, and the one for too many dead attempts
#: in a row in full.
NO_ANSWER = "got no answer"
REFUSING = f"attempts in a row {NO_ANSWER}"


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
        return [k for k, o in self.final().items() if o.status in UNANSWERED]

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
        return f"{sum(trouble)} of the last {WINDOW} attempts {NO_ANSWER}"
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


def attempt(ask: Ask, number: int, fetch: Fetch, clock: Callable[[], float]) -> Outcome:
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


@dataclass
class CoolDown:
    """When a run rests after a burst of no answers, and how often it may."""

    pauses: int = 0
    #: Attempts since the last rest; a rest is not taken twice for one burst.
    since: int = COOL_WINDOW

    def rest_if_due(
        self,
        trouble: Sequence[int],
        clock: Callable[[], float],
        sleep: Callable[[float], typing.Any],
        should_stop: Callable[[], bool],
        say: Callable[[str], typing.Any],
    ) -> bool:
        """Rest `COOL_DOWN` if a burst calls for it; False if asked to stop."""
        recent = list(trouble)[-COOL_WINDOW:]
        if (
            self.since < COOL_WINDOW
            or sum(recent) < COOL_AFTER
            or self.pauses >= COOL_DOWNS
        ):
            return True
        self.pauses += 1
        self.since = 0
        say(
            f"Pausing {COOL_DOWN:.0f} s: "
            f"{sum(recent)} of the last {len(recent)} {NO_ANSWER}"
        )
        return rest(COOL_DOWN, clock, sleep, should_stop)


def rest(
    seconds: float,
    clock: Callable[[], float],
    sleep: Callable[[float], typing.Any],
    should_stop: Callable[[], bool],
) -> bool:
    """Wait `seconds`, a second at a time; False if asked to stop meanwhile."""
    resting = clock() + seconds
    while clock() < resting:
        if should_stop():
            return False
        sleep(min(1.0, resting - clock()))
    return True


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
    cooling = CoolDown()
    stall_rests = 0

    def asked_to_stop() -> bool:
        result.stopped = "asked to stop"
        say("Stopping: asked to")
        return False

    def run_pass(todo: Sequence[Ask], number: int) -> bool:
        """One pass; False when the run has to stop."""
        nonlocal baseline, in_a_row, stall_rests
        for index, ask in enumerate(todo, 1):
            if should_stop():
                return asked_to_stop()
            if result.outcomes:
                sleep(interval)
            outcome = attempt(ask, number, fetch, clock)
            result.outcomes.append(outcome)
            record(outcome)
            failed = outcome.status in UNANSWERED
            in_a_row = in_a_row + 1 if failed else 0
            trouble.append(1 if outcome.status in TRANSIENT else 0)
            cooling.since += 1
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
                # 2026-10-12's run was stopped by the window at a served
                # document, the 21st in a row.
                result.stopped = stop_reason(
                    served[-WINDOW:], baseline, trouble if failed else ()
                )
            if (
                result.stopped.endswith(NO_ANSWER)
                and outcome.status in TRANSIENT
                and stall_rests < STALL_RESTS
            ):
                stall_rests += 1
                say(
                    f"Resting {STALL_REST / 60:.0f} min at {index} of {len(todo)} "
                    f"({stall_rests} of {STALL_RESTS}): {result.stopped}"
                )
                result.stopped = ""
                if not rest(STALL_REST, clock, sleep, should_stop):
                    return asked_to_stop()
                # The window starts afresh. The count in a row does not, so
                # after a rest it called for, the next attempt that gets no
                # answer calls for the next rest, or ends the run.
                trouble.clear()
                continue
            if result.stopped:
                say(f"Stopping at {index} of {len(todo)}: {result.stopped}")
                return False
            if not cooling.rest_if_due(trouble, clock, sleep, should_stop, say):
                return asked_to_stop()
        return True

    if run_pass(asks, 1):
        retry = [a for a in asks if result.final()[a.krs].status in TRANSIENT]
        if retry:
            say(f"Second pass: {len(retry)} that got no answer")
            run_pass(retry, 2)
    return result
