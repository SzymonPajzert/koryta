"""`koryta_scrape_bip reset`: send candidacies back to pending, so the next
chunk of the people mode searches them again.

    koryta_scrape_bip reset @unfound-keys.txt --dry-run       # count; delete nothing
    koryta_scrape_bip reset @unfound-keys.txt --backup reset-2026-11-13.json
    koryta_scrape_bip reset 375ceea1ffc18388,81a893b14698da7a --backup b.json

A candidacy with no ``bip_poi`` row is pending (`stores.bip_people`): reset
deletes the candidacies' ``bip_poi`` rows and the rows of the files tried for
them (``bip_poi_docs``), nothing else; the files stay in ``bip_docs`` and their
bundles. A fix that takes back what the crawl credited (11-13: a menu's files
stored as a councillor's declarations) needs its candidacies searched again.

Every row it deletes is first written to --backup, a JSON file it creates and
never writes over, flushed to disk before the delete, which is one
transaction. It refuses while a crawl holds the crawl's folder (its
``.crawl.lock``, as `single_crawler` takes it) and holds it itself until done,
so no chunk starts halfway. Run it on the crawl's machine, between chunks.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Collection
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from scrapers.common.pg import PostgresClient
from stores.bip_people import RESET_TABLES, PostgresBipPeopleStore, read_reset_rows


def _plain(value: object) -> object:
    """A value of a row as JSON holds it: a time as ISO 8601."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, memoryview)):
        return bytes(value).hex()
    return str(value)


def write_backup(
    path: Path, keys: Collection[str], rows: dict[str, list[dict[str, Any]]]
) -> None:
    """``rows`` in a new file at ``path``, on disk when this returns."""
    backup = {
        "made_at": datetime.now(timezone.utc).isoformat(),
        "keys": sorted(set(keys)),
        "tables": rows,
    }
    with path.open("x", encoding="utf-8") as handle:
        json.dump(backup, handle, ensure_ascii=False, indent=1, default=_plain)
        handle.flush()
        os.fsync(handle.fileno())


def _counts(rows: dict[str, list[dict[str, Any]]]) -> str:
    return ", ".join(f"{len(rows[table])} {table}" for table in RESET_TABLES)


def reset_candidacies(
    pg: PostgresClient,
    keys: Collection[str],
    *,
    out: Path,
    backup: Path | None,
    dry_run: bool = False,
) -> dict[str, int]:
    """Delete the rows of ``keys`` (`stores.bip_people.RESET_TABLES`), or with
    ``dry_run`` count them; how many went (or would), by table."""
    # Here, not above: the package imports this module.
    from jobs.bip_crawler import single_crawler  # noqa: PLC0415

    keys = sorted(set(keys))
    if not keys:
        raise SystemExit("no candidacy keys given")
    if dry_run:
        rows = read_reset_rows(pg, keys)
        owners = {row["key"] for table in RESET_TABLES for row in rows[table]}
        print(
            f"would reset {len(owners)} of {len(keys)} candidacies: {_counts(rows)}"
            "; nothing deleted"
        )
        return {table: len(rows[table]) for table in RESET_TABLES}
    if backup is None:
        raise SystemExit("reset deletes rows: give --backup FILE (or --dry-run)")
    if backup.exists():
        raise SystemExit(f"{backup} exists; give a new file for the backup")
    if not (out / ".crawl.lock").exists():
        raise SystemExit(
            f"{out} is no crawl's folder (no .crawl.lock); give the crawl's --out"
        )
    with single_crawler(out, refusal=f"a crawl holds {out}; reset between chunks"):
        store = PostgresBipPeopleStore(pg)
        deleted = store.reset(keys, lambda rows: write_backup(backup, keys, rows))
    print(
        f"reset {len(keys)} candidacies: deleted "
        + ", ".join(f"{deleted[table]} {table}" for table in RESET_TABLES)
        + f"; every row is in {backup}"
    )
    return deleted


def cmd_reset(args: argparse.Namespace) -> int:
    if not args.dry_run and args.backup is None:
        raise SystemExit("reset deletes rows: give --backup FILE (or --dry-run)")
    pg = PostgresClient.from_env(max_size=1)
    try:
        reset_candidacies(
            pg, args.keys, out=args.out, backup=args.backup, dry_run=args.dry_run
        )
    finally:
        pg.close()
    return 0
