import collections
import math
import typing
from dataclasses import asdict
from datetime import date, datetime

import numpy as np
import pandas as pd

from analysis.extract import Extract, check_auto_approved
from analysis.payloads.election import get_election_type
from analysis.utils.elections import candidacy_teryt
from entities.composite import Company, Election, Person
from scrapers.pkw.elections import parties_of_committee
from scrapers.stores import Context, Pipeline

#: How many unrecognised committees to name when reporting what the party
#: mapping is missing. Enough to act on, short enough to read.
UNMAPPED_COMMITTEES_REPORTED = 20


class PeoplePayloads(Pipeline[Person]):
    # TODO save to the same file as extract
    volatile = True

    people: Extract

    @property
    def output_class(self) -> typing.Type:
        return Person

    def process(self, ctx: Context):
        people_df = self.people.read_or_process(ctx)
        result = []
        unmapped: typing.Counter[str] = collections.Counter()
        for _, row in people_df.iterrows():
            person = self.map_person_payload(ctx, row)
            unmapped.update(unmapped_committees(person.elections))
            result.append(person)
        report_unmapped_committees(unmapped)
        return (
            pd.DataFrame.from_records([asdict(p) for p in result])
            if result
            else pd.DataFrame(
                columns=[
                    "name",
                    "companies",
                    "elections",
                    "parties",
                    "wikipedia_url",
                    "rejestrIo",
                ]
            )
        )

    def map_person_payload(self, ctx: Context, row: pd.Series) -> Person:
        def get_scalar(key):
            val = row.get(key)
            if isinstance(val, (list, np.ndarray)):
                if len(val) > 0:
                    return val[0]
                return None
            return val

        name = (
            get_scalar("name")
            or get_scalar("full_name")
            or get_scalar("fullname")
            or get_scalar("krs_name")
            or get_scalar("base_full_name")
            or "Unknown Payload"
        )

        companies = _extract_companies(row)
        elections = _extract_elections(row)
        count, sources, content, party = _hardcoded_sources_content_parties(row)
        # The two hardcoded lists name a few hundred people between them; the
        # committees name everybody who ever stood for one. Both are evidence,
        # so keep both.
        party = sorted(set(party) | set(parties_from_committees(elections)))

        wiki_name = get_scalar("wiki_name")
        wikipedia_url = get_scalar("wikipedia") or get_scalar("wiki_url")
        if not wikipedia_url and wiki_name and isinstance(wiki_name, str):
            wikipedia_url = (
                f"https://pl.wikipedia.org/wiki/{wiki_name.replace(' ', '_')}"
            )

        birth_date = _iso_date(get_scalar("birth_date"))

        rejestr_ids = row["rejestrio_id"]
        if len(rejestr_ids) > 2:
            print(f"Found duplicated rejestr_ids: {rejestr_ids}")
        rejestr_id = rejestr_ids[0]
        rejestrIo = f"https://rejestr.io/osoby/{rejestr_id}"

        return Person(
            name=name,
            content=content,
            companies=companies,
            elections=elections,
            sources=sources,
            parties=party,
            wikipedia=wikipedia_url,
            rejestrIo=rejestrIo,
            birthDate=birth_date,
            autoapprove=count > 0,
        )


def _iso_date(value: typing.Any) -> str | None:
    """A birth date as `YYYY-MM-DD`, or None when there is not one.

    The column arrives in whatever shape the join left it: an ISO string from
    `people_krs_merged`, a `Timestamp` once pandas has parsed a frame, `NaT` or
    `NaN` for a person nobody has a date for. `pd.isna` is what recognises all
    three absences - `not value` does not, because `NaT` is truthy.

    Anything that does not parse is dropped rather than passed on. The ingest
    would reject it anyway, and a person is worth storing without a birth date.
    """
    if value is None or (not isinstance(value, (list, np.ndarray)) and pd.isna(value)):
        return None
    if isinstance(value, str):
        text = value.strip()[:10]
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            return None
    if isinstance(value, (datetime, date)):
        return (
            value.date().isoformat()
            if isinstance(value, datetime)
            else value.isoformat()
        )
    parsed = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(parsed) else parsed.date().isoformat()


auto_approved = check_auto_approved()


def _hardcoded_sources_content_parties(
    row: pd.Series,
):
    result = []
    result = auto_approved(row)
    return result


def _extract_companies(row: pd.Series) -> list[Company]:
    companies = []
    company_list = row.get("companies") or row.get("employment")
    if isinstance(company_list, (list, np.ndarray)):
        for c in company_list:
            if isinstance(c, dict):
                c_krs = c.get("krs") or c.get("employed_krs")
                companies.append(
                    Company(
                        krs=c_krs,
                        role=c.get("role")
                        or c.get("function")
                        or c.get("employed_role"),
                        start=c.get("start") or c.get("employed_start"),
                        end=c.get("end") or c.get("employed_end"),
                    )
                )
    return companies


def _committee(value: typing.Any) -> str | None:
    """The electoral committee a candidacy was run under, or None.

    The column is called ``party`` in the PKW tables and holds the committee's
    full name. It was previously passed through ``str()``, which turns a missing
    one into the literal string ``"None"`` - a value that survives the
    uploader's null-stripping and would have been stored on the edge as though
    somebody had stood for a committee of that name.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text or text in {"None", "nan"}:
        return None
    return text


def _extract_elections(row: pd.Series) -> list[Election]:
    elections = []
    elec_list = row.get("elections")
    if isinstance(elec_list, (list, np.ndarray)):
        for e in elec_list:
            if isinstance(e, dict):
                teryt_val = candidacy_teryt(e)

                committee = _committee(e.get("party"))
                election_payload = Election(
                    election_type=get_election_type(str(e.get("election_type"))),
                    committee=committee,
                    party=party_of_candidacy(committee),
                    party_from_committee=bool(parties_of_committee(committee)),
                )
                if e.get("election_year"):
                    election_payload.election_year = str(e.get("election_year"))
                if teryt_val:
                    if len(teryt_val) == 4 and teryt_val.endswith("00"):
                        teryt_val = teryt_val[:2]
                    election_payload.teryt = teryt_val

                elections.append(election_payload)
    return elections


def party_of_candidacy(committee: str | None) -> str | None:
    """The one party to put on the candidacy's own edge, or None.

    A stored `election` edge holds a single `party`, which is what the person's
    page shows next to the region they stood in. Only an unambiguous committee
    fills it: a coalition stands for both its parties, and naming one of them on
    the edge would read as a fact about which of the two the candidate belongs
    to - which is exactly what a joint list does not say. Those keep their
    `committee` and no party.
    """
    parties = parties_of_committee(committee)
    return parties[0] if len(parties) == 1 else None


def parties_from_committees(elections: list[Election]) -> list[str]:
    """Which parties a person's candidacies put them with.

    The committee a candidacy was run under is the only party evidence PKW
    records, and until now the pipeline threw it away: `parties` came entirely
    from two hand-copied press lists of a few hundred names, which is why only
    864 of 6077 people had one and why reviewers keep leaving notes that say
    nothing but "PIS".

    A coalition counts as both of its parties. The candidate stood on a joint
    list, which is what PKW recorded and all anybody can say from it.
    """
    parties: set[str] = set()
    for election in elections:
        parties.update(parties_of_committee(election.committee))
    return sorted(parties)


def unmapped_committees(elections: list[Election]) -> list[str]:
    """Committees on a person's candidacies that no party is known for."""
    return [
        election.committee
        for election in elections
        if election.committee and not parties_of_committee(election.committee)
    ]


def report_unmapped_committees(unmapped: typing.Counter[str]) -> None:
    """Name the committees whose absence from the map costs the most people.

    Most of the tail is genuinely local - a KWW put together for one gmina
    stands for no national party and never will. But the tail is where a
    misspelt or newly-worded national committee hides too, and the only way to
    tell is to look at the ones that come up often.
    """
    if not unmapped:
        return
    total = sum(unmapped.values())
    print(
        f"{total} candidacies ran under {len(unmapped)} committees no party is "
        f"known for. The most common:"
    )
    for committee, count in unmapped.most_common(UNMAPPED_COMMITTEES_REPORTED):
        print(f"  {count:6d}  {committee}")
