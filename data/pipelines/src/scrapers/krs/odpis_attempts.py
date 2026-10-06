"""What the odpis job asked about each company, and what came of it.

`jobs.krs_odpis` keeps a record of every attempt it makes - which company, why,
how it ended - as gzipped jsonl parts in the shared cache, each written once
and never rewritten (`jobs.krs_odpis.log`). `KrsOdpisAttempts` folds them into
each company's newest attempt, the one that stands: whether the free odpis
came, whether the register has nothing under the number, or whether the
service would not give it.

The last is what the paid job buys rejestr.io's feeds for at night: where the
free odpis was asked for and did not come, and nowhere else
(`jobs.krs_scrape_paid`). The record's location and its statuses live here
rather than in the job, because a pipeline may not import a job and both sides
have to spell them the same.
"""

import gzip
import json
import typing
from dataclasses import asdict, dataclass
from datetime import datetime

import pandas as pd

from scrapers.krs.columns import padded_krs
from scrapers.krs.odpis_files import pad_krs
from scrapers.stores import CloudStorage, Context, Pipeline

RUN_BUCKET = "koryta-pl-sharedcache"
#: Where `jobs.krs_odpis` keeps its run record: one part per `FLUSH_EVERY`
#: attempts, `date=<Warsaw day>/<run>-<seq>.jsonl.gz`, one attempt per line.
RUN_LOG = CloudStorage(prefix="jobs/krs_odpis/runs/", bucket=RUN_BUCKET, binary=True)

# How an attempt ended, as the record spells it.
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
#: Neither the document nor an answer about the company: the free odpis failed.
#: `ABSENT` is not among them - the register has nothing under that number,
#: and rejestr.io, which copies the register, has nothing to sell either.
UNANSWERED = TRANSIENT | {FAILED}


@dataclass
class OdpisAttempt:
    """A company's newest attempt in the run record."""

    krs: str
    status: str
    #: When the attempt was recorded, Warsaw time, as the record has it.
    at: str
    #: Why the run asked: the queue's reason, "graph" or "krs_file".
    reason: str
    run: str
    #: 1, or 2 for the second pass a run gives what the network ate.
    attempt: int
    error: str | None = None


COLUMNS = list(OdpisAttempt.__dataclass_fields__)


def read_record(ctx: Context) -> typing.Iterator[dict[str, typing.Any]]:
    """Every attempt in `RUN_LOG`, part by part, as the job wrote it."""
    for ref in ctx.io.list_files(RUN_LOG):
        raw = ctx.io.read_data(ref).read_bytes()
        # "\n" only, as the register's log is read: `splitlines` also breaks
        # at the separators json.dumps leaves raw inside an error message.
        for line in gzip.decompress(raw).decode("utf-8").split("\n"):
            if line.strip():
                yield json.loads(line)


def newest_attempts(
    lines: typing.Iterable[dict[str, typing.Any]],
) -> list[OdpisAttempt]:
    """Each company's newest attempt, in KRS order.

    Compared as moments, not text: across a DST change the offsets differ.
    Within one second the second pass comes after the first, and otherwise the
    later line. A line whose time cannot be read is left out - it cannot say
    whether it is the newest.
    """
    newest: dict[str, tuple[tuple[datetime, int, int], OdpisAttempt]] = {}
    for order, line in enumerate(lines):
        try:
            at = datetime.fromisoformat(str(line["at"]))
            krs = pad_krs(line["krs"])
        except (KeyError, TypeError, ValueError):
            continue
        key = (at, int(line.get("attempt") or 1), order)
        seen = newest.get(krs)
        if seen is not None and seen[0] >= key:
            continue
        newest[krs] = (
            key,
            OdpisAttempt(
                krs=krs,
                status=str(line.get("status", "")),
                at=str(line["at"]),
                reason=str(line.get("reason", "")),
                run=str(line.get("run", "")),
                attempt=key[1],
                error=line.get("error"),
            ),
        )
    return [newest[krs][1] for krs in sorted(newest)]


def failed_odpis(attempts: pd.DataFrame | None) -> set[str]:
    """The companies whose newest attempt got no odpis and no answer."""
    if attempts is None or attempts.empty or "status" not in attempts:
        return set()
    failed = attempts[attempts["status"].isin(list(UNANSWERED))]
    return set(padded_krs(failed["krs"]))


class KrsOdpisAttempts(Pipeline[OdpisAttempt]):
    """Each company the odpis job has asked about, and how its newest try ended.

    A fold of `RUN_LOG` and nothing else. Nothing tells this pipeline the
    record has grown, so a run that needs tonight's attempts - the paid job -
    names it in its refresh policy, as the register's ledger is named.
    """

    filename = "krs_odpis_attempts"
    dtype = {"krs": str}
    #: Rebuilt from a few small parts whenever it is used, so a copy in the
    #: shared cache would only ever be out of date.
    backup_to_shared_cache = False

    @property
    def output_class(self):
        return OdpisAttempt

    def process(self, ctx: Context) -> pd.DataFrame:
        read = 0

        def counted() -> typing.Iterator[dict[str, typing.Any]]:
            nonlocal read
            for line in read_record(ctx):
                read += 1
                yield line

        attempts = newest_attempts(counted())
        df = pd.DataFrame([asdict(a) for a in attempts], columns=COLUMNS)
        counts = df["status"].value_counts().to_dict() if len(df) else {}
        print(f"Odpis run record: {read} attempts, {len(df)} companies {counts}")
        return df
