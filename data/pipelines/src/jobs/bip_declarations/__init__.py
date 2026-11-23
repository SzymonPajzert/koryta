"""BIP declarations job: cut the birth date out of the people mode's files, and
send the crops to the site's readers.

    koryta_bip_declarations cut --out ~/.cache/koryta/bip-people-crawl
    koryta_bip_declarations cut --out ... --limit 20      # twenty files, to look at
    koryta_bip_declarations upload --dry-run              # what would go; nothing sent
    koryta_bip_declarations upload                        # send what is new or changed
    koryta_bip_declarations sweep                         # publish from the queue
    koryta_bip_declarations status                        # where the declarations stand
    koryta_bip_declarations status --units-csv units.csv  # and every unit with no file
    koryta_bip_declarations facts-part                    # each candidacy's facts
    koryta_bip_declarations send-facts --dry-run          # what the night would send

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
`upload --public-post` sends only the people the site would publish from a
declaration: those with a paid post, current or ended, at a public company.

`sweep` publishes from the queue without sending anything. It calls
`/api/declarations/sweep`, which an upload calls once at its end and not at all
when it had nothing to send, until the day's limit is used, the site skips the
pass (the night window, a people import, the limit at 0) or a sweep takes up
nobody. A sweep takes up 25 pages at most, and each page it publishes takes a
slot of the day's limit; only „Opublikuj z kolejki” on /admin/oswiadczenia
goes past the limit.

`status` says where the declarations stand (`stats`): the candidacies found,
their files downloaded, cut, cropped and sent, by priority, and the units
(TERYT) where nothing came down for anybody. It only reads, so it runs beside
a cut or a crawl. On predator `cut` and `status` run through `cut.sh` and
`stats.sh` next to this file, which bring the crawl's Postgres, the
credentials for the night's list, and the cut's logs.

The site counts the declarations in people, for the home page,
/oswiadczenia/postep and /admin/oswiadczenia, and half of what it counts from
is here (`facts`). So `facts-part` writes what the crawl, the cut and the
upload did for each candidacy to the shared cache
(`stores.bip_declaration_facts`): after every crawl chunk (`run_chunk.sh`),
and on its own at the end of `cut` and of a real `upload`, where a part that
cannot be written is said and changes nothing else. It only reads Postgres.
The night's `declarations` step runs `send-facts`, which hands the newest part,
with the night's list, to the site (`/api/ingest/declarations/facts`).

Who the candidacies are - their page, whether it shows a birth date, the
priority - is the night's newest list (`jobs.bip_crawler.people_list`), read
by `cut`, `upload`, `status` and `facts-part` each run, so a draft the night
dated is priority 1 the morning after.

Exit codes: 0 when the work is done; 75 when a run stopped with work left (its
time ran out, the site did not answer, `sweep` ran out of sweeps or met the
night window or a people import) - the next run carries on - and when
`send-facts` has no part it can read yet, cannot read PESEL's tables, or the
site does not take the facts yet (404); 1 when the site refused a request, or
failed `send-facts`'s count with an error of its own (500, tried again); 130
when interrupted.
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
from typing import Any

from analysis.bip_people_of_interest import BipPeopleOfInterest
from conductor import setup_context
from jobs.bip_crawler import DEFAULT_OUT
from jobs.bip_crawler.people_list import list_policy, read_list
from jobs.bip_declarations.cutter import FileCut, Ocr, cut_file
from jobs.bip_declarations.facts import facts_summary, read_facts, site_rows
from jobs.bip_declarations.names import Names, read_names
from jobs.bip_declarations.stats import report, write_units_csv
from jobs.bip_declarations.upload import (
    DEFAULT_ENDPOINT,
    MAX_SWEEPS,
    ListTooOld,
    Site,
    SiteError,
    SiteUnavailable,
    plan,
    sweep,
    upload,
)
from scrapers.common.pg import PostgresClient
from scrapers.stores import (
    BipDeclarationStore,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    PersonRow,
)
from stores.bip_declaration_facts import FactsPart, newest_facts, write_facts
from stores.bip_declarations import PostgresBipDeclarationStore
from stores.koryta_login import TokenError, token_source
from stores.storage import Client, warsaw_tz

#: The cutter's version. Raising it cuts every file again; the site sees the
#: crops come from a new `tag` and keeps the pictures readers already answered.
CUT_VERSION = 1
TAG = f"bip-declarations-cut-{CUT_VERSION}"
EXIT_TRY_LATER = 75
EXIT_INTERRUPTED = 130
#: Where the site takes the facts it counts the declarations in people from.
FACTS_INGEST = "/api/ingest/declarations/facts"
#: The facts' one wait before a try again. Each try is a whole count on the
#: site, up to 5 minutes (`upload.Site`), so two tries, the wait and their
#: sign-ins end in under 12 minutes, inside the night's 15 for the step.
FACTS_BACKOFF_S = (30,)

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
    code = run_cut(
        store,
        Path(args.out).expanduser(),
        workers=args.workers,
        threads=args.threads,
        limit=args.limit,
        max_minutes=args.max_minutes,
    )
    if code != EXIT_INTERRUPTED:
        facts_after(store)
    return code


def cmd_upload(args: argparse.Namespace) -> int:
    store = store_with_list()
    priorities = set(args.priority) if args.priority else None
    if args.dry_run:
        try:
            candidacies, extracts = plan(
                store,
                priorities=priorities,
                sample=args.sample,
                public_post=args.public_post,
            )
        except ListTooOld as exc:
            print(f"cannot filter by public post: {exc}", file=sys.stderr)
            return 1
        outcomes = Counter(e.record["outcome"] for e in extracts)
        print(
            f"would send {len(candidacies)} candidacies and {len(extracts)} extracts "
            f"({dict(outcomes)}) to {args.endpoint}; sent nothing"
        )
        return 0
    code = run_upload(store, args, priorities)
    if code != EXIT_INTERRUPTED:
        facts_after(store)
    return code


def run_upload(
    store: BipDeclarationStore, args: argparse.Namespace, priorities: set[int] | None
) -> int:
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
            public_post=args.public_post,
        )
    except ListTooOld as exc:
        print(f"cannot filter by public post: {exc}", file=sys.stderr)
        return 1
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


#: Why a `sweep` run stopped with pages it could still have published.
SWEEP_LEFT = {"max_sweeps", "night", "import"}


def cmd_sweep(args: argparse.Namespace) -> int:
    try:
        site = Site(args.endpoint, token_source(args.endpoint))
        run = sweep(site, max_sweeps=args.max_sweeps)
    except SiteUnavailable as exc:
        print(f"the site did not answer: {exc}", file=sys.stderr)
        return EXIT_TRY_LATER
    except SiteError as exc:
        print(f"the site refused: {exc}", file=sys.stderr)
        return 1
    except TokenError as exc:
        print(f"no token for the site: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return EXIT_INTERRUPTED
    for person_id in run.published:
        print(f"{site.endpoint.rstrip('/')}/osoba/{person_id}")
    print(
        f"{run.sweeps} sweeps: published {len(run.published)}, put back "
        f"{len(run.restored)}, held {dict(run.held)}, already public "
        f"{run.confirmed}, failed {run.failed}; compared {run.checked} crops, "
        f"{run.changed} changed; stopped: {run.stopped}"
    )
    return EXIT_TRY_LATER if run.stopped in SWEEP_LEFT else 0


def cmd_status(args: argparse.Namespace) -> int:
    lines, empty = report(store_with_list(), version=CUT_VERSION, units=args.units)
    print("\n".join(lines))
    if args.units_csv:
        write_units_csv(args.units_csv, empty)
        print(f"\nwrote {len(empty):,} units to {args.units_csv}")
    return 0


def _why(exc: BaseException) -> str:
    return str(exc) or type(exc).__name__


def publish_facts(
    store: BipDeclarationStore, client: Client | None, now: datetime
) -> str | None:
    """Write each candidacy's facts as the newest part, and say what is in it;
    the part's gs:// path, or None for a dry run (no `client`)."""
    facts = read_facts(store, CUT_VERSION)
    print(f"declaration facts: {facts_summary(facts)}", flush=True)
    if client is None:
        return None
    url = write_facts(client, facts, now)
    print(f"declaration facts: wrote {url}", flush=True)
    return url


def facts_after(store: BipDeclarationStore) -> None:
    """A part after a cut or an upload, which change what the site counts.
    Best effort: a failure is said, and the command's exit code stands."""
    try:
        publish_facts(store, Client(), datetime.now(timezone.utc))
    except (Exception, KeyboardInterrupt) as exc:
        print(f"declaration facts: not written: {_why(exc)}", file=sys.stderr)


def cmd_facts_part(args: argparse.Namespace) -> int:
    pg = None
    try:
        ctx, _ = setup_context(policy=list_policy())
        people = read_list(ctx)
        pg = PostgresClient.from_env(max_size=1)
        # No DDL: it runs beside a crawl chunk or a cut.
        store = PostgresBipDeclarationStore(pg, people=people, create=False)
        client = None if args.dry_run else Client()
        publish_facts(store, client, datetime.now(timezone.utc))
    except Exception as exc:
        print(f"declaration facts: not written: {_why(exc)}", file=sys.stderr)
        return 1
    finally:
        if pg is not None:
            pg.close()
    return 0


def iso(at: datetime) -> str:
    """UTC with a Z, as zod's `datetime()` takes it."""
    return at.astimezone(timezone.utc).isoformat(timespec="milliseconds")[:-6] + "Z"


def list_built_at(client: Client) -> datetime | None:
    """When the list a restore takes now was built: its backup's `datetime=`,
    read as Warsaw time, the night's clock. None when that cannot be told;
    the site counts without it."""
    try:
        stamp = client.latest_backup_datetime(str(BipPeopleOfInterest.filename))
        return datetime.fromisoformat(stamp).replace(tzinfo=warsaw_tz)
    except Exception as exc:
        print(f"when the list was built: not known: {_why(exc)}", file=sys.stderr)
        return None


def answer_said(answer: dict[str, Any]) -> str:
    """The site's count in a line, and the reasons it did not know."""
    if "people" not in answer:
        return str(answer)
    stages = answer.get("stages") or {}
    said = f"{answer['people']} people: " + ", ".join(
        f"{stage} {count}" for stage, count in stages.items()
    )
    unknown = answer.get("unknownReasons") or {}
    if unknown:
        said += f"; reasons the site does not know, counted as pending: {unknown}"
    return said


def send_facts(
    site: Site | None,
    part: FactsPart,
    people: list[PersonRow],
    names: Names,
    *,
    list_at: datetime | None,
    now: datetime,
    force: bool = False,
) -> int:
    """Hand the site the part's facts with the list's people, for its count
    of the declarations in people. No `site` is a dry run."""
    built = site_rows(people, part.facts, names)
    print(
        f"facts of {len(part.facts):,} candidacies, {part.url}; "
        f"{len(built.rows):,} candidacies of the list with a page, "
        f"{built.not_in_part:,} of them not in the part (sent as pending)"
    )
    if built.unknown_status:
        print(f"statuses sent as pending: {dict(built.unknown_status)}")
    if built.left_out:
        print(f"left out {built.left_out:,} candidacies the site's contract refuses")
    if not built.rows:
        # A count of nobody would empty the site's.
        print("nobody on the list has a page; sending nothing", file=sys.stderr)
        return 1
    body: dict[str, Any] = {
        "generation": iso(now),
        "listAt": iso(list_at) if list_at else None,
        "part": part.url,
        "partAt": iso(part.written),
        "candidacies": built.rows,
    }
    if force:
        body["force"] = True
    if site is None:
        print("sent nothing (--dry-run)")
        return 0
    try:
        answer = site.post(FACTS_INGEST, body, backoff=FACTS_BACKOFF_S)
    except SiteUnavailable as exc:
        if exc.status == 500:
            # An error of the site's own after a try again, not an outage: a
            # bug the next night would repeat, so it fails the night.
            print(f"the site failed to count: {exc}", file=sys.stderr)
            return 1
        print(f"the site did not answer: {exc}", file=sys.stderr)
        return EXIT_TRY_LATER
    except SiteError as exc:
        if exc.status == 404:
            # The site's endpoint is not deployed yet: the next night tries.
            print(f"the site does not take the facts yet: {exc}", file=sys.stderr)
            return EXIT_TRY_LATER
        print(f"the site refused: {exc}", file=sys.stderr)
        return 1
    except TokenError as exc:
        print(f"no token for the site: {exc}", file=sys.stderr)
        return 1
    print(f"sent to {site.endpoint}: {answer_said(answer)}")
    return 0


def cmd_send_facts(args: argparse.Namespace) -> int:
    site = None
    if not args.dry_run:
        try:
            site = Site(args.endpoint, token_source(args.endpoint))
        except TokenError as exc:
            print(f"no token for the site: {exc}", file=sys.stderr)
            return 1
    # What the bucket or PESEL's tables did not give tonight, a later night
    # reads: a part that does not read waits for predator's next.
    try:
        client = Client()
        part = newest_facts(client)
    except Exception as exc:
        print(f"declaration facts: not read: {_why(exc)}", file=sys.stderr)
        return EXIT_TRY_LATER
    if part is None:
        print("no declaration facts from predator yet: sent nothing", file=sys.stderr)
        return EXIT_TRY_LATER
    ctx, _ = setup_context(policy=list_policy())
    try:
        people = read_list(ctx)
    except Exception as exc:
        print(f"no list of people of interest: {_why(exc)}", file=sys.stderr)
        return 1
    try:
        names = read_names(ctx)
    except Exception as exc:
        print(f"PESEL's name tables: not read: {_why(exc)}", file=sys.stderr)
        return EXIT_TRY_LATER
    return send_facts(
        site,
        part,
        people,
        names,
        list_at=list_built_at(client),
        now=datetime.now(timezone.utc),
        force=args.force,
    )


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
    send.add_argument(
        "--public-post",
        action="store_true",
        help="only the people whose page holds a paid post, current or ended, at "
        "a public company: the ones the site would publish from a declaration",
    )
    send.set_defaults(func=cmd_upload)
    drain = sub.add_parser(
        "sweep", help="publish from the queue up to the day's limit; send nothing"
    )
    drain.add_argument(
        "--endpoint", default=os.environ.get("KORYTA_ENDPOINT", DEFAULT_ENDPOINT)
    )
    drain.add_argument(
        "--max-sweeps",
        type=int,
        default=MAX_SWEEPS,
        help=f"stop after this many sweeps, 25 pages each at most (default: "
        f"{MAX_SWEEPS})",
    )
    drain.set_defaults(func=cmd_sweep)
    status = sub.add_parser(
        "status", help="where the declarations stand: found, downloaded, cut, sent"
    )
    status.add_argument(
        "--units",
        type=int,
        default=20,
        help="list this many of the biggest units nothing was downloaded in "
        "(default: 20)",
    )
    status.add_argument(
        "--units-csv", type=Path, help="write every such unit to this CSV file"
    )
    status.set_defaults(func=cmd_status)
    facts = sub.add_parser(
        "facts-part",
        help="write what the crawl, the cut and the upload did for each candidacy "
        "to the shared cache, for the night",
    )
    facts.add_argument(
        "--dry-run", action="store_true", help="count them; write nothing"
    )
    facts.set_defaults(func=cmd_facts_part)
    to_site = sub.add_parser(
        "send-facts",
        help="the night's step: the newest facts part, with the night's list, to "
        "the site, which counts the declarations in people",
    )
    to_site.add_argument(
        "--endpoint", default=os.environ.get("KORYTA_ENDPOINT", DEFAULT_ENDPOINT)
    )
    to_site.add_argument(
        "--dry-run", action="store_true", help="say what would go; send nothing"
    )
    to_site.add_argument(
        "--force",
        action="store_true",
        help="have the site take it even when it holds a newer count",
    )
    to_site.set_defaults(func=cmd_send_facts)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _args(argv)
    return int(args.func(args))
