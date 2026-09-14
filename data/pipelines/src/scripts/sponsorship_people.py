"""Everyone on the boards of the sponsorship recipients, from both channels.

Two sets of companies arrive by different routes and both are needed.

* The **254** the Ministry of Finance's wykaz resolved were read from their
  *odpis pełny* PDFs -- `versioned/krs_odpis_people/krs_odpis_people.jsonl`,
  6,281 people, with a PESEL-derived birth date and every struck-out
  predecessor.
* The **280** the wykaz could not see were resolved through the register's own
  search and their connections bought from rejestr.io. Those land in the crawl
  bucket as ``hostname=rejestr.io/.../krs-powiazania/aktualnosc_{aktualne,
  historyczne}``, and this reads them with the repo's own `posts_held`, so a
  role here means what it means in `PeopleKRS`.

The two disagree about what "former" means and it is worth being explicit. An
odpis pełny marks a struck-out row, so a former board member is a row with
``wykr.`` set. rejestr.io splits the same fact across two *requests* --
`aktualne` and `historyczne` -- so which file a person came out of is what says
whether they still sit. Both end up as `current` here.

    uv run python src/scripts/sponsorship_people.py --out /tmp/people.jsonl

Nothing is fetched: both inputs are already on disk or in the bucket.
"""

import argparse
import collections
import json
import sys
from pathlib import Path

from conductor import setup_context
from scrapers.krs import sponsorship_nips
from scrapers.krs.list import posts_held
from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile
from stores.config import VERSIONED_DIR

VERSIONED = Path(VERSIONED_DIR)

#: `scrapers.krs.list.PERSON_TYPES`, restated rather than imported so that a
#: change there is a visible conflict here instead of a silent shift in who
#: this counts.
PERSON_TYPES = frozenset({"osoba", "osoba-bez-pesel"})

_CONNECTION_SEGMENT = "/krs-powiazania/aktualnosc_"


def newest_connection_blobs(ctx: Context) -> dict[tuple[str, str], DownloadableFile]:
    """The latest crawl of each (KRS, aktualnosc), so a re-crawl is not counted
    twice as two spells for the same person."""
    newest: dict[tuple[str, str], tuple[str, DownloadableFile]] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io")):
        if not isinstance(ref, DownloadableFile) or _CONNECTION_SEGMENT not in ref.url:
            continue
        head, _, tail = ref.url.partition(_CONNECTION_SEGMENT)
        krs = "".join(c for c in head.rsplit("/", 1)[-1] if c.isdigit())
        parts = tail.split("/date=")
        if len(parts) != 2 or not krs:
            continue
        which, stamp = parts[0], parts[1]
        key = (krs.rjust(10, "0"), which)
        if key in newest and newest[key][0] >= stamp:
            continue
        newest[key] = (stamp, ref)
    return {key: ref for key, (_, ref) in newest.items()}


def people_from_connections(
    ctx: Context, wanted_krs: dict[str, str]
) -> list[dict]:
    """People rejestr.io lists for these companies, one row per post held.

    `wanted_krs` maps KRS to the company's name, which rejestr.io's connection
    list does not carry -- it is a list of people, not of the company.
    """
    blobs = newest_connection_blobs(ctx)
    rows: list[dict] = []
    for (krs, which), ref in sorted(blobs.items()):
        if krs not in wanted_krs:
            continue
        body = ctx.io.read_data(ref).read_string()
        if not body:
            continue
        try:
            entries = json.loads(body)
        except json.JSONDecodeError:
            continue
        if not isinstance(entries, list):
            continue
        for item in entries:
            if not isinstance(item, dict) or item.get("typ") not in PERSON_TYPES:
                continue
            identity = item.get("tozsamosc") or {}
            for post in posts_held(item):
                rows.append(
                    {
                        "source": "rejestrio",
                        "krs": krs,
                        "company_name": wanted_krs[krs],
                        "rejestrio_id": str(item.get("id") or ""),
                        "given_names": " ".join(
                            p
                            for p in (
                                identity.get("imie"),
                                identity.get("drugie_imiona"),
                            )
                            if p
                        ),
                        "surname": identity.get("nazwisko") or "",
                        "full_name": identity.get("imiona_i_nazwisko") or "",
                        "birth_date": identity.get("data_urodzenia"),
                        "sex": identity.get("plec"),
                        "role": post.role,
                        "funkcja": post.role,
                        # Which request it came out of is what says whether the
                        # person still sits; an odpis says it per row instead.
                        "current": which == "aktualne",
                        "employed_start": post.start,
                        "employed_end": post.end,
                    }
                )
    return rows


def people_from_odpisy(path: Path) -> list[dict]:
    if not path.is_file():
        print(f"[skip] no odpis artifact at {path}", file=sys.stderr)
        return []
    rows = []
    for line in path.open(encoding="utf-8"):
        row = json.loads(line)
        row["source"] = "odpis"
        rows.append(row)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", help="write the merged people here as JSONL")
    parser.add_argument(
        "--odpis",
        default=str(VERSIONED / "krs_odpis_people" / "krs_odpis_people.jsonl"),
    )
    args = parser.parse_args()

    ctx, _ = setup_context()

    # The 280 the search resolved, with the name the spreadsheet gave them.
    from scripts.sponsorship_rejestrio import (  # noqa: PLC0415
        _mapping,
        cached_answers,
    )

    by_nip = {r.nip: r for r in sponsorship_nips.UNRESOLVED}
    mapping = _mapping(cached_answers(ctx), sponsorship_nips.UNRESOLVED)
    wanted = {krs: by_nip[nip].name for nip, krs in mapping.items()}
    print(f"companies resolved through the register's search: {len(wanted)}")

    from_rejestrio = people_from_connections(ctx, wanted)
    from_odpis = people_from_odpisy(Path(args.odpis))

    print(f"people from rejestr.io connections: {len(from_rejestrio):>7,}")
    print(f"people from odpis pelny PDFs      : {len(from_odpis):>7,}")

    rows = from_odpis + from_rejestrio
    companies = {r["krs"] for r in rows}
    sitting = sum(1 for r in rows if r.get("current"))
    dated = sum(1 for r in rows if r.get("birth_date"))
    print(f"\nmerged: {len(rows):,} rows over {len(companies):,} companies")
    print(f"  sitting            {sitting:>8,}")
    print(f"  former             {len(rows) - sitting:>8,}")
    print(f"  with a birth date  {dated:>8,}  ({dated / len(rows):.1%})")
    print(f"  by source: {dict(collections.Counter(r['source'] for r in rows))}")
    roles = collections.Counter(r["role"] for r in rows).most_common(8)
    print(f"  by role:   {dict(roles)}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"\nwrote {len(rows):,} rows to {args.out}")


if __name__ == "__main__":
    main()
