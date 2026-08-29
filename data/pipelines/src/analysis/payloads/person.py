import collections
import math
import typing
from dataclasses import asdict

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

#: The sixteen voivodeship codes TERYT has used since the 1999 reform replaced
#: 49 voivodeships with them. Every region node the site holds is keyed on one
#: of these or on a four-digit powiat code beginning with one, so this is the
#: whole of what "a code the site can resolve" means.
TERYT_VOIVODESHIPS = frozenset(f"{code:02d}" for code in range(2, 33, 2))

#: How many unresolvable TERYT codes to name in the run's report.
DROPPED_TERYTS_REPORTED = 20


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
        dropped_teryts: typing.Counter[str] = collections.Counter()
        for _, row in people_df.iterrows():
            person = self.map_person_payload(ctx, row, dropped_teryts)
            unmapped.update(unmapped_committees(person.elections))
            result.append(person)
        report_unmapped_committees(unmapped)
        report_dropped_teryts(dropped_teryts)
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

    def map_person_payload(
        self,
        ctx: Context,
        row: pd.Series,
        dropped_teryts: typing.Counter[str] | None = None,
    ) -> Person:
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
        elections = _extract_elections(row, dropped_teryts)
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
            autoapprove=count > 0,
        )


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


def _modern_teryt(teryt: str) -> str | None:
    """The candidacy's TERYT code, or None if it is not a TERYT code any more.

    The 1994 and 1998 council files are filed under the pre-1999 division into
    49 voivodeships, whose codes ran 01-49 - '2736', '47', '0102', '8510'. None
    of those name anything today, and the codes that look modern are worse than
    the ones that do not: '2310' is a well-formed four-digit string that no
    region node has and never will.

    Sending one anyway is what this is about. The ingest resolves `teryt` to a
    region node, and until it was fixed a code it could not resolve threw and
    took every candidacy after it in the payload down with it - 19,538
    candidacies, 20% of the total, measured against the enriched people table.
    The ingest now skips the one candidacy instead, so this is no longer load
    bearing; it is here because a payload claiming a code that means nothing is
    a claim the pipeline should not be making, and because it keeps 7,588 lines
    of "region not found" out of every upload's log.

    The powiat codes are their voivodeship's code plus two digits, so the first
    two characters decide it for both lengths - which is why a modern code that
    happens to have no region node yet ('1431', powiat warszawski zachodni)
    still comes through: that is a missing region, not a bad code, and it should
    be fixed by creating the node.
    """
    if len(teryt) == 4 and teryt.endswith("00"):
        # PKW files a voivodeship-wide candidacy as WW00; the site's node for a
        # voivodeship is keyed on the bare two-digit code.
        teryt = teryt[:2]
    if teryt[:2] not in TERYT_VOIVODESHIPS:
        return None
    return teryt


def _extract_elections(
    row: pd.Series, dropped_teryts: typing.Counter[str] | None = None
) -> list[Election]:
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
                    modern = _modern_teryt(teryt_val)
                    if modern is None and dropped_teryts is not None:
                        dropped_teryts[teryt_val] += 1
                    # The candidacy is kept either way. It happened, and the
                    # ingest has an allowlist for exactly the old elections
                    # whose district it cannot place; dropping the row instead
                    # would lose a candidacy to fix a code.
                    election_payload.teryt = modern

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


def report_dropped_teryts(dropped: typing.Counter[str]) -> None:
    """Name the districts the payloads could not place, and how many there are.

    Almost all of this is the 1994 council file and its pre-1999 codes, which is
    expected and not actionable. The number is worth printing anyway: it is how
    a *modern* code that stopped resolving would show up, and a jump in it after
    a change to the PKW join is the signal that the join started reading the
    wrong column.
    """
    if not dropped:
        return
    total = sum(dropped.values())
    print(
        f"{total} candidacies carry a district code that is not a TERYT code "
        f"today ({len(dropped)} distinct). The most common:"
    )
    for teryt, count in dropped.most_common(DROPPED_TERYTS_REPORTED):
        print(f"  {count:6d}  {teryt}")
