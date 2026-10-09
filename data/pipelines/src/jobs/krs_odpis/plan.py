"""Which companies a run asks the ministry about, and in which register first.

Pure: it is handed the candidates, what the bucket holds, what the bulletin
says and what api-krs has already settled, and decides. Nothing here makes a
request, so every rule is tested on its own.
"""

import re
import typing
from collections import Counter
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from scrapers.krs import odpis_files
from scrapers.krs.columns import is_public
from scrapers.krs.odpis_attempts import ABSENT
from scrapers.krs.scrape import QueryType, RejestrIOQuery

#: What the paid job buys about a company that the odpis now tells for free:
#: everybody tied to it, now and before. `REJESTRIO_ORG`, the company record,
#: is not among them -- the odpis says nothing of what rejestr.io adds to it.
COMPANY_CONNECTIONS = frozenset(
    {
        QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
        QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
    }
)

#: What one rejestr.io call costs, as `RejestrIOQuery.cost` prices it.
PLN_PER_CALL = 0.05

REASON_FILE = "krs_file"
REASON_GRAPH = "graph"
#: A company of the graph with no odpis pełny on file (`without_odpis`).
REASON_NO_ODPIS = "no_odpis"

#: Which of those a run asks about too (`--missing`): the public ones, or all.
MISSING_PUBLIC = "public"
MISSING_ALL = "all"
MISSING = (MISSING_PUBLIC, MISSING_ALL)

_KRS_LINE = re.compile(r"^\d{10}$")


@dataclass(frozen=True)
class Candidate:
    """A company somebody wants an odpis of, and why."""

    krs: str
    reason: str
    #: The register the source says it is in, "" when it does not know.
    hint: str = ""
    #: rejestr.io connection calls the paid job would make for it.
    paid_calls: int = 0


@dataclass(frozen=True)
class Ask:
    """One company this run asks about, with the registers in the order to try."""

    krs: str
    registers: tuple[str, ...]
    reason: str
    #: On file already, but the bulletin names the entry since it was fetched.
    refresh: bool = False
    paid_calls: int = 0


@dataclass
class Plan:
    asks: list[Ask]
    #: On file, and the bulletin names no entry since.
    held: int = 0
    #: Fetched today already: once a day is what the bucket's names allow.
    fetched_today: int = 0
    #: Left for the next run by the cap.
    deferred: int = 0


def read_krs_file(path: Path) -> list[Candidate]:
    """KRS numbers one per line, optionally TAB and the register (P or S).

    The `krs_todo.tsv` the CRU crawl writes reads as it is; columns after the
    second are ignored, and so are blank lines and ``#`` comments. A line whose
    first field is not exactly ten digits is refused with its number: a bogus
    KRS would be asked about on every run.
    """
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [f.strip() for f in line.split("\t")]
        if not _KRS_LINE.match(fields[0]):
            raise SystemExit(f"{path}:{number}: not a 10-digit KRS: {line!r}")
        known = len(fields) > 1 and fields[1] in odpis_files.REGISTERS
        hint = fields[1] if known else ""
        if fields[0] not in seen:
            seen.add(fields[0])
            candidates.append(Candidate(krs=fields[0], reason=REASON_FILE, hint=hint))
    return candidates


def from_queries(queries: Iterable[RejestrIOQuery]) -> list[Candidate]:
    """The company part of `ScrapeRejestrIO`, in its order: person feeds stay paid."""
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for query in queries:
        if query.krs is None or query.krs.id in seen:
            continue
        seen.add(query.krs.id)
        candidates.append(
            Candidate(
                krs=query.krs.id,
                reason=query.primary_reason,
                paid_calls=sum(1 for q in query.queries if q in COMPANY_CONNECTIONS),
            )
        )
    return candidates


def from_graph(companies: pd.DataFrame) -> list[Candidate]:
    """Every company the pipelines know (`CompaniesKRS`), the public ones first.

    The order is what a capped run reaches first: a publicly owned company is
    the one a page is likeliest to show.
    """
    krs = companies["krs"].astype(str).str.zfill(10)
    public = companies.get("is_public", pd.Series(False, index=companies.index))
    ordered = pd.concat([krs[public.eq(True)], krs[~public.eq(True)]])
    return [Candidate(krs=k, reason=REASON_GRAPH) for k in dict.fromkeys(ordered)]


def changed_since(
    candidates: Iterable[Candidate], changes: Mapping[str, str], since: str
) -> list[Candidate]:
    """The candidates whose entry the bulletin names on or after `since`, an ISO day."""
    return [c for c in candidates if changes.get(c.krs, "") >= since]


def without_odpis(
    companies: pd.DataFrame,
    stored: Collection[str],
    attempts: Mapping[str, str],
    private: bool = False,
) -> list[Candidate]:
    """The graph's companies with no odpis pełny on file, in the order to ask.

    The gap the bulletin does not close. `--changed-since` asks a company only
    once the bulletin names it again, so one that came into the graph after its
    last register entry - a public owner's company found by the register job,
    one a feed names, one that holds only rejestr.io's historical feed - was
    never asked at all: 739 live companies held only that feed on 2026-10-09.

    The public ones first, and the rest only with `private`. Within each, the
    companies never asked come before those whose last attempt got no answer,
    so a few that keep failing do not hold up the rest. One whose last answer
    was that neither register has the number (`attempts`: KRS to the newest
    attempt's status) is left out: it would answer the same every night.
    """
    krs = companies["krs"].astype(str).str.zfill(10)
    public = is_public(
        companies.get("is_public", pd.Series(False, index=companies.index))
    )
    groups = [krs[public]] + ([krs[~public]] if private else [])
    ordered: list[str] = []
    for group in groups:
        gap = [
            k
            for k in dict.fromkeys(group)
            if k not in stored and attempts.get(k) != ABSENT
        ]
        ordered += [k for k in gap if k not in attempts]
        ordered += [k for k in gap if k in attempts]
    return [Candidate(krs=k, reason=REASON_NO_ODPIS) for k in dict.fromkeys(ordered)]


def joined(*lists: Iterable[Candidate]) -> list[Candidate]:
    """The candidates of each list in turn, a company only where it comes first."""
    seen: set[str] = set()
    out: list[Candidate] = []
    for candidates in lists:
        for candidate in candidates:
            if candidate.krs not in seen:
                seen.add(candidate.krs)
                out.append(candidate)
    return out


def register_hints(settled: Mapping[str, set[QueryType]]) -> dict[str, str]:
    """The register api-krs found a company in, from where it answered 404.

    A company sits in one register and the other answers 404 for it
    (`scrape.settled_registers`), so a 404 from S means P and the reverse.
    """
    hints = {}
    for krs, answered in settled.items():
        p_missing = QueryType.API_KRS_ODPIS_AKTUALNY_P in answered
        s_missing = QueryType.API_KRS_ODPIS_AKTUALNY_S in answered
        if p_missing != s_missing:
            hints[str(krs).zfill(10)] = "S" if p_missing else "P"
    return hints


def order(first: str) -> tuple[str, ...]:
    """Both registers, the likely one first: a wrong guess costs one request."""
    return (first, "S" if first == "P" else "P")


def select(
    candidates: Iterable[Candidate],
    stored: Mapping[str, odpis_files.StoredOdpis],
    changes: Mapping[str, str],
    hints: Mapping[str, str],
    today: str,
    limit: int,
) -> Plan:
    """The run's asks, in candidate order, and what was left out and why.

    An odpis on file is fetched again only when the bulletin names the entry
    on or after the day it was fetched: the history only grows when the entry
    changes, and a change the same day may have come after the fetch. Never
    twice in one day -- one name per company per day is all the bucket holds.
    The register comes from the odpis on file, then the source's hint, then
    api-krs; with none, P first, the larger register.
    """
    plan = Plan(asks=[])
    for candidate in candidates:
        held = stored.get(candidate.krs)
        refresh = False
        if held is not None:
            if held.day >= today:
                plan.fetched_today += 1
                continue
            changed = changes.get(candidate.krs)
            if changed is None or changed < held.day:
                plan.held += 1
                continue
            refresh = True
        if len(plan.asks) >= limit:
            plan.deferred += 1
            continue
        first = (
            (held.register if held else "")
            or candidate.hint
            or hints.get(candidate.krs, "")
            or "P"
        )
        plan.asks.append(
            Ask(
                krs=candidate.krs,
                registers=order(first),
                reason=candidate.reason,
                refresh=refresh,
                paid_calls=candidate.paid_calls,
            )
        )
    return plan


def report(plan: Plan, candidates: typing.Sized, source: str) -> str:
    reasons = Counter(ask.reason for ask in plan.asks)
    paid = sum(ask.paid_calls for ask in plan.asks)
    refreshes = sum(1 for ask in plan.asks if ask.refresh)
    return (
        f"{len(candidates):,} companies from {source}: {plan.held:,} on file and "
        f"unchanged, {plan.fetched_today:,} fetched today, {plan.deferred:,} left "
        f"for the next run.\n"
        f"Asking about {len(plan.asks):,} ({refreshes:,} of them again, the "
        f"bulletin having moved), by reason {dict(reasons)}.\n"
        f"The paid job would make {paid:,} rejestr.io connection calls for them "
        f"({paid * PLN_PER_CALL:.2f} PLN)."
    )
