"""`koryta_scrape_bip found`: hand the night the people the people mode found
an oświadczenie majątkowe for.

    koryta_scrape_bip found             # write the list to the shared cache
    koryta_scrape_bip found --dry-run   # count it; write nothing

Every candidacy the people mode settled as found, as one part under
`stores.bip_found.FOUND_PREFIX`, which the night's people step reads for its
declaration groups (`entities.priority_groups.DECLARATION_GROUPS`). Run on the
crawl's machine, beside its Postgres, after a chunk: the night reads the
newest part, so a run before 04:30 is what it sends by.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone

from scrapers.common.pg import PostgresClient
from scrapers.stores import BipPeopleStore
from stores.bip_found import ids, write_found
from stores.bip_people import PostgresBipPeopleStore
from stores.storage import Client


def publish_found(
    store: BipPeopleStore,
    client: Client | None,
    now: datetime,
) -> str | None:
    """Write what `store` found as the newest part, and say how much of it
    there is; the part's gs:// path, or None for a dry run (no `client`)."""
    rows = store.found()
    by_priority = Counter(row.priority for row in rows)
    registers = {i for row in rows for i in ids(row.person.get("rejestrio_ids"))}
    print(
        f"Found a declaration for {len(rows)} candidacies, "
        f"{len(registers)} rejestr.io entries; by priority "
        f"{dict(sorted(by_priority.items()))}"
    )
    if client is None:
        return None
    url = write_found(client, rows, now)
    print(f"Wrote {url}")
    return url


def add_parser(sub: argparse._SubParsersAction) -> None:
    found = sub.add_parser(
        "found",
        help="write the candidacies the people mode found a declaration for "
        "to the shared cache, for the night's declaration groups",
    )
    found.add_argument(
        "--dry-run", action="store_true", help="count them; write nothing"
    )
    found.set_defaults(func=cmd_found)


def cmd_found(args: argparse.Namespace) -> int:
    pg = PostgresClient.from_env(max_size=1)
    try:
        publish_found(
            PostgresBipPeopleStore(pg),
            None if args.dry_run else Client(),
            datetime.now(timezone.utc),
        )
    finally:
        pg.close()
    return 0
