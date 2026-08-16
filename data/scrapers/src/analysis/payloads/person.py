import argparse
import collections
import math
import typing
from dataclasses import asdict
from functools import cached_property

import numpy as np
import pandas as pd

from analysis.extract import Extract, check_auto_approved
from analysis.payloads.election import get_election_type
from analysis.payloads.site import SiteSnapshot
from analysis.utils.elections import candidacy_teryt
from entities.composite import Company, Election, Person
from scrapers.koryta.download import KorytaPeople
from scrapers.pkw.elections import parties_of_committee
from scrapers.stores import Context, Pipeline

#: How many unrecognised committees to name when reporting what the party
#: mapping is missing. Enough to act on, short enough to read.
UNMAPPED_COMMITTEES_REPORTED = 20


class PeoplePayloads(Pipeline[Person]):
    # TODO save to the same file as extract
    volatile = True

    people: Extract

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--on-koryta",
            help="Emit payloads only for people who already have a page on "
            "koryta.pl, so the run restates what is stored rather than "
            "creating anybody. Pair it with --all: the filter is applied to "
            "whatever Extract selected, and a region does not contain the "
            "people whose pages need restating.",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export listing who has a "
            "page. Defaults to the latest available export.",
            default=None,
            required=False,
        )
        return parser.parse_known_args()[0]

    @property
    def output_class(self) -> typing.Type:
        return Person

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--only-changed",
            help="Emit only the people whose payload would write something "
            "koryta.pl does not already hold. The rest are uploads that end in "
            "no revision and no edge, which is most of them once a region has "
            "been submitted before.",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export to compare against "
            "for --only-changed. Defaults to the latest available export.",
            default=None,
            required=False,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        people_df = self.people.read_or_process(ctx)
        result = [self.map_person_payload(ctx, row) for _, row in people_df.iterrows()]
        if self.args.on_koryta:
            result = self.only_on_koryta(ctx, result)
        unmapped: typing.Counter[str] = collections.Counter()
        for person in result:
            unmapped.update(unmapped_committees(person.elections))
        report_unmapped_committees(unmapped)
        if self.args.only_changed:
            result = self.only_changed(ctx, result)
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

    def only_changed(self, ctx: Context, people: list[Person]) -> list[Person]:
        """The payloads that would write something, and a note of what.

        Filtering here rather than in the uploader keeps the decision next to
        the data it is made from: the snapshot is a pipeline output like any
        other, and a run that drops nine payloads in ten should say so where
        the rest of the pipeline's reporting is.
        """
        snapshot = SiteSnapshot.read(ctx, self.args.koryta_date)

        changed = []
        reasons: typing.Counter[str] = collections.Counter()
        for person in people:
            person_reasons = snapshot.changes(asdict(person))
            if not person_reasons:
                continue
            changed.append(person)
            reasons.update(person_reasons)

        print(
            f"{len(changed)} of {len(people)} payloads differ from koryta.pl; "
            f"dropping {len(people) - len(changed)} that would write nothing. "
            f"What the rest would write:"
        )
        for reason, count in reasons.most_common():
            print(f"  {count:6d}  {reason}")
        return changed

    def only_on_koryta(self, ctx: Context, payloads: list[Person]) -> list[Person]:
        """The payloads for people who already have a page, and only those.

        `/api/ingest/person` finds its target with a single
        `where("name", "==", payload.name).limit(1)` and creates a new person
        when that misses, so every payload naming somebody the site does not
        have is a new node rather than an update. Of the 101,413 payloads
        `--all` emits, 4,383 match - submitting the lot to restate 4,383
        candidacies would take the collection from 6,115 people to ~103,000.
        """
        # TODO this should be a field and dependency
        submitted_df = KorytaPeople(self.args.koryta_date).read_or_process(ctx)
        names = submitted_df["full_name"].dropna().tolist()
        print(f"{len(names)} people already have a page on koryta.pl")
        return matching_one_page(payloads, names)

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


def matching_one_page(payloads: list[Person], on_koryta: list[str]) -> list[Person]:
    """The payloads a name identifies one person on both sides of.

    The ingest joins a payload to a page by an exact match on `name` and
    nothing else, so a name is only usable as an identifier where it names one
    person in the payloads *and* one page on the site. Where it names several,
    every candidacy PKW ever recorded for any of them lands on one page - the
    "osoby zostały złączone" complaint, made worse rather than answered.

    Dropped rather than resolved: which of four Piotr Mrozińskis a page is
    about is not a question the payloads can answer, and a wrong candidacy on
    a real page is a worse outcome than a missing one. They are reported so the
    count is visible, because it is the part of the backlog this run leaves.
    """
    pages = collections.Counter(on_koryta)
    candidates = collections.Counter(person.name for person in payloads)

    result = [
        person
        for person in payloads
        if pages[person.name] == 1 and candidates[person.name] == 1
    ]

    ambiguous = {
        person.name
        for person in payloads
        if pages[person.name] >= 1
        and (pages[person.name] > 1 or candidates[person.name] > 1)
    }
    print(
        f"{len(result)} of {len(payloads)} payloads name somebody with a page; "
        f"{len(ambiguous)} names left alone as several people share them"
    )
    return result


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
