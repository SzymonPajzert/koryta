import firebase_admin
from firebase_admin import db
from typing import Literal, Any
import os
import sys
import re

DB_UID = ""
ACCEPTABLE_UIDs=[
    "rejestr-io-appender",
    "kpo-appender",
    "reader",
]
print("Provide UID to connect to firebase. Available options: ")
for uid in ACCEPTABLE_UIDs:
    print(f"  {uid}")
DB_UID = input("> ")
if DB_UID not in ACCEPTABLE_UIDs:
    print(f"UID '{DB_UID}' is not allowed")
    sys.exit(1)

DATABASE_URL = "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app"
if "FIREBASE_DATABASE_EMULATOR_HOST" in os.environ:
    print("Connecting to emulated DB")
else:
    if DB_UID != "reader":
        print("Should I connect to prod DB? Type 'yes, connect me'")
        if input() != "yes, connect me":
            print('Stopping, run $ export FIREBASE_DATABASE_EMULATOR_HOST="127.0.0.1:9003"')
            sys.exit(1)
            
firebase_admin.initialize_app(
    options={
        "databaseURL": DATABASE_URL,
        "databaseAuthVariableOverride": {"uid": DB_UID},
    }
)

# TODO import https://docs.google.com/spreadsheets/d/1Zk-hp0nZbDhi9TdhoA4kjkA2kSO_KAq6wp_l5V4rSYU
KRSs = []
KRSs = list(set(KRSs))

type Aktualnosc = Literal["aktualne", "historyczne"]

PEOPLE = [
    ("720445", "marcin-skwierawski"),
]

class Autoapprovers:
    def __init__(self, patterns):
        self.patterns = patterns

    def matches(self, path: str) -> bool:
        for pattern in self.patterns:
            if re.match(pattern, path):
                return True
        return False


autoapprovers = Autoapprovers(
    [
        "/external/rejestr-io/krs/\\d+/to_read",
        "/external/rejestr-io/krs/\\d+/connections/\\d+/state",
        "/external/rejestr-io/krs/\\d+/external_basic",
    ]
)


def single_value_diff(prev, after):
    return f"  current: {prev}\n  new: {after}"


def something_removed(prev: dict, after: dict) -> list[tuple[str, str]]:
    def diff_pair(k, v):
        if k not in after:
            return [(k, "removed")]
        if isinstance(v, dict) and isinstance(after[k], dict):
            return [(k + "." + n, t) for n, t in something_removed(v, after[k])]
        elif v != after[k]:
            return [(k, f"changed\n{single_value_diff(v, after[k])}")]
        return []

    return [r for k, v in prev.items() for r in diff_pair(k, v)] + [
        (k, "added") for k in after.keys() if k not in prev
    ]


def diff_maybe_dict(prev: dict | Any, after: dict | Any) -> tuple[bool, str]:
    if isinstance(prev, dict) and isinstance(after, dict):
        diff = something_removed(prev, after)
        return len(diff) > 0, "\n".join([k + " " + v for (k, v) in diff])
    return prev != after, single_value_diff(prev, after)


class DBModel:
    def __init__(self, path):
        self.path = path
        self.__ref = db.reference(path)
        self.__value = None

    def get(self) -> dict:
        if not self.__value:
            v = self.__ref.get()
            assert not isinstance(v, tuple)
            self.__value = v

        return self.__value

    def push(self, path, value):
        self.__ref.child(path).push(value)

    def update(self, data: dict):
        for k, v in data.items():
            current = self.__ref.child(k).get()
            approved = False
            path = f"{self.path}/{k}"
            if not current:
                approved = True
            else:
                is_diff, diff = diff_maybe_dict(current, v)
                if not is_diff:
                    continue
                if autoapprovers.matches(path):
                    print(f"Diff, skipping {path}")
                    approved = False
                else:
                    print(f"Found difference for key {path}:\n{diff}")
                    print("Set the value? [y/N]")
                    if input() == "y":
                        approved = True
            if approved:
                self.__ref.child(k).set(v)


class KRSRef(DBModel):
    def __init__(self, krs: str):
        krs = krs.zfill(10)
        assert len(krs) == 10
        super().__init__(f"/external/rejestr-io/krs/{krs}")
        self.krs = krs

    def is_scraped(self, should_print=False) -> bool:
        current = self.get()
        if current is not None and "read" in current:
            if should_print:
                print(f"Already read KRS {self.krs}, SKIPPING...")
            return True
        return False


class PersonRef(DBModel):
    def __init__(self, id: str):
        super().__init__(f"/external/rejestr-io/person/{id}")
        self.id = id

    def is_scraped(self, expect_full=False, should_print=False) -> bool:
        current = self.get()
        if current is not None and (not expect_full or "read" in current):
            if should_print:
                print(f"Already read person {self.id} - {current['name']}, SKIPPING...")
            return True
        return False


def list_missing_people() -> tuple[dict[str, list[Aktualnosc]], set[str]]:
    companies = db.reference("/external/rejestr-io/krs/").get()
    assert isinstance(companies, dict)

    people = db.reference("/external/rejestr-io/person/").get()
    assert isinstance(people, dict)

    companies_to_ingest = dict()
    people_missing = set()

    for id, company in companies.items():
        for person, status in company.get("connections", {}).items():
            if person not in people:
                companies_to_ingest[id] = companies_to_ingest.get(id, [])
                companies_to_ingest[id].append((status["state"]))
                people_missing.add(person)

    print(f"{len(companies_to_ingest)} companies to reprocess")
    print(f"{len(people_missing)} people missing")

    return companies_to_ingest, people_missing


def orgs_to_process() -> dict[str, list[Aktualnosc]]:
    states: list[Aktualnosc] = ["historyczne", "aktualne"]
    
    missing_krs : set[str] = set()
    for krs in KRSs:
        r = KRSRef(krs)
        if not r.is_scraped():
            missing_krs.add(krs)
        v = r.get()
        if v is not None and "connections" in v:
            for id, connection in v["connections"].items():
                id = id.zfill(10)
                if connection["state"] == "aktualne" and connection["type"] == "org":
                    print(f"{id} is a child connection, adding it")
                    if not KRSRef(id).is_scraped():
                        missing_krs.add(id)

    for company in DBModel("/company").get().values():
        if "krsNumber" in company:
            krs_number = company["krsNumber"]
            if krs_number not in missing_krs:
                print(f"Adding {krs_number} to the list of missing KRSs")
            missing_krs.add(krs_number)

    not_scraped = {
        krs: states for krs in missing_krs
    }
    companies_to_ingest = list_missing_people()[0]
    print(
        "Not scraped",
        len(not_scraped),
        "Companies for missing people",
        len(companies_to_ingest),
    )
    for k, v in companies_to_ingest.items():
        not_scraped[k] = list(set(not_scraped.get(k, [])).union(v))
    return not_scraped


def people_to_process():
    not_scraped = [id[0] for id in PEOPLE if not PersonRef(id[0]).is_scraped()]
    people_missing = list_missing_people()[1]
    return set(not_scraped).union(people_missing)
