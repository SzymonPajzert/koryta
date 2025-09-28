from dataclasses import dataclass
from tqdm import tqdm

from stores.firestore import firestore_db
from stores.duckdb import ducktable, dump_dbs


@ducktable(name="people_koryta")
@dataclass
class Person:
    id: str
    full_name: str
    party: str

    def insert_into(self):
        pass


def process():
    try:
        people = firestore_db.collection("nodes").where("type", "==", "person").stream()
        for person in tqdm(people):
            id = person.id
            person = person.to_dict()
            assert person is not None
            Person(
                full_name=person.get("name", ""),
                party=person.get("parties", [None])[0],
                id=id,
            ).insert_into()
    finally:
        dump_dbs()
