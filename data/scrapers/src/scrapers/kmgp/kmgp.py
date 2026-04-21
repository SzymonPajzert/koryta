import json
import typing
from dataclasses import dataclass

from entities.composite import Company, Election, Person
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

    def lookup_election(self, person_name: str, teryt: str) -> list[Election]:
        return []

    def lookup_companies(self, teryt: str, entity_name: str) -> list[Company]:
        return []

    def list_people(self, ctx) -> typing.Iterator[Payload]:
        for blob_ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=kazdymusigdziespracowac.pl")
        ):
            blob = ctx.io.read_data(blob_ref)
            assert isinstance(blob_ref, DownloadableFile)
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
