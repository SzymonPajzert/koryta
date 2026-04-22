import difflib
import json
import re
import typing
from dataclasses import dataclass

from entities.composite import Company, Election, Person
from scrapers.kmgp.companies import CompaniesKMGP
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import CloudStorage, DownloadableFile, Pipeline


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
        if not entity_name:
            return []

        def normalize_text(text: str) -> str:
            if not text:
                return ""
            t = text.lower()
            t = re.sub(r"[^\w\s]", " ", t)
            t = re.sub(r"\s+", " ", t).strip()
            return t

        ent_norm = normalize_text(entity_name)
        ent_exact = entity_name.strip().lower()

        # 1. Exact match (case insensitive)
        key = (teryt, ent_exact)
        krs = self.companies_index.get(key)
        if krs:
            return [Company(krs=krs)]

        # 2. Fuzzy match
        best_krs = None
        best_score = 0.0

        for (t, name), krs in self.companies_index.items():
            name_norm = normalize_text(name)
            score = difflib.SequenceMatcher(None, ent_norm, name_norm).ratio()

            # Boost score if TERYT matches exactly
            if t == teryt:
                score += 0.1

            if score > best_score:
                best_score = score
                best_krs = krs

        if best_krs and best_score >= 0.75:
            return [Company(krs=best_krs)]

        return []

    def list_people(self, ctx) -> typing.Iterator[Payload]:
        for blob_ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=kazdymusigdziespracowac.pl")
        ):
            blob = ctx.io.read_data(blob_ref)
            assert isinstance(blob_ref, DownloadableFile)
            if "bir12" in blob_ref.url:
                continue
            content = blob.read_string()
            j = json.loads(content)

            for person in j["confirmed_list"]:
                yield Payload(
                    name=f"{person['first_name']} {person['last_name']}",
                    teryt=person["terc"],
                    entity_name=person["entity_name"],
                    source=person["attachment_url"],
                )

    def process(self, ctx):
        self.pkw_index: dict[str, list[Person]] = {}
        for pkw_person in self.people_pkw.read_or_process_list(ctx):
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
                if n not in self.pkw_index:
                    self.pkw_index[n] = []
                self.pkw_index[n].append(pkw_person)

        self.companies_index: dict[tuple[str, str], str] = {}
        for c in self.companies_kmgp.read_or_process_list(ctx):
            if c.name and c.teryt_code:
                key = (c.teryt_code, c.name.strip().lower())
                self.companies_index[key] = c.krs

        for payload in self.list_people(ctx):
            ctx.io.output_entity(
                Person(
                    payload.name,
                    elections=self.lookup_election(payload.name, payload.teryt),
                    companies=self.lookup_companies(payload.teryt, payload.entity_name),
                    # TODO we need to download it and mirror it just in case.
                    sources=[payload.source],
                )
            )
