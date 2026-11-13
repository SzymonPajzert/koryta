"""`koryta_scrape_bip sent`: what the declarations upload sent to the site from
the files stored for some candidacies, to withdraw when a fix takes the files
back.

    koryta_scrape_bip sent @reset-keys.txt                    # count and list
    koryta_scrape_bip sent @reset-keys.txt --csv withdraw.csv

A fix that stops crediting files (11-13: a menu's files, Łódź's lists of the
people obliged to file) resets the candidacies they were credited to
(`reset`); by then the declarations job (`jobs.bip_declarations`) may have cut
those files and sent the site extracts of them, which Szymon withdraws by
hand. Run it before the reset, while ``bip_poi_docs`` still holds the files:
it lists every extract sent of them (``bip_decl_sent``, kind "extract", id
"<sha256>-p<page>"; a crop of a page, or a file that gave none), with the name
read on the crop. It reads the crawl's Postgres and writes nothing there.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections.abc import Collection
from pathlib import Path
from typing import IO, Any

from scrapers.common.pg import PostgresClient

#: The extracts sent of the candidacies' stored files, a crop's name with each.
SENT = """
SELECT d.key, d.url, d.sha256, s.id, c.name, s.result, s.reason, s.sent_at
  FROM bip_poi_docs d
  JOIN bip_decl_sent s ON s.kind = 'extract' AND s.id LIKE d.sha256 || '-p%%'
  LEFT JOIN bip_decl_crops c
    ON c.sha256 = d.sha256 AND s.id = d.sha256 || '-p' || c.page
 WHERE d.key = ANY(%s) AND d.sha256 <> ''
 ORDER BY d.key, d.url, s.id
"""
COLUMNS = ("key", "url", "sha256", "extract", "name", "result", "reason", "sent_at")


def sent_extracts(pg: PostgresClient, keys: Collection[str]) -> list[dict[str, Any]]:
    """Every extract sent of the files stored for ``keys``, a row each."""
    rows = pg.fetchall(SENT, (sorted(set(keys)),))
    return [dict(zip(COLUMNS, row, strict=True)) for row in rows]


def report(rows: list[dict[str, Any]], keys: Collection[str], out: IO[str]) -> None:
    """How many went, and each: the candidacy, the file, the extract."""
    stored = [r for r in rows if r["result"] == "stored"]
    print(
        f"{len(rows)} extracts sent of the files of "
        f"{len({r['key'] for r in rows})} of {len(set(keys))} candidacies, "
        f"{len(stored)} of them stored on the site",
        file=out,
    )
    for r in rows:
        name = r["name"] or "-"
        print(
            f"  {r['key']}  {r['result']:8} {r['extract']}  {name}  {r['url']}",
            file=out,
        )


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, COLUMNS)
        writer.writeheader()
        for r in rows:
            sent_at = r["sent_at"]
            writer.writerow({**r, "sent_at": sent_at.isoformat() if sent_at else ""})


def cmd_sent(args: argparse.Namespace) -> int:
    pg = PostgresClient.from_env(max_size=1)
    try:
        rows = sent_extracts(pg, args.keys)
    finally:
        pg.close()
    report(rows, args.keys, sys.stdout)
    if args.csv is not None:
        write_csv(args.csv, rows)
        print(f"written to {args.csv}")
    return 0
