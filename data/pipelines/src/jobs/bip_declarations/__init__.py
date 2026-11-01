"""BIP declarations job: cut the birth date out of the people mode's files, and
send the crops to the site's readers.

    koryta_bip_declarations cut --out ~/.cache/koryta/bip-people-crawl
    koryta_bip_declarations cut --out ... --limit 20      # twenty files, to look at
    koryta_bip_declarations upload --dry-run              # what would go; nothing sent
    koryta_bip_declarations upload                        # send what is new or changed
    koryta_bip_declarations status                        # what is cut and sent

The crawler's people mode (`koryta_scrape_bip crawl --people-of-interest`)
downloads the oświadczenia majątkowe of every won local candidacy it finds, into
its bundles and Postgres. This job reads the same Postgres (`POSTGRES_*`, as
the crawler) and the same bundles (`--out`, the crawler's), and runs beside it.

`cut` reads each file not cut yet and cuts the date's line and the name's line
out of it (`cutter`), the files of people on the site first. Its tables are its
own (`stores.bip_declarations`): a file once cut is not read again until the
cutter's version changes, so a run stopped anywhere loses only the files in hand.

`upload` sends the site what it lacks or what changed since the last upload:
every candidacy with a page on the site, and the crops of their files (`upload`).
Readers on /oswiadczenia then type the dates in; a typed date the job read from
a PDF's text layer inside the candidacy's PKW window settles without them.
`upload --priority 1 --sample 100` is a test run: a hundred crops not sent yet
of drafts whose page has a birth date, and only the candidacies they serve.

Who the candidacies are - their page, whether it shows a birth date, the
priority - is the night's newest list (`jobs.bip_crawler.people_list`), read
by `cut` and `upload` each run, so a draft the night dated is priority 1 the
morning after.

Exit codes: 0 when the work is done; 75 when a run stopped with work left (its
time ran out, the site did not answer) - the next run carries on; 1 when the
site refused a request; 130 when interrupted.
"""

from __future__ import annotations

import argparse
import hashlib
import multiprocessing
import os
import sys
import tarfile
import time
from collections import Counter
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from conductor import setup_context
from jobs.bip_crawler import DEFAULT_OUT
from jobs.bip_crawler.people_list import list_policy, read_list
from jobs.bip_declarations.cutter import FileCut, Ocr, cut_file
from jobs.bip_declarations.upload import (
    DEFAULT_ENDPOINT,
    Site,
    SiteError,
    SiteUnavailable,
    plan,
    upload,
)
from scrapers.common.pg import PostgresClient
from scrapers.stores import (
    BipDeclarationStore,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
)
from stores.bip_declarations import PostgresBipDeclarationStore
from stores.koryta_login import token_source

#: The cutter's version. Raising it cuts every file again; the site sees the
#: crops come from a new `tag` and keeps the pictures readers already answered.
CUT_VERSION = 1
TAG = f"bip-declarations-cut-{CUT_VERSION}"
EXIT_TRY_LATER = 75
EXIT_INTERRUPTED = 130

_ocr: Ocr | None = None


def read_blob(root: Path, file: DeclarationFile) -> bytes | None:
    """The file's bytes from its bundle, checked against its sha256; None when
    the bundle is not on disk (yet: the crawler seals a host's at its unit's end)."""
    path = root / file.bundle
    if not path.is_file():
        return None
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile() or member.name == "index.txt":
                continue
            handle = tar.extractfile(member)
            data = handle.read() if handle else b""
            # A member is named after its URL's file name, which two URLs can
            # share: the hash is what names the file.
            if hashlib.sha256(data).hexdigest() == file.sha256:
                return data
    return None


def _init_worker(threads: int) -> None:
    global _ocr
    _ocr = Ocr(threads)


def cut_one(
    job: tuple[str, DeclarationFile],
) -> tuple[DeclarationCutRow, list[DeclarationCropRow]]:
    """Cut one file: what the worker processes run."""
    root, file = job
    started = time.monotonic()
    data = read_blob(Path(root), file)
    if data is None:
        return DeclarationCutRow(file.sha256, CUT_VERSION, "no_file"), []
    result: FileCut = cut_file(data, file.url, _ocr or Ocr(), council=file.council)
    seconds = round(time.monotonic() - started, 1)
    cut = DeclarationCutRow(
        file.sha256,
        CUT_VERSION,
        result.status,
        result.kind,
        result.pages,
        result.pages_read,
        seconds,
        result.error,
    )
    crops = [
        DeclarationCropRow(
            file.sha256,
            c.page,
            c.rotation,
            c.sort,
            c.birth_date,
            c.score,
            c.name,
            c.declaration_year,
            c.date_png,
            c.name_png,
            notes="; ".join(c.notes),
        )
        for c in result.crops
    ]
    return cut, crops


def run_cut(
    store: BipDeclarationStore,
    root: Path,
    *,
    workers: int,
    threads: int,
    limit: int | None,
    max_minutes: float | None,
) -> int:
    files = store.files_to_cut(CUT_VERSION, limit)
    print(
        f"to cut: {len(files)} files ({sum(f.council for f in files)} councils')",
        flush=True,
    )
    if not files:
        return 0
    deadline = time.monotonic() + max_minutes * 60 if max_minutes else None
    jobs = [(str(root), file) for file in files]
    counts: Counter[str] = Counter()
    sorts: Counter[str] = Counter()
    stopped = False
    results: Iterator[tuple[DeclarationCutRow, list[DeclarationCropRow]]]
    if workers <= 1:
        _init_worker(threads)
        results = map(cut_one, jobs)
        pool = None
    else:
        # Spawned, not forked: the parent holds a Postgres pool's threads.
        pool = multiprocessing.get_context("spawn").Pool(
            workers, initializer=_init_worker, initargs=(threads,)
        )
        results = pool.imap_unordered(cut_one, jobs)
    try:
        for done, (cut, crops) in enumerate(results, 1):
            if cut.status != "no_file":
                store.record_cut(cut, crops)
            counts[cut.status] += 1
            sorts.update(c.sort for c in crops)
            print(
                f"{done}/{len(files)} {cut.sha256[:12]} {cut.kind:5} "
                f"{cut.status:12} {len(crops)} crops, "
                f"{cut.pages_read}/{cut.pages} pages, {cut.seconds}s",
                flush=True,
            )
            if deadline is not None and time.monotonic() > deadline:
                stopped = True
                break
    except KeyboardInterrupt:
        print("interrupted", flush=True)
        return EXIT_INTERRUPTED
    finally:
        if pool is not None:
            pool.terminate()
    print(f"files: {dict(counts)}; crops: {dict(sorts)}", flush=True)
    if counts["no_file"]:
        print(
            f"{counts['no_file']} files' bundles are not on disk under {root}",
            flush=True,
        )
    return EXIT_TRY_LATER if stopped else 0


def store_with_list() -> PostgresBipDeclarationStore:
    """The job's store, handed the night's newest list of people of interest."""
    ctx, _ = setup_context(policy=list_policy())
    return PostgresBipDeclarationStore(
        PostgresClient.from_env(max_size=2), people=read_list(ctx)
    )


def cmd_cut(args: argparse.Namespace) -> int:
    store = store_with_list()
    return run_cut(
        store,
        Path(args.out).expanduser(),
        workers=args.workers,
        threads=args.threads,
        limit=args.limit,
        max_minutes=args.max_minutes,
    )


def cmd_upload(args: argparse.Namespace) -> int:
    store = store_with_list()
    priorities = set(args.priority) if args.priority else None
    if args.dry_run:
        candidacies, extracts = plan(store, priorities=priorities, sample=args.sample)
        outcomes = Counter(e.record["outcome"] for e in extracts)
        print(
            f"would send {len(candidacies)} candidacies and {len(extracts)} extracts "
            f"({dict(outcomes)}) to {args.endpoint}; sent nothing"
        )
        return 0
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    site = Site(args.endpoint, token_source(args.endpoint))
    try:
        result = upload(
            store,
            site,
            tag=TAG,
            run_id=run_id,
            max_requests=args.max_requests,
            priorities=priorities,
            sample=args.sample,
        )
    except SiteUnavailable as exc:
        print(f"the site did not answer: {exc}", file=sys.stderr)
        return EXIT_TRY_LATER
    except SiteError as exc:
        print(f"the site refused: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return EXIT_INTERRUPTED
    print(
        f"sent in {result.requests} requests: candidacies {dict(result.candidacies)}, "
        f"extracts {dict(result.extracts)}; sweep: {result.sweep}"
    )
    left = args.max_requests is not None and result.requests >= args.max_requests
    return EXIT_TRY_LATER if left else 0


def cmd_status(args: argparse.Namespace) -> int:
    store = PostgresBipDeclarationStore(PostgresClient.from_env(max_size=2))
    cuts = store.cuts()
    crops = store.crops()
    print(f"files cut: {len(cuts)} {dict(Counter(c.status for c in cuts.values()))}")
    print(f"crops: {len(crops)} {dict(Counter(c.sort for c in crops))}")
    for kind in ("candidacy", "extract"):
        sent = store.sent(kind).values()
        answers = Counter(s.reason or s.result for s in sent)
        print(f"{kind} sent: {len(sent)} {dict(answers)}")
    return 0


def _args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="koryta_bip_declarations", description=__doc__.split("\n")[0]
    )
    sub = parser.add_subparsers(dest="command", required=True)
    cut = sub.add_parser("cut", help="cut the files not cut yet")
    cut.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="the crawler's --out, where its bundles are",
    )
    cut.add_argument(
        "--workers", type=int, default=4, help="processes cutting at once (default: 4)"
    )
    cut.add_argument(
        "--threads", type=int, default=2, help="OCR threads in each (default: 2)"
    )
    cut.add_argument("--limit", type=int, help="cut at most this many files")
    cut.add_argument("--max-minutes", type=float, help="stop after this long (exit 75)")
    cut.set_defaults(func=cmd_cut)
    send = sub.add_parser("upload", help="send the site what is new or changed")
    send.add_argument(
        "--endpoint", default=os.environ.get("KORYTA_ENDPOINT", DEFAULT_ENDPOINT)
    )
    send.add_argument(
        "--dry-run", action="store_true", help="say what would go; send nothing"
    )
    send.add_argument(
        "--max-requests", type=int, help="stop after this many requests (exit 75)"
    )
    send.add_argument(
        "--priority",
        type=int,
        action="append",
        choices=(0, 1, 3),
        help="only the candidacies the night's list ranks so: 0 a draft without a "
        "birth date, 1 a draft with one, 3 a published page (repeat for more)",
    )
    send.add_argument(
        "--sample",
        type=int,
        metavar="N",
        help="a test run: N crops not sent yet, and only the candidacies they serve",
    )
    send.set_defaults(func=cmd_upload)
    status = sub.add_parser("status", help="what is cut and sent")
    status.set_defaults(func=cmd_status)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _args(argv)
    return int(args.func(args))
