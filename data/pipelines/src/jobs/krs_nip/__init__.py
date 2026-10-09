"""Find the register entries behind a list of NIPs, with the register's own search.

    koryta_krs_nip nips.txt                     # ask, file, write nips.krs.tsv
    koryta_krs_nip nips.txt --out todo.tsv      # the same, with the table named
    python -m jobs.krs_nip nips.txt --dry-run   # say what would be asked; ask nothing
    koryta_krs_odpis --krs-file todo.tsv        # then, if wanted, their odpisy pełne

Most sources worth joining to the register name a body by NIP - CRU, a
published spend list, a crawl of BIPs - while the register is keyed by KRS.
api-krs cannot search, the Ministry of Finance's wykaz holds only VAT payers,
and rejestr.io is paid. The service behind the register's search page answers
by NIP, for free, from both registers (`jobs.krs_odpis.search.search_subjects`).

Every answer is filed in the crawl bucket as it arrives, under the name
`scrapers.krs.nip_answers.blob_name` gives it, and a NIP with an answer on
file is not asked again - "not in the register" included. So a run stopped
anywhere loses nothing, and the next asks only what is left. At most ``--max``
NIPs a run.

What comes out is a table in the shape `koryta_krs_odpis --krs-file` reads:
KRS, register, NIP, then the name and city the register gives the entry, one
line per entry. A NIP can reach more than one: a company transformed into
another keeps its NIP under the new number, and the old entry is found too.

The search is the same host `koryta_krs_odpis` asks for odpisy, so this takes
its lock: one crawler per IP.

Exit codes: 0 when every NIP asked got an answer; 75 when some did not, or the
run stopped early - try again later, nothing is asked twice; 130 when
interrupted; 1 for anything else. Twenty in a row without an answer stop the
run, as the service refusing.
"""

import argparse
import json
import re
import signal
import sys
import time
import typing
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import requests

from conductor import setup_context
from jobs.krs_odpis import EXIT_INTERRUPTED, one_crawler, search, warsaw_day
from scrapers.krs import nip_answers
from scrapers.stores import Context
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.storage import CRAWLED_BUCKET, Client

#: NIPs a run asks about at most. A search took 0.73 s in the soak
#: `search.REQUEST_INTERVAL` describes, and a NIP the register does not hold is
#: asked once more a second later (`search.EMPTY_RETRY_DELAYS`), so this is an
#: hour or two.
DEFAULT_MAX = 5000

MAX_CONSECUTIVE_FAILURES = 20

#: EX_TEMPFAIL: some NIPs got no answer; try again later.
EXIT_UPSTREAM_REFUSING = 75

#: How a NIP's search ended, as the run's counters name it.
FOUND = "found"
ABSENT = "absent"
FAILED = "failed"
STATUSES = (FOUND, ABSENT, FAILED)

#: How the stop for too many failures in a row ends.
REFUSING = "searches in a row got no answer"

_NIP_WEIGHTS = (6, 5, 7, 2, 3, 4, 5, 6, 7)


def nip_valid(nip: str) -> bool:
    """Ten digits whose last is the checksum of the other nine."""
    if len(nip) != 10 or not nip.isdigit():
        return False
    checksum = sum(int(d) * w for d, w in zip(nip, _NIP_WEIGHTS)) % 11
    return checksum == int(nip[9])


def read_nip_file(path: Path) -> list[str]:
    """NIPs one a line, in the file's order, each once.

    Dashes and spaces inside a NIP are dropped, blank lines and ``#`` comments
    skipped, and anything after a TAB ignored, so a table whose first column is
    the NIP reads as it is. A line that is not a valid NIP is refused with its
    number: the service would be asked about it, and say nothing.
    """
    nips: dict[str, None] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        nip = re.sub(r"[\s-]", "", line.split("\t", 1)[0])
        if not nip_valid(nip):
            raise SystemExit(f"{path}:{number}: not a valid NIP: {line!r}")
        nips.setdefault(nip, None)
    return list(nips)


def answers_on_file(ctx: Context, nips: Sequence[str]) -> dict[str, list[dict]]:
    """NIP to the register entries its newest answer on file names.

    Only for the NIPs asked about, so a list of a few hundred reads a few
    hundred bodies, not every answer the bucket holds. A body that is no
    answer, or that cannot be read, leaves its NIP out, to be asked again.
    """
    stored = nip_answers.stored_answers(ctx)
    known: dict[str, list[dict]] = {}
    unreadable = 0
    for nip in nips:
        held = stored.get(nip)
        if held is None or held.ref is None or held.ref.size == 0:
            continue
        try:
            body = ctx.io.read_data(held.ref).read_string()
        except Exception as problem:  # noqa: BLE001 - asked again, not the run
            unreadable += 1
            if unreadable == 1:
                print(f"Could not read {held.blob}: {problem}")
            continue
        hits = nip_answers.hits_of(body)
        if hits is not None:
            known[nip] = hits
    if unreadable:
        print(f"{unreadable:,} answers on file could not be read; asking again")
    return known


@dataclass
class Plan:
    nips: list[str]
    #: What the answers on file say, by NIP; an empty list is "not in the register".
    known: dict[str, list[dict]]
    #: The NIPs this run asks about, in the file's order.
    asks: list[str]
    #: Left for the next run by the cap.
    deferred: int = 0


def make_plan(nips: Sequence[str], known: dict[str, list[dict]], limit: int) -> Plan:
    todo = [nip for nip in nips if nip not in known]
    return Plan(
        nips=list(nips),
        known=known,
        asks=todo[: max(limit, 0)],
        deferred=max(len(todo) - max(limit, 0), 0),
    )


def report(plan: Plan) -> str:
    found = sum(1 for hits in plan.known.values() if hits)
    entries = sum(len(hits) for hits in plan.known.values())
    return (
        f"{len(plan.nips):,} NIPs: {len(plan.known):,} answered already - "
        f"{found:,} in the register ({entries:,} entries), "
        f"{len(plan.known) - found:,} not.\n"
        f"Asking about {len(plan.asks):,}; {plan.deferred:,} left for the next run."
    )


@dataclass
class Result:
    #: What the register answered, by NIP; an empty list is "not in the register".
    answers: dict[str, list[dict]] = field(default_factory=dict)
    #: Why each NIP still without an answer got none.
    failed: dict[str, str] = field(default_factory=dict)
    stopped: str = ""

    def counters(self) -> dict[str, int]:
        found = sum(1 for hits in self.answers.values() if hits)
        return {
            FOUND: found,
            ABSENT: len(self.answers) - found,
            FAILED: len(self.failed),
        }


#: Searches the register for a NIP.
Search = Callable[[str], Sequence[search.SearchHit]]
#: Files `data` under a blob name, and raises if it cannot.
Put = Callable[[str, bytes], typing.Any]


def ask_all(
    nips: Sequence[str],
    ask: Search,
    put: Put,
    day: Callable[[], str],
    interval: float,
    result: Result,
    record: Callable[[], typing.Any] = lambda: None,
    should_stop: Callable[[], bool] = lambda: False,
    sleep: Callable[[float], typing.Any] = time.sleep,
    say: Callable[[str], typing.Any] = print,
) -> Result:
    """Ask about each NIP, filing every answer before counting it.

    Filled in as it goes, so a caller interrupted part way still holds what
    was answered. NIPs that got no answer are asked once more at the end,
    unless the run was stopped.
    """
    in_a_row = 0
    asked = 0

    def run_pass(todo: Sequence[str]) -> bool:
        """One pass; False when the run has to stop."""
        nonlocal in_a_row, asked
        for index, nip in enumerate(todo, 1):
            if should_stop():
                result.stopped = "asked to stop"
                say("Stopping: asked to")
                return False
            if asked:
                sleep(interval)
            asked += 1
            try:
                hits = [asdict(hit) for hit in ask(nip)]
                body = {"nip": nip, "hits": hits}
                put(
                    nip_answers.blob_name(nip, day()),
                    json.dumps(body, ensure_ascii=False).encode("utf-8"),
                )
            except Exception as problem:  # noqa: BLE001 - one NIP is not the run
                result.failed[nip] = f"{type(problem).__name__}: {problem}"[:200]
                in_a_row += 1
                say(f"{index:>5}/{len(todo)} {nip} failed  [{result.failed[nip]}]")
            else:
                result.answers[nip] = hits
                result.failed.pop(nip, None)
                in_a_row = 0
                if index % 25 == 0:
                    say(f"{index:>5}/{len(todo)} {nip} {len(hits)} entries")
            record()
            if in_a_row >= MAX_CONSECUTIVE_FAILURES:
                result.stopped = f"{in_a_row} {REFUSING}"
                say(f"Stopping at {index} of {len(todo)}: {result.stopped}")
                return False
        return True

    if run_pass(nips) and result.failed:
        say(f"Second pass: {len(result.failed)} that got no answer")
        run_pass(list(result.failed))
    return result


def run_state(result: Result) -> FinalState:
    """How a run ended, for /admin/procesy: twenty in a row without an answer
    is the service refusing; NIPs left without one are for the next run."""
    if result.stopped.endswith(REFUSING):
        return "failed"
    return "partial" if result.stopped or result.failed else "succeeded"


def run(
    asks: Sequence[str],
    interval: float,
    client: typing.Any | None = None,
    session: typing.Any | None = None,
    status: JobRun | None = None,
) -> tuple[Result, int]:
    """Ask about every NIP in `asks`; the answers, and the exit code."""
    client = client or Client()
    session = session or requests.Session()
    status = status or JobRun("krs_nip", unit="NIP", total=len(asks))
    result = Result()

    def ask(nip: str) -> Sequence[search.SearchHit]:
        return search.search_nip_confirmed(nip, session=session)

    def put(name: str, data: bytes) -> None:
        client.create_object(CRAWLED_BUCKET, name, data, "application/json")

    def record() -> None:
        counters = result.counters()
        status.progress(counters[FOUND] + counters[ABSENT], counters=counters)

    stop = False

    def on_sigterm(signum, frame):
        nonlocal stop
        stop = True

    status.start()
    try:
        previous = signal.signal(signal.SIGTERM, on_sigterm)
        try:
            ask_all(
                asks,
                ask,
                put,
                warsaw_day,
                interval,
                result,
                record=record,
                should_stop=lambda: stop,
            )
        finally:
            signal.signal(signal.SIGTERM, previous)
    except KeyboardInterrupt:
        print("Interrupted; what was answered is in the bucket")
        result.stopped = "przerwany"
        status.finish(
            "partial",
            stop_reason=result.stopped,
            exit_code=EXIT_INTERRUPTED,
            counters=result.counters(),
            done=len(result.answers),
        )
        return result, EXIT_INTERRUPTED
    except BaseException as problem:
        status.finish(
            "failed",
            stop_reason=f"raised {type(problem).__name__}",
            errors=[repr(problem)],
            done=len(result.answers),
        )
        raise

    code = EXIT_UPSTREAM_REFUSING if result.stopped or result.failed else 0
    status.finish(
        run_state(result),
        stop_reason=result.stopped or None,
        errors=[f"{nip}: {error}" for nip, error in result.failed.items()][
            :ERRORS_KEPT
        ],
        exit_code=code,
        counters=result.counters(),
        done=len(result.answers),
    )
    print(
        f"Asked about {len(result.answers) + len(result.failed):,} NIPs: "
        f"{result.counters()}"
        + (f"; stopped: {result.stopped}" if result.stopped else "")
    )
    return result, code


def _cell(value: object) -> str:
    return " ".join(str(value or "").split())


def write_table(
    path: Path, nips: Sequence[str], answers: Mapping[str, Sequence[dict]]
) -> int:
    """The register entries of `nips`, in their order, as `--krs-file` reads them.

    Returns how many entries were written.
    """
    lines = ["# krs\tregister\tnip\tname\tcity"]
    for nip in nips:
        for hit in answers.get(nip) or ():
            krs = str(hit.get("krs") or "")
            if not krs.isdigit() or len(krs) > 10:
                continue
            register = hit.get("register") or ""
            lines.append(
                "\t".join(
                    (
                        krs.zfill(10),
                        register if register in ("P", "S") else "",
                        nip,
                        _cell(hit.get("name")),
                        _cell(hit.get("city")),
                    )
                )
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines) - 1


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_krs_nip", description=(__doc__ or "").split("\n")[0]
    )
    parser.add_argument(
        "nip_file",
        help="NIPs to look up, one a line; '#' comments, and anything after a "
        "TAB, are ignored.",
    )
    parser.add_argument(
        "--out",
        help="Where to write the table of register entries (default: the NIP "
        "file with the suffix .krs.tsv).",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=DEFAULT_MAX,
        help=f"NIPs to ask about at most this run (default {DEFAULT_MAX}).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=search.REQUEST_INTERVAL,
        help="Seconds between searches. A government service that asks for no "
        "key; keep it polite.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be asked; ask nothing, write nothing.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    nip_file = Path(args.nip_file)
    out = Path(args.out) if args.out else nip_file.with_suffix(".krs.tsv")
    nips = read_nip_file(nip_file)
    # Pipelines read sys.argv themselves; the job's own flags must not reach them.
    sys.argv = sys.argv[:1]

    ctx, _ = setup_context()
    known = answers_on_file(ctx, nips)
    plan = make_plan(nips, known, args.max)
    print(report(plan))
    if args.dry_run:
        return 0

    code = 0
    if plan.asks:
        with one_crawler():
            result, code = run(plan.asks, args.interval)
        known.update(result.answers)
    entries = write_table(out, nips, known)
    found = sum(1 for nip in nips if known.get(nip))
    print(
        f"{entries:,} register entries for {found:,} of {len(nips):,} NIPs in {out}; "
        f"{sum(1 for nip in nips if nip in known) - found:,} not in the register, "
        f"{sum(1 for nip in nips if nip not in known):,} not answered yet."
    )
    if entries:
        print(f"Their odpisy pełne: koryta_krs_odpis --krs-file {out}")
    return code
