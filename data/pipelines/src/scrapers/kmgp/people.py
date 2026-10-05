import difflib
import json
import re
import typing
from dataclasses import asdict, dataclass

import pandas as pd

from entities.composite import Company, Election, Person, Source
from entities.person import PKW
from scrapers.kmgp.companies import CompaniesKMGP
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import CloudStorage, Pipeline
from scrapers.stores.file import DownloadableFile

#: How close an entity's name must be to a company's for a fuzzy match.
FUZZY_THRESHOLD = 0.75
#: Added to the score of a company in the entity's own gmina.
SAME_GMINA_BOOST = 0.1


def normalize_text(text: str) -> str:
    if not text:
        return ""
    t = text.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


@dataclass
class Payload:
    name: str
    teryt: str
    entity_name: str
    source: str


class PeopleKMGP(Pipeline[Person]):
    filename = "people_kmgp"

    people_pkw: PeoplePKW
    companies_kmgp: CompaniesKMGP

    @property
    def output_class(self):
        return Person

    def lookup_election(self, person_name: str, teryt: str) -> list[Election]:
        name_key = person_name.lower().strip()
        matches = getattr(self, "pkw_index", {}).get(name_key, [])
        elections = []
        for pkw_person in matches:
            pkw_teryt = pkw_person.teryt_candidacy
            if not pkw_teryt:
                continue

            if pkw_teryt.startswith(teryt) or teryt.startswith(pkw_teryt):
                elections.append(
                    Election(
                        election_type=pkw_person.election_type,
                        committee=pkw_person.party or "",
                        election_year=pkw_person.election_year,
                        teryt=pkw_person.teryt_candidacy,
                    )
                )
        return elections

    def lookup_companies(self, teryt: str, entity_name: str) -> list[Company]:
        """The company an entity's name names: exactly, in its gmina, or else
        the closest name scoring FUZZY_THRESHOLD or more (+SAME_GMINA_BOOST in
        its gmina).

        Looked up once per (gmina, name), which is all it depends on: the
        people of one office share it, and each lookup is a scan of every
        company."""
        if not entity_name:
            return []
        key = (teryt, entity_name)
        found = self._companies_found.get(key)
        if found is None:
            found = self._companies_found[key] = self._find_company(teryt, entity_name)
        return list(found)

    def _find_company(self, teryt: str, entity_name: str) -> list[Company]:
        ent_norm = normalize_text(entity_name)
        ent_exact = entity_name.strip().lower()

        # 1. Exact match (case insensitive)
        krs = self.companies_index.get((teryt, ent_exact))
        if krs:
            return [Company(krs=krs)]

        # 2. Fuzzy match. A full ratio is the expensive part and runs against
        # every company, so its two cheap upper bounds go first: a company
        # that could neither beat the best so far nor reach the threshold is
        # passed over - the same answer, with far fewer ratios.
        best_krs = None
        best_score = 0.0
        for t, name_norm, krs in self._companies_normalized:
            boost = SAME_GMINA_BOOST if t == teryt else 0.0
            matcher = difflib.SequenceMatcher(None, ent_norm, name_norm)
            if not self._may_win(matcher.real_quick_ratio() + boost, best_score):
                continue
            if not self._may_win(matcher.quick_ratio() + boost, best_score):
                continue
            score = matcher.ratio() + boost
            if score > best_score:
                best_score = score
                best_krs = krs

        if best_krs and best_score >= FUZZY_THRESHOLD:
            return [Company(krs=best_krs)]

        return []

    @staticmethod
    def _may_win(bound: float, best_score: float) -> bool:
        """Whether a company whose score is at most `bound` could still be the
        answer: it has to beat the best so far, and the answer has to reach
        the threshold. One that only beats a best below the threshold changes
        nothing, since no company is returned then."""
        return bound > best_score and bound >= FUZZY_THRESHOLD

    def index_companies(self, companies: typing.Iterable) -> None:
        """KMGP's companies by (gmina, lowercased name), with each name
        normalised once rather than once per lookup."""
        self.companies_index: dict[tuple[str, str], str] = {}
        for c in companies:
            if c.name and c.teryt_code:
                key = (c.teryt_code, c.name.strip().lower())
                self.companies_index[key] = c.krs
        self._companies_normalized = [
            (t, normalize_text(name), krs)
            for (t, name), krs in self.companies_index.items()
        ]
        self._companies_found: dict[tuple[str, str], list[Company]] = {}

    def list_people(self, ctx) -> typing.Iterator[Payload]:
        """The confirmed people of each employment-stats page, from its newest
        capture only: a later capture replaces the earlier one rather than
        adding to it. Of the 1,000 people of 2026-04-22, 999 are among the
        1,556 of 2026-05-17, and reading both sent each of them through - and
        into the output - twice. The bir12 pages (541 of 543 objects) hold no
        people list and are not downloaded at all."""
        newest: dict[str, DownloadableFile] = {}
        for ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=kazdymusigdziespracowac.pl")
        ):
            assert isinstance(ref, DownloadableFile)
            if "bir12" in ref.url:
                continue
            page, _, day = ref.url.rpartition("/date=")
            held = newest.get(page)
            if held is None or held.url.rpartition("/date=")[2] < day:
                newest[page] = ref

        for ref in newest.values():
            j = json.loads(ctx.io.read_data(ref).read_string())
            for person in j["confirmed_list"]:
                yield Payload(
                    name=f"{person['first_name']} {person['last_name']}",
                    teryt=person["terc"],
                    entity_name=person["entity_name"],
                    source=person["attachment_url"],
                )

    def index_pkw(self, records: typing.Iterable[PKW]) -> None:
        """The 2024 candidacies by lowercased name, with and without the
        middle one, for `lookup_election`.

        The PKW records themselves: the index held a bare composite Person
        built from each, which kept the name and dropped the candidacy, so
        the first match raised on `teryt_candidacy`. Nothing ran the pipeline
        until the nightly rebuilt every root (2026-10-05).
        """
        self.pkw_index: dict[str, list[PKW]] = {}
        for pkw_person in records:
            if str(pkw_person.election_year) != "2024":
                continue
            if not pkw_person.first_name or not pkw_person.last_name:
                continue

            first = pkw_person.first_name.strip()
            last = pkw_person.last_name.strip()
            names_to_index = [f"{first} {last}".lower()]
            if pkw_person.middle_name:
                full_name = f"{first} {pkw_person.middle_name.strip()} {last}".lower()
                names_to_index.append(full_name)

            for n in names_to_index:
                self.pkw_index.setdefault(n, []).append(pkw_person)

    def process(self, ctx):
        self.index_pkw(self.people_pkw.read_or_process_list(ctx))

        self.index_companies(self.companies_kmgp.read_or_process_list(ctx))

        output = []
        for payload in self.list_people(ctx):
            output.append(
                Person(
                    payload.name,
                    elections=self.lookup_election(payload.name, payload.teryt),
                    companies=self.lookup_companies(payload.teryt, payload.entity_name),
                    # TODO we need to download it and mirror it just in case.
                    sources=[Source(url=payload.source)],
                )
            )
        return pd.DataFrame.from_records([asdict(r) for r in output])
