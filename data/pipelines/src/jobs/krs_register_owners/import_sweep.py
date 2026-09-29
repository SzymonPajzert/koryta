"""One-off: the register sweep of 2026-09-28, written as the job's log.

Before this job existed, a scratch script asked api-krs about 25,152 KRS
numbers picked for being likely public: the 16,833 CRU suppliers resolved to a
KRS number, the 6,636 companies crawled feeds name but nobody fetched an odpis
for, a 1,750-entry random sample of the bulletin, and Zabrzańska Agencja
Realizacji Inwestycji. Its answers are frozen in
~/.cache/koryta/krs-sweep-frozen-2026-09-29: raw/<krs>.<P|S>.json.gz for each
odpis, and the *_out*.jsonl files recording every answer, 204s and failures
included. Starting the log from them saves the reads, and more than that the
targeting: the job reads the bulletin in number order, which reaches most of
what that sweep found only after ~600k reads.

    python -m jobs.krs_register_owners.import_sweep --to-dir /tmp/register-log \\
        --verify ~/.cache/koryta/krs-sweep-frozen-2026-09-29/krs_register_owners.jsonl
    python -m jobs.krs_register_owners.import_sweep --to-bucket

`--verify` folds the parts it wrote back into a ledger and compares it, byte for
byte, with the one the sweep's own script built. Writing to the bucket is
permanent from predator, whose service account cannot delete, so verify into a
directory first.
"""

import argparse
import gzip
import hashlib
import json
import os
from collections.abc import Iterator
from dataclasses import asdict
from datetime import datetime
from functools import partial

import pandas as pd

from jobs.krs_register_owners.log import ResponseLog
from scrapers.krs.register import (
    COLUMNS,
    RESPONSE_LOG,
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    RegisterRead,
    fold,
)
from stores.storage import Client, warsaw_tz

SWEEP_DIR = os.path.expanduser("~/.cache/koryta/krs-sweep-frozen-2026-09-29")
RUN = "sweep-2026-09-28"

#: Every answer file, and the day its reads were made. A 204 or a failure
#: carries no timestamp of its own; an odpis does, in its header.
READS = {
    **{
        name: "2026-09-28"
        for name in [
            "sample_out.jsonl",
            "cru_out.jsonl",
            "cru_out1.jsonl",
            "cru_out2.jsonl",
            "cru_outr0.jsonl",
            "cru_outr1.jsonl",
            "cru_outr2.jsonl",
            "known_out.jsonl",
            "known_outr0.jsonl",
            "known_outr1.jsonl",
        ]
    },
    "retry_out.jsonl": "2026-09-29",
    "probe_out.jsonl": "2026-09-29",
}


def odpis_time(body: dict) -> str | None:
    """When api-krs made the extract: "28.09.2026 16:41:18", Warsaw time."""
    stamp = ((body.get("odpis") or {}).get("naglowekA") or {}).get("dataCzasOdpisu")
    if not stamp:
        return None
    moment = datetime.strptime(stamp, "%d.%m.%Y %H:%M:%S").replace(tzinfo=warsaw_tz)
    return moment.isoformat(timespec="seconds")


def sweep_reads(sweep_dir: str = SWEEP_DIR) -> Iterator[RegisterRead]:
    for name, day in READS.items():
        midnight = datetime.fromisoformat(day).replace(tzinfo=warsaw_tz)
        undated = midnight.isoformat(timespec="seconds")
        with open(os.path.join(sweep_dir, name)) as f:
            for line in f:
                row = json.loads(line)
                krs, rejestr = row["krs"], row.get("rejestr")
                if row.get("no_content"):
                    yield RegisterRead(
                        krs, undated, STATUS_STRUCK_OFF, rejestr, run=RUN
                    )
                elif row.get("not_found"):
                    yield RegisterRead(krs, undated, STATUS_NOT_FOUND, run=RUN)
                elif row.get("fetch_error") or row.get("parse_error"):
                    error = json.dumps(row.get("fetch_error") or row.get("parse_error"))
                    yield RegisterRead(
                        krs, undated, STATUS_FAILED, rejestr, error=error, run=RUN
                    )
                else:
                    raw = os.path.join(sweep_dir, "raw", f"{krs}.{rejestr}.json.gz")
                    with gzip.open(raw, "rt") as body_file:
                        body = json.load(body_file)
                    read_at = odpis_time(body) or undated
                    yield RegisterRead(krs, read_at, STATUS_OK, rejestr, body, run=RUN)


def put_in_dir(root: str, name: str, data: bytes) -> str:
    path = os.path.join(root, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "xb") as f:  # write-once, as the bucket is
        f.write(data)
    return path


def reads_in_dir(root: str) -> Iterator[RegisterRead]:
    for folder, _, files in sorted(os.walk(root)):
        for name in sorted(files):
            with open(os.path.join(folder, name), "rb") as f:
                for line in gzip.decompress(f.read()).decode("utf-8").split("\n"):
                    if line.strip():
                        yield RegisterRead.from_line(line)


def ledger_bytes(entries) -> bytes:
    """A ledger serialised the way a pipeline writes its output."""
    df = pd.DataFrame([asdict(e) for e in entries], columns=COLUMNS)
    return df.to_json(orient="records", lines=True).encode("utf-8")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--to-dir", help="Write the parts under this directory.")
    where.add_argument(
        "--to-bucket",
        action="store_true",
        help=f"Write the parts to gs://{RESPONSE_LOG.bucket}/{RESPONSE_LOG.prefix}.",
    )
    parser.add_argument("--sweep-dir", default=SWEEP_DIR)
    parser.add_argument(
        "--verify",
        help="With --to-dir: fold the parts written and compare with this ledger.",
    )
    args = parser.parse_args(argv)

    if args.to_dir:
        put = partial(put_in_dir, args.to_dir)
    else:
        assert RESPONSE_LOG.bucket is not None
        put = partial(
            Client().create_object, RESPONSE_LOG.bucket, content_type="application/gzip"
        )
    log = ResponseLog(put, RUN)
    for read in sweep_reads(args.sweep_dir):
        log.add(read)
    log.flush()
    print(f"{log.reads_written} reads in {len(log.written)} parts")

    if args.verify and args.to_dir:
        rebuilt = ledger_bytes(fold(reads_in_dir(args.to_dir)))
        with open(args.verify, "rb") as f:
            expected = f.read()
        same = rebuilt == expected
        print(
            f"folded ledger sha256 {hashlib.sha256(rebuilt).hexdigest()}, "
            f"expected {hashlib.sha256(expected).hexdigest()}: "
            + ("identical" if same else "DIFFERENT")
        )
        return 0 if same else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
