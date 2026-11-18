"""Each region's „Władze” from PKW's 2024 local results, for the region pages.

`frontend/scripts/migrate/seed-region-authorities.ts` fills `Region.authorities`
(frontend/shared/model.ts) from this file: who won each council's seats, and
the wójt, burmistrz or prezydent, by name. Szymon, 2026-11-18, of the people
who won without a page on the site: "they should just be listed for the
information", in a record "filled by PKW" that contributors correct after.

One JSON object keyed by the id of the region node the result belongs to:

    {"teryt1005011": {"election": "local-2024",
                      "head": {"office": "Burmistrz", "name": "...", ...},
                      "councils": [{"office": "Rada miasta", "seats": 21,
                                    "members": [{"name": "...", ...}]}]}}

- A sejmik is its województwo's (`teryt10`), a rada powiatu its powiat's
  (`teryt1005`). A city with powiat rights is a powiat node (`teryt1061`): its
  rada miasta and its prezydent are there, not on its „Gmina X” twin.
- Everything else is the gmina's own node, its six digits and its TERC kind
  (`teryt1005011`); a Warsaw district is kind 8 (`teryt1465108`).

A head who also won a council seat is not on that council: the two cannot be
held together, so the seat passed to somebody else, whom PKW's results do not
name (410 heads in 2024). `seats` stays PKW's count, so the page can say one
is missing rather than seat the head twice.

`firstName`, `lastName` and `birthYear` are for the migration to match a
winner to a person page by, and are not stored on the region.

Run it from data/pipelines over the PeoplePKW output (person_pkw.jsonl, about
800 MB) and the TERC register the pipelines read:

    .venv/bin/python -m scripts.region_authorities \\
        versioned/person_pkw/person_pkw.jsonl \\
        ~/.cache/koryta/downloaded/teryt_codes.zip > region_authorities_2024.json

Nothing is downloaded or written but standard output.
"""

import csv
import io
import json
import sys
import typing
import zipfile

from scrapers.map.teryt import GMINA_KINDS
from scrapers.pkw.elections import parties_of_committee
from util.polish import format_person_name

ELECTION = "local-2024"
COUNCILS = ("Sejmik", "Rada powiatu", "Rada miasta", "Rada gminy", "Rada dzielnicy")
HEADS = ("Wójt", "Burmistrz", "Prezydent")
MEMBER_PREFIX = "członek partii politycznej:"


def gmina_kinds(terc_zip: str) -> dict[str, str]:
    """The TERC kind of each gmina by its six digits: 1 urban, 2 rural, 3
    urban-rural, 8 a Warsaw district - what `Teryt.gmina_kinds` reads."""
    with zipfile.ZipFile(terc_zip) as archive:
        # The archive holds the register as XML and as CSV; the CSV is read.
        name = next(
            n for n in archive.namelist() if n.startswith("TERC") and n.endswith(".csv")
        )
        text = archive.read(name).decode("utf-8-sig")
    kinds = {}
    for row in csv.reader(io.StringIO(text), delimiter=";"):
        if len(row) > 3 and row[2] and row[3] in GMINA_KINDS:
            kinds[row[0] + row[1] + row[2]] = row[3]
    return kinds


def node_id(office: str, unit: str, kinds: typing.Mapping[str, str]) -> str | None:
    """The region node a result of `office` in PKW's six-digit `unit` belongs
    to, or None for a unit TERC does not know."""
    if office == "Sejmik":
        return f"teryt{unit[:2]}"
    if office == "Rada powiatu":
        return f"teryt{unit[:4]}"
    if int(unit[2:4]) >= 61 and office in ("Rada miasta", "Prezydent"):
        return f"teryt{unit[:4]}"
    kind = kinds.get(unit)
    return f"teryt{unit}{kind}" if kind else None


def person(row: typing.Mapping[str, typing.Any]) -> dict[str, typing.Any]:
    """A winner as the record names them, with what a match needs."""
    first = (row.get("first_name") or "").strip()
    middle = (row.get("middle_name") or "").strip()
    last = (row.get("last_name") or "").strip()
    committee = (row.get("party") or "").strip()
    entry: dict[str, typing.Any] = {
        "name": format_person_name(" ".join(p for p in (first, middle, last) if p)),
        "firstName": first,
        "lastName": format_person_name(last),
    }
    birth = row.get("birth_year")
    if birth not in (None, ""):
        entry["birthYear"] = int(float(birth))
    if committee:
        entry["committee"] = committee
        parties = parties_of_committee(committee)
        if parties:
            entry["committeeParties"] = parties
    return entry


def identity(entry: typing.Mapping[str, typing.Any]) -> tuple:
    """One winner across their records: a head is also a council's winner."""
    return (entry["name"], entry.get("birthYear"))


def region_authorities(
    rows: typing.Iterable[typing.Mapping[str, typing.Any]],
    kinds: typing.Mapping[str, str],
) -> dict[str, dict]:
    """The records, keyed by region node id, from person_pkw's rows."""
    regions: dict[str, dict] = {}
    heads: set[tuple] = set()
    for row in rows:
        if str(row.get("election_year")) != "2024":
            continue
        if row.get("election_type") != "samorządu":
            continue
        if str(row.get("candidacy_success")).upper() != "TRUE":
            continue
        office = row.get("office")
        unit = str(row.get("teryt_candidacy") or "")
        if office not in COUNCILS + HEADS or len(unit) != 6:
            continue
        key = node_id(office, unit, kinds)
        if not key:
            continue
        region = regions.setdefault(key, {"election": ELECTION, "councils": []})
        entry = person(row)
        if office in HEADS:
            member = (row.get("party_member") or "").strip()
            if member.startswith(MEMBER_PREFIX):
                entry["member"] = member[len(MEMBER_PREFIX) :].strip()
            region["head"] = {"office": office, **entry}
            heads.add(identity(entry))
            continue
        council = next((c for c in region["councils"] if c["office"] == office), None)
        if council is None:
            council = {"office": office, "seats": 0, "members": []}
            region["councils"].append(council)
        council["seats"] += 1
        council["members"].append(entry)

    for region in regions.values():
        for council in region["councils"]:
            council["members"] = [
                m for m in council["members"] if identity(m) not in heads
            ]
        region["councils"].sort(key=lambda c: COUNCILS.index(c["office"]))
    return regions


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    kinds = gmina_kinds(sys.argv[2])
    with open(sys.argv[1], encoding="utf-8") as lines:
        rows = (json.loads(line) for line in lines if line.strip())
        regions = region_authorities(rows, kinds)
    json.dump(regions, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    heads = sum("head" in r for r in regions.values())
    seats = sum(c["seats"] for r in regions.values() for c in r["councils"])
    named = sum(len(c["members"]) for r in regions.values() for c in r["councils"])
    print(
        f"{len(regions)} regions, {heads} heads, {seats} seats, {named} named",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
