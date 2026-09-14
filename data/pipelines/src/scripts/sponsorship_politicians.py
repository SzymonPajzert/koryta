"""Which sponsorship recipients have a politician on the board, and who.

**Why this does not use `PeopleMerged`.** That corpus holds only people who
already sit on a crawled KRS board -- 0 of its 133,072 rows carry a candidacy
without one -- so asking it "is this board member a politician?" is circular: it
can only answer yes for somebody already on a board we had crawled, and is
blind at exactly the companies newly discovered. Measured: it found 42
controlling seats where this finds 163.

Nor can that be repaired by rebuilding `PeopleKRS`. `scrapers.krs.list.
extract_people` reads the rejestr.io prefix through the **compressed mirror**, a
periodic snapshot, and its own docstring warns that a crawl taken after the
mirror was built "would contribute nothing at all". A rebuild attempted on
2026-09-14 duly shrank the corpus from 133,072 to 106,136 rows and still found
nobody at the four newly crawled companies.

So this joins straight to `person_pkw`: 1,947,995 candidacies, every registered
candidate, no KRS filter.

**The join is weaker than the rest of this pipeline. Three parts, and all three
are needed.**

*Name* alone is hopeless at this scale. *Birth year* is the only date PKW has --
derived as ``election_year - age`` (`scrapers/pkw/process.py:48`), with no day
or month -- and over the 44,799 people carrying both a PESEL-derived date and a
PKW year the two agree on the year 77.3% of the time and are off by exactly one
22.7%. So a ±1 tolerance is forced, which widens the candidate set rather than
narrowing it. *Powiat* is what makes the result usable, and the precedent is
explicit: matching a name against sole traders was 0% precise until a powiat
check was added (`scrapers/sudop/people.py`). Dropping it here turns 163
matches into 370, and the extra 207 include a Radom sports body matched to a
committee in Bytom Odrzański, 400 km away.

A powiat agreement is corroboration, not proof: two same-named people of
near-identical age in one powiat still collide. Every row therefore carries the
evidence that produced it -- whether the powiat agreed, whether the candidacy
was won, and how many candidacies the name has -- so a reader can sort by how
much they believe it rather than trusting a boolean.

    uv run python src/scripts/sponsorship_politicians.py \\
        versioned/krs_odpis_people/krs_odpis_people.jsonl /tmp/odpis_280.jsonl \\
        --out-dir /tmp
"""

import argparse
import collections
import csv
import json
import re
import sys
from pathlib import Path

from scrapers.krs.nip_sources import money, read_nips
from scrapers.krs.people_match import fold_name
from stores.config import VERSIONED_DIR

VERSIONED = Path(VERSIONED_DIR)

#: Election types that mean "held or sought public office".
#:
#: In practice only ``samorządu`` is reachable. `index_pkw` needs a
#: `birth_year`, which PKW derives from an age column that the Sejm, Senate and
#: European-Parliament files do not publish -- so 50,718 Sejm, 2,993 Senate and
#: 6,339 EP candidacies carry none and are dropped. The set still names them
#: because the filter is about intent, but a national politician who has never
#: stood locally is invisible to this join and that is a coverage limit, not a
#: finding about them.
OFFICE_TYPES = frozenset({"samorządu", "sejmu", "senatu", "europarlamentu"})

#: What `candidacy_success` says when PKW recorded an outcome at all. It is
#: null for most of the samorząd elections it publishes -- 1994, 1998, 2006 and
#: 2014 entirely, 2002 and 2018 for all but a few percent -- so "FALSE" and
#: "no value" are different facts and only the first is a defeat. That is why
#: `result` is three-way rather than a boolean: a shortlist built on the
#: boolean quietly meant "won where a result was recorded".
#:
#: Tested per row and not per year. Gating on a list of years would call a 2018
#: candidacy with a recorded FALSE "unknown", and would print a caveat naming
#: two years that is not what the data says.
RECORDED = frozenset({"TRUE", "FALSE"})

#: Roles that mean the person owns or runs the body, as opposed to merely
#: sitting on a board of twenty.
OWNS = frozenset({"wspolnik", "jedyny_akcjonariusz"})
RUNS_RE = re.compile(
    r"\bPREZES\w*|JEDNOOSOBOW|W[ŁL]A[ŚS]CICIEL|KOMPLEMENTARIUSZ"
    r"|DYREKTOR\s+GENERALNY|\bKIEROWNIK",
    re.I,
)

#: A deputy to one of those. The register writes it every way there is, and
#: the list below is the forms that actually occur: WICEPREZES, WICE PREZES,
#: WICE-PREZES, WIZEPREZES, VICEPREZES, VICE PREZES, V-CE PREZES, W-CE PREZES,
#: V-PREZES, I/II WICEPREZES, ZASTĘPCA PREZESA, Z-CA PREZESA.
#:
#: Getting this wrong is not symmetric. A form the pattern misses but `RUNS_RE`
#: matches -- "VICE PREZES D/S FINANSOWYCH", "W-CE PREZES D/S BRD" -- is
#: published as *running* the body, which is the claim this whole distinction
#: exists to avoid; 10 seats read that way before these forms were added.
#:
#: Only PREZES is qualified, because that is the only head word the deputy
#: forms attach to here. "ZASTĘPCA NACZELNIKA" is a fire brigade's second
#: officer, not a deputy chief executive, and admitting it would put 99 more
#: seats into a list about who controls a funded body.
DEPUTY_RE = re.compile(
    r"\b(?:WICE|WIZE|VICE|ZAST[ĘE]PC\w*|[VWZ][-\s.]?C[AE]|V(?=[-\s]))"
    r"[-\s.,/()]*PREZES",
    re.I,
)

#: A body that is part of the state or a local authority -- its board being
#: political appointees is how such a body is staffed, not a finding.
PUBLIC_RE = re.compile(
    r"POLSKIE RADIO|TELEWIZJA POLSKA|PA[ŁL]AC\w* KULTURY|AGENCJA ROZWOJU"
    r"|\bIZBA\b|\bIZBY\b|ZWI[ĄA]ZEK HARCERSTWA|CHOR[ĄA]GIEW|UNIWERSYTET"
    r"|POLITECHNIK|^GMINA|^MIASTO|^POWIAT|^WOJEW[ÓO]DZTWO|BIBLIOTEKA"
    r"|O[ŚS]RODEK KULTURY|DOM KULTURY|CENTRUM KULTURY|MUZEUM NARODOWE|TEATR"
    r"|FILHARMONIA|\bOPERA\b|SZPITAL|PRZYCHODNIA|SZKO[ŁL]A|PRZEDSZKOLE"
    r"|KOMENDA|NADLE[ŚS]NICTWO|INSTYTUT (BADAWCZY|ONKOLOGII)|PA[ŃN]STWOW"
    r"|SAMORZ[ĄA]DOW|SPZOZ|WOD[OY]CI[ĄA]G|PRZEDSI[ĘE]BIORSTWO KOMUNALNE"
    r"|KOMUNIKACJI MIEJSKIEJ|POLSKI ZWI[ĄA]ZEK|ZWI[ĄA]ZEK PI[ŁL]KI"
    r"|AKADEMICKI ZWI[ĄA]ZEK SPORTOWY|ZAK[ŁL]AD GOSPODARKI KOMUNALNEJ"
    r"|MI[ĘE]DZYNARODOWE TARGI|MIEJSK\w+ (KLUB|O[ŚS]RODEK|CENTRUM|PRZEDSI"
    r"|INWESTYCJE)",
    re.I,
)

#: "08-400 Garwolin", however the spreadsheet spaced the dash.
POSTAL_RE = re.compile(r"\b(\d{2})\s*[-–]\s*(\d{3})\b")


def control(row: dict) -> str:
    """Whether the seat means the person owns, runs or only deputises.

    The deputy test comes first and is independent of `RUNS_RE`, because the
    two sets barely overlap: `\\bPREZES` does not match WICEPREZES at all, so
    without this branch 60 deputies were simply invisible, while "V-CE PREZES
    ZARZĄDU" did match and was published as running the body. They are kept
    rather than dropped -- a deputy of a body taking public money is worth
    seeing -- but labelled, so `controls` reads `deputy:` and nobody has to
    infer it from the funkcja.
    """
    if row.get("role") in OWNS:
        return "owns"
    if row.get("role") != "reprezentacja":
        return ""
    funkcja = row.get("funkcja") or ""
    if DEPUTY_RE.search(funkcja):
        return "deputy"
    return "runs" if RUNS_RE.search(funkcja) else ""


def powiat_of(teryt) -> str:
    """The 4-digit powiat stem of a TERYT code, however wide it is written.

    PKW writes a gmina as 6-7 digits (141909) and a powiat as 4 (1419); both
    reduce to the powiat by taking the first four of the zero-filled form.
    """
    digits = re.sub(r"\D", "", str(teryt or ""))
    if not digits:
        return ""
    return digits.rjust(6, "0")[:4] if len(digits) > 4 else digits.rjust(4, "0")


def postal_to_powiat(path: Path) -> dict[str, str]:
    """Postal code to powiat TERYT, from the repo's own postal file.

    Column 7 is the powiat code, which is what PKW's `teryt_candidacy` reduces
    to -- so the two are directly comparable without a name-matching step.
    """
    out: dict[str, str] = {}
    with path.open(encoding="utf-8") as handle:
        for row in csv.reader(handle, delimiter="\t"):
            if len(row) > 7 and row[1] and row[6]:
                out.setdefault(row[1].strip(), row[6].strip().rjust(4, "0"))
    return out


def read_sheets(sheets: list[Path], pc2pow: dict[str, str]):
    """Money, contract counts and seat powiat, all keyed on NIP."""
    paid: dict[str, float] = collections.defaultdict(float)
    contracts: collections.Counter = collections.Counter()
    powiat: dict[str, str] = {}
    town: dict[str, str] = {}
    for sheet in sheets:
        with sheet.open(encoding="utf-8-sig", newline="") as handle:
            for rec in csv.reader(handle):
                if len(rec) < 4 or not re.fullmatch(r"\d+", (rec[0] or "").strip()):
                    continue
                text = " ".join((rec[1] or "").split())
                nips = read_nips(text)
                match = POSTAL_RE.search(text)
                for nip in nips:
                    paid[nip] += money(rec[3]) or 0.0
                    contracts[nip] += 1
                    if match:
                        code = f"{match.group(1)}-{match.group(2)}"
                        if code in pc2pow:
                            powiat.setdefault(nip, pc2pow[code])
                            town.setdefault(
                                nip, text[match.end():].strip(" ,.").split(",")[0][:30]
                            )
    return paid, contracts, powiat, town


def index_pkw(path: Path) -> dict[tuple[str, str], list[dict]]:
    by_name: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            if str(row.get("election_type")) not in OFFICE_TYPES:
                continue
            if not row.get("birth_year"):
                continue
            by_name[
                (fold_name(row.get("first_name")), fold_name(row.get("last_name")))
            ].append(row)
    return by_name


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("people", nargs="+", help="odpis-derived people JSONL")
    parser.add_argument("--pkw", default="/tmp/pkw/person_pkw")
    parser.add_argument("--out-dir", default="/tmp")
    parser.add_argument(
        "--postal", default=str(Path("downloaded") / "postal_codes_pl.txt")
    )
    parser.add_argument(
        "--krs-to-nip",
        nargs="+",
        default=["/tmp/krs_to_nip.json", "/tmp/search_krs_to_nip.json"],
    )
    parser.add_argument(
        "--sheets",
        nargs="+",
        default=[
            "/home/szymon/2025.xlsx - 2025.csv",
            "/home/szymon/2026.xlsx - 2026.csv",
        ],
    )
    return parser


def write_companies(path: Path, companies: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "krs", "nip", "name", "town", "powiat", "paid", "contracts",
                "public", "people", "sitting", "politicians", "elected",
                "controllers", "deputies",
            ],
        )
        writer.writeheader()
        for company in sorted(companies.values(), key=lambda c: -c['paid']):
            writer.writerow(company)


def write_people(path: Path, people: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "name", "birth_date", "sex", "seats", "bodies", "paid_total",
                "controls", "candidacies", "in_powiat", "won", "result",
                "last_year", "last_type", "party", "pkw_birth_year",
                "year_off_by", "public_body_only",
            ],
        )
        writer.writeheader()
        for person in sorted(people.values(), key=lambda p: -p['paid_total']):
            record = dict(person)
            record["bodies"] = len(person["bodies"])
            record["controls"] = "; ".join(sorted(person["controls"]))
            writer.writerow(record)



def candidacy_result(same_powiat) -> str:
    """Won, lost, or nobody recorded an outcome.

    Three values rather than a boolean because PKW leaves `candidacy_success`
    null for most of the samorzad elections it publishes, so an absent flag
    says nothing about how the person did -- see `RECORDED`.
    """
    if any(c.get("candidacy_success") == "TRUE" for c in same_powiat):
        return "won"
    if any(str(c.get("candidacy_success")) in RECORDED for c in same_powiat):
        return "lost"
    return "unknown"


def new_company(krs, row, nip, seat_powiat, nip_town, paid, contracts) -> dict:
    """A company's counters, before any of its seats have been read."""
    return {
        "krs": krs,
        "nip": nip,
        "name": row.get("company_name") or "",
        "town": nip_town.get(nip, ""),
        "powiat": seat_powiat,
        "paid": paid.get(nip, 0.0),
        "contracts": contracts.get(nip, 0),
        "public": bool(PUBLIC_RE.search(row.get("company_name") or "")),
        "people": 0,
        "sitting": 0,
        "politicians": 0,
        "elected": 0,
        "controllers": 0,
        "deputies": 0,
    }


def accumulate(rows, krs_to_nip, nip_powiat, nip_town, paid, contracts, by_name):
    """Fold the seats into per-company and per-person records."""
    no_powiat: list[tuple[str, str]] = []
    companies: dict[str, dict] = {}
    people: dict[tuple, dict] = {}

    for row in rows:
        krs = row["krs"]
        nip = krs_to_nip.get(krs, "")
        seat_powiat = nip_powiat.get(nip, "")
        company = companies.setdefault(
            krs,
            new_company(krs, row, nip, seat_powiat, nip_town, paid, contracts),
        )
        company["people"] += 1
        if not row.get("current"):
            continue
        company["sitting"] += 1
        if not row.get("birth_date"):
            continue

        given = (row.get("given_names") or "").split()
        key = (fold_name(given[0] if given else ""), fold_name(row["surname"]))
        year = int(row["birth_date"][:4])
        candidates = [
            c for c in by_name.get(key, []) if abs(int(c["birth_year"]) - year) <= 1
        ]
        if not candidates:
            continue
        # Without a seat powiat there is nothing to corroborate against, so
        # the row cannot be counted as a match -- it is counted as untestable
        # below instead, which is what the report has to say out loud.
        same_powiat = [
            c
            for c in candidates
            if seat_powiat and powiat_of(c.get("teryt_candidacy")) == seat_powiat
        ]
        if not same_powiat:
            if not seat_powiat:
                # The comment used to claim these were "kept but flagged". They
                # were not -- a bare continue dropped them. Counted now, so the
                # report can say how much it could not test.
                no_powiat.append((krs, row.get("full_name") or row["surname"]))
            continue

        best = max(
            same_powiat,
            key=lambda c: (
                c.get("candidacy_success") == "TRUE",
                str(c.get("election_year")),
            ),
        )
        result = candidacy_result(same_powiat)
        won = result == "won"
        company["politicians"] += 1
        if won:
            company["elected"] += 1
        how = control(row)
        if how == "deputy":
            company["deputies"] += 1
        elif how:
            company["controllers"] += 1

        pkey = (key[0], key[1], row["birth_date"])
        person = people.setdefault(
            pkey,
            {
                "name": row.get("full_name") or row["surname"],
                "birth_date": row["birth_date"],
                "sex": row.get("sex") or "",
                "seats": 0,
                "bodies": set(),
                "controls": set(),
                "paid_total": 0.0,
                "candidacies": len(candidates),
                "in_powiat": len(same_powiat),
                "won": won,
                "result": result,
                "last_year": best.get("election_year"),
                "last_type": best.get("election_type"),
                "party": best.get("party") or "",
                "pkw_birth_year": int(best["birth_year"]),
                "year_off_by": year - int(best["birth_year"]),
                "public_body_only": True,
            },
        )
        person["seats"] += 1
        if krs not in person["bodies"]:
            person["bodies"].add(krs)
            person["paid_total"] += company["paid"]
        if how:
            person["controls"].add(f"{how}:{company['name'][:38]}")
        if not company["public"]:
            person["public_body_only"] = False

    return companies, people, no_powiat


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    pc2pow = postal_to_powiat(Path(args.postal))
    paid, contracts, nip_powiat, nip_town = read_sheets(
        [Path(s) for s in args.sheets], pc2pow
    )
    krs_to_nip: dict[str, str] = {}
    for path in args.krs_to_nip:
        krs_to_nip.update(json.loads(Path(path).read_text()))

    by_name = index_pkw(Path(args.pkw))
    print(
        f"PKW candidacies for public office: "
        f"{sum(len(v) for v in by_name.values()):,}",
        file=sys.stderr,
    )

    rows: list[dict] = []
    for path in args.people:
        rows += [json.loads(line) for line in Path(path).open(encoding="utf-8")]

    companies, people, no_powiat = accumulate(
        rows, krs_to_nip, nip_powiat, nip_town, paid, contracts, by_name
    )

    out = Path(args.out_dir)
    comp_csv = out / "politicians_companies.csv"
    write_companies(comp_csv, companies)

    people_csv = out / "politicians_people.csv"
    write_people(people_csv, people)

    report(companies, people, comp_csv, people_csv, no_powiat)


def report(companies, people, comp_csv, people_csv, no_powiat=()) -> None:
    with_pol = [c for c in companies.values() if c["politicians"]]
    # A deputy is not a controller. `controls` keeps the deputy seats because
    # they are worth seeing, so the test is on the label rather than on the
    # set being non-empty -- otherwise a third of the shortlist below is
    # somebody who stands in for whoever runs the body.
    controllers = [
        p
        for p in people.values()
        if any(not c.startswith("deputy:") for c in p["controls"])
    ]
    deputies = [
        p
        for p in people.values()
        if p not in controllers and any(c.startswith("deputy:") for c in p["controls"])
    ]
    strong = [p for p in controllers if p["won"] and not p["public_body_only"]]

    print("=" * 74)
    print(f"{'companies with people read':<44}{len(companies):>8,}")
    print(f"{'  with a PKW-matched politician sitting':<44}{len(with_pol):>8,}")
    print(
        f"{'  their declared value':<44}"
        f"{sum(c['paid'] for c in with_pol):>14,.0f} PLN"
    )
    print(f"{'distinct politicians sitting':<44}{len(people):>8,}")
    print(f"{'  who own or run the body':<44}{len(controllers):>8,}")
    print(f"{'  who only deputise for whoever does':<44}{len(deputies):>8,}")
    print(
        f"{'  with a RECORDED win, body not public':<44}{len(strong):>8,}"
        "   (PKW records an outcome for a minority of years)"
    )
    if no_powiat:
        print(
            f"{'  seats untestable, company has no powiat':<44}"
            f"{len(no_powiat):>8,}"
        )
    print(f"\nwrote {comp_csv}")
    print(f"wrote {people_csv}")

    print("\n" + "=" * 74)
    print(
        f"SHORTLIST: recorded win, owns or runs a non-public funded body "
        f"({len(strong)})"
    )
    print("=" * 74)
    for person in sorted(strong, key=lambda p: -p["paid_total"]):
        print(
            f"{person['name'][:30]:<31}{person['birth_date']:<12}"
            f"{person['paid_total']:>10,.0f} PLN  {len(person['bodies'])} bod  "
            f"{person['last_type'][:11]:<12}{person['last_year']}  "
            f"{person['party'][:38]}"
        )
        print(f"    {'; '.join(sorted(person['controls']))[:110]}")


if __name__ == "__main__":
    main()
