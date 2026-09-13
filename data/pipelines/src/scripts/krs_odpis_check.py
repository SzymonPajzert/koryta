"""Check the odpis parser against the register's own masked JSON.

The two ministry endpoints disagree about what they will tell you, and that is
exactly what makes them check each other. ``api-krs`` masks every name and
PESEL but reports the organs and their membership *correctly*; the odpis PDF
gives the names. So if the parser finds the same number of people per organ as
the JSON lists, it found everyone -- and if it finds fewer, it is silently
dropping rows, which is the failure mode a parser like this actually has.

    uv run python src/scripts/krs_odpis_check.py 0000006301 0000057953

Only counts and initials are printed; no PESEL and no full name.
"""

import argparse
import collections
import json
import sys
import time
import urllib.request

from scrapers.krs import odpis_pdf, search
from scrapers.krs.people_parsing import PERSON_PATHS

API_KRS = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr={r}&format=json"
USER_AGENT = "koryta.pl-pipeline/1.0 (https://github.com/SzymonPajzert/koryta)"

#: Roles that are one rubryka in the PDF but separate paths in the JSON, folded
#: to a common bucket so the counts are comparable.
#:
#: The SPZOZ case is the reason this exists. In the odpis, the kierownik of a
#: samodzielny publiczny ZOZ sits in "Rubryka 1 - Organ uprawniony do
#: reprezentacji podmiotu" with "KIEROWNIK PUBLICZNEGO ZAKŁADU OPIEKI
#: ZDROWOTNEJ" as the organ's *name*; in the JSON it is a path of its own,
#: ``dzial2.reprezentacjaIBIGBPPSPZOZ``. Neither is wrong -- they are two
#: renderings of one fact -- but comparing them unfolded reports a mismatch on
#: every SPZOZ in the register.
EQUIVALENT = {
    "kierownik_pzoz": "reprezentacja",
    "osoba_pz": "reprezentacja",
    "wspolnik_partner": "wspolnik",
}


def bucket(role: str) -> str:
    return EQUIVALENT.get(role, role)


def entries(node):
    if isinstance(node, list):
        return node
    if isinstance(node, dict):
        return [node]
    return []


def json_counts(krs: str) -> tuple[collections.Counter, str | None]:
    """How many people api-krs lists per role, and which register answered."""
    for register in ("P", "S"):
        request = urllib.request.Request(
            API_KRS.format(krs=krs, r=register), headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            # A subject sits in exactly one register, and asking the other one
            # is how you find out which. 404 is that answer, not a failure.
            if error.code != 404:
                raise
            time.sleep(1.0)
            continue

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            # Also seen for the wrong register: an empty body rather than a
            # 404. Same meaning.
            time.sleep(1.0)
            continue

        odpis = data.get("odpis")
        if not odpis:
            time.sleep(1.0)
            continue

        counts: collections.Counter = collections.Counter()
        dane = odpis.get("dane", {})
        # The repo's own table, rather than a copy of it: a path added there
        # should tighten this check automatically instead of leaving it
        # comparing against a stale subset.
        for path in PERSON_PATHS:
            for container in entries(dane.get(path.dzial, {}).get(path.key)):
                people = (
                    entries(container.get(path.inner)) if path.inner else [container]
                )
                for person in people:
                    if isinstance(person, dict) and person:
                        counts[bucket(path.role)] += 1
        return counts, register
    return collections.Counter(), None


def initials(person: odpis_pdf.OdpisPerson) -> str:
    given = person.given_names.split()
    return (
        f"{given[0][:1] if given else '?'}. {person.surname[:1]}"
        f"{'*' * max(len(person.surname) - 1, 0)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("krs", nargs="+")
    parser.add_argument("--show", action="store_true", help="list each person")
    args = parser.parse_args()

    failures = 0
    for raw in args.krs:
        krs = search.pad_krs(raw)
        print("=" * 72)

        fetched = search.fetch_odpis_pdf_either(krs, full=True)
        if fetched is None:
            print(f"{krs}: no odpis in either register")
            continue
        register, content = fetched
        people = odpis_pdf.parse_pdf(content, krs)
        time.sleep(search.REQUEST_INTERVAL)

        expected, json_register = json_counts(krs)
        time.sleep(search.REQUEST_INTERVAL)

        current = [p for p in people if p.current]
        print(
            f"{krs}  pdf-register={register} json-register={json_register}  "
            f"{len(content):,} bytes"
        )
        print(
            f"  parsed {len(people)} people: {len(current)} current, "
            f"{len(people) - len(current)} struck out"
        )
        with_date = sum(1 for p in current if p.birth_date)
        companies = sum(1 for p in people if p.is_company)
        print(
            f"  of the current ones, {with_date} carry a birth date; "
            f"{companies} seats are held by a company"
        )

        by_role = collections.Counter(bucket(p.role) for p in current)
        organs = {p.organ_name for p in people if p.organ_name}
        print(f"  organs named: {sorted(organs)}")
        print(f"  organ kinds : {sorted({p.organ for p in people if p.organ})}")

        print("  role                 pdf(current)  api-krs   verdict")
        for role in sorted(set(by_role) | set(expected)):
            got, want = by_role.get(role, 0), expected.get(role, 0)
            ok = got == want
            failures += 0 if ok else 1
            print(
                f"  {role:<20} {got:>12}  {want:>7}   "
                f"{'match' if ok else 'MISMATCH'}"
            )

        if args.show:
            for person in people:
                flag = "  " if person.current else "x "
                print(
                    f"    {flag}{person.role:<16} {initials(person):<14}"
                    f" {person.birth_date or '----------'} {person.sex or '-'}"
                    f"  {(person.funkcja or '')[:34]}"
                )

    print("=" * 72)
    print("all organ counts agree" if not failures else f"{failures} MISMATCHES")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
