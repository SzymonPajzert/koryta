"""The register's jobs, as `clear-crawl-stamp-job-ends.ts` reads them.

Until 5fe9e12b (2026-05-05) `end_time()` in `scrapers/krs/list.py` gave every
post rejestr.io still listed as current the day PeopleKRS ran as its end. Two
runs of it reached the site: 1,044 `employed` edges on the 2026-10-14 export end
on 2026-04-06 (825) or 2026-03-18 (219), and most of those people still hold
the post. The migration in `frontend/scripts/migrate/clear-crawl-stamp-job-ends.ts`
puts back what the register says about each of them. This writes the register
it reads.

The register is `person_krs_combined` (`PeopleKRSCombined`): for each company,
the newer of rejestr.io's feeds and the odpis pełny, one row per post. It is
also what the night's people payloads are built from, so the migration and the
ingest read the same answer. Get it either way:

* restore the newest nightly backup - pass the tarball as it is, or the file
  inside it::

      prefix=gs://koryta-pl-sharedcache/filename=person_krs_combined/user=main
      gcloud storage ls $prefix/
      gcloud storage cp $prefix/datetime=<newest>/backup.tar.gz <dir>/

* or rebuild it, disarmed. That needs the mirror in `downloaded/` and the PESEL
  key; without the key it falls back to rejestr.io's rows alone::

      env -u GOOGLE_APPLICATION_CREDENTIALS DISABLE_BACKUP=1 \\
        .venv/bin/koryta PeopleKRSCombined --no-backup

  which leaves it in `versioned/person_krs_combined/`, the default input.

Then, from `data/pipelines`::

    .venv/bin/python -m scripts.register_job_ends [<input>] [--output <file>]

THE OUTPUT HOLDS PEOPLE'S NAMES AND BIRTH DATES, and the repository is public.
It goes to `~/.cache/koryta/crawl-stamps-<today>/register.jsonl` by default, and
the script refuses to write anywhere inside the repository.

One JSON object per line, with every field the migration matches on:
`krs` (ten digits), `entry` (who the row is about, below), `rejestrId`,
`fullName`, `firstName`, `lastName`, `birthDate`, `role`, `start`, `end`
(`null` where the register lists the post as current), `crawledOn` and
`source`. Dates are days, `YYYY-MM-DD`.

`entry` is the one register entry the row belongs to, because one entry is one
person and a name is not: the rejestr.io id where the row has one, otherwise a
digest of the PESEL fingerprint the odpis gave it (the fingerprint itself is
never written - `NEVER_SHOWN`), otherwise the name and birth date the odpis
printed. The migration matches a page with no rejestr.io link by name only
where the rows it finds belong to exactly one entry.
"""

import argparse
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import sys
import tarfile
import typing

from scrapers.krs.odpis_people import PeopleKRSCombined
from stores.config import PROJECT_ROOT, VERSIONED_DIR

#: Where a disarmed rebuild leaves the pipeline's output.
DEFAULT_INPUT = pathlib.Path(VERSIONED_DIR) / PeopleKRSCombined().output_path()

#: The repository's root: nothing derived from the register may be written
#: under it.
REPOSITORY = pathlib.Path(PROJECT_ROOT).resolve().parents[1]

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")


def default_output(today: datetime.date | None = None) -> pathlib.Path:
    """`~/.cache/koryta/crawl-stamps-<today>/register.jsonl`."""
    today = today or datetime.date.today()
    return (
        pathlib.Path.home()
        / ".cache"
        / "koryta"
        / f"crawl-stamps-{today.isoformat()}"
        / "register.jsonl"
    )


def inside_repository(path: pathlib.Path) -> bool:
    """Whether `path` would land in the (public) repository."""
    return path.resolve().is_relative_to(REPOSITORY)


def text(value: typing.Any) -> str | None:
    """A field as text, or None where the pipeline wrote nothing."""
    if value is None:
        return None
    if isinstance(value, float) and value != value:  # NaN off a frame
        return None
    value = str(value).strip()
    return value or None


def day(value: typing.Any) -> str | None:
    """A date field as `YYYY-MM-DD`, or None where it is not one."""
    value = text(value)
    if value is None or not DAY.match(value):
        return None
    return value[:10]


def entry_of(row: dict) -> str:
    """The one register entry a row of `person_krs_combined` belongs to."""
    rejestr_id = text(row.get("id"))
    if rejestr_id:
        return f"rejestr.io/{rejestr_id}"
    fingerprint = text(row.get("pesel_fingerprint"))
    if fingerprint:
        digest = hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        return f"odpis/{digest}"
    name = " ".join((text(row.get("full_name")) or "").upper().split())
    return f"odpis/{name}|{day(row.get('birth_date')) or ''}"


def register_row(row: dict) -> dict | None:
    """One post as the migration reads it, or None where it says too little
    to be matched to a job: no company, role or start day."""
    krs = text(row.get("employed_krs"))
    role = text(row.get("employed_role"))
    start = day(row.get("employed_start"))
    if not krs or not krs.isdigit() or not role or not start:
        return None
    return {
        "krs": krs.zfill(10),
        "entry": entry_of(row),
        "rejestrId": text(row.get("id")),
        "fullName": text(row.get("full_name")),
        "firstName": text(row.get("first_name")),
        "lastName": text(row.get("last_name")),
        "birthDate": day(row.get("birth_date")),
        "role": role,
        "start": start,
        "end": day(row.get("employed_end")),
        "crawledOn": day(row.get("crawled_on")),
        "source": text(row.get("source")),
    }


def read_lines(path: pathlib.Path) -> typing.Iterator[str]:
    """The NDJSON lines of the pipeline's output: the file itself, gzipped, or
    the nightly backup tarball with it inside."""
    if tarfile.is_tarfile(path):
        with tarfile.open(path) as archive:
            for member in archive:
                if not member.isfile() or member.name.endswith("metadata.json"):
                    continue
                stream = archive.extractfile(member)
                assert stream is not None, member.name
                for line in stream:
                    yield line.decode()
        return
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt") as lines:
        yield from lines


def convert(lines: typing.Iterable[str]) -> tuple[list[dict], int]:
    """The register rows, and how many input rows said too little to use."""
    rows: list[dict] = []
    skipped = 0
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        row = register_row(json.loads(line))
        if row is None:
            skipped += 1
        else:
            rows.append(row)
    return rows, skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "input",
        nargs="?",
        type=pathlib.Path,
        default=DEFAULT_INPUT,
        help="person_krs_combined: the NDJSON, or the nightly backup.tar.gz",
    )
    parser.add_argument("--output", type=pathlib.Path, default=None)
    args = parser.parse_args(argv)

    output: pathlib.Path = args.output or default_output()
    if inside_repository(output):
        print(
            f"Refusing to write {output}: it is inside the repository, which "
            "is public, and the register names people.",
            file=sys.stderr,
        )
        return 2
    if not args.input.exists():
        print(
            f"No {args.input}. Restore the nightly backup or rebuild "
            "PeopleKRSCombined first; see this script's docstring.",
            file=sys.stderr,
        )
        return 1

    rows, skipped = convert(read_lines(args.input))
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as out:
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    crawled = sorted(row["crawledOn"] for row in rows if row["crawledOn"])
    current = sum(1 for row in rows if row["end"] is None)
    print(f"Read {args.input}")
    print(
        f"Wrote {len(rows):,} posts to {output}: {current:,} current, "
        f"{len({row['krs'] for row in rows}):,} companies, "
        f"{len({row['entry'] for row in rows}):,} register entries; "
        f"{skipped:,} rows without a company, role or start left out."
    )
    if crawled:
        print(f"Crawled {crawled[0]} to {crawled[-1]}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
