import firebase_admin
from firebase_admin import db
from typing import Literal, Any
import os
import sys
import re

DATABASE_URL = "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app"
if "FIREBASE_DATABASE_EMULATOR_HOST" in os.environ:
    print("Connecting to emulated DB")
else:
    print("Should I connect to prod DB? Type 'yes, connect me'")
    if input() != "yes, connect me":
        print('Stopping, run $ export FIREBASE_DATABASE_EMULATOR_HOST="127.0.0.1:9003"')
        sys.exit(1)


firebase_admin.initialize_app(
    options={
        "databaseURL": DATABASE_URL,
        "databaseAuthVariableOverride": {"uid": "rejestr-io-appender"},
    }
)

# TODO read this list from the DB as well
KRSs = [
    "0000293205",
    "0000394569",
    "0000033455",
    "0000655791",
    "0000059307",
    "0000028860",
    "0000075450",
    "0000512140",
    "0000140528",
    "0000280916",
    "0000008993",
    "0000223709",
    "0000018639",
    "0000023302",
    "0000395215",
    "0000188857",
    "0000374001",
    "0000017437",
    "0000116114",
    "0000498471",
    "0000489456",
    "0000012900",
    "0000026554",
    "0000182526",
    "0000107288",
    "0000027497",
    "0000392868",
    "0000081828",
    "0000334972",
    "0000056031",
    "0000031962",  # NFOŚiGW
    "0000146138",  # Miejskie Przedsiębiorstwo Wodociągów i Kanalizacji (MPWiK)
    "0000050531",  # WarEXPO
    "0000173077",  # Miejskie Przedsiębiorstwo Realizacji Inwestycji w Warszawie
    "0000206762",  # SKM
    "0000478458",  # Szpital Grochowski
    "0000019230",  # TBS Bemowo
    "0000636771",  # Aplikacje krytyczne - nalezy do ministerstwa finansow
    "0000085139",  # Nalezy do ARP, duzo ludzi po znajomosciach i bylych politykow
    "0000019193",  # PKP
]

dumped = """0000037957
0000140528
0000394569
0000392868
0000015684
0000068409
0000026554
0000280916
0000033455
0000109164
0000512140
0000060709
0000075450
0000188857
0000008993
0000076693
0000045258
0000182526
0000225570
0000017437
0000107288
0000035253
0000116114
0000445684
0000498471
0000023302
0000012900
0000478929
0000033465
0000278401
0000095741
0000030908
0000084678
0000058058
0000142452
0000047934
0000101552
0000059307
0000028860
0000026438
0000027702
0000293205
0000334972
0000655791
0000489456
0000374001
0000383595
0000037312
0000365475
0000223709
0000057345
0000395215
0000027497
0000007411
0000587260
0000495596
0000018377
0000041979
0000056964
0000025053
0000095342
0000081828
0000184990
0000027151
0000130498"""

KRSs += dumped.split("\n")
KRSs = list(set(KRSs))

type Aktualnosc = Literal["aktualne", "historyczne"]

# TODO
# https://rejestr.io/krs/146138/miejskie-przedsiebiorstwo-wodociagow-i-kanalizacji-w-m-st-warszawie
# Bardzo dobre źródło ludzi w spółkach
# TODO Dla tych oznaczonych, znajdź najpopularniejsze ich miejsca pracy

PEOPLE = [
    ("720445", "marcin-skwierawski"),
    # TODO read all from DB
    # TODO sync the ones in employed and company with the ones in rejestr.io DB
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
        super().__init__(f"/external/rejestr-io/krs/{krs}")
        self.krs = krs

    def is_scraped(self, should_print=False) -> bool:
        current = self.get()
        if current is not None and "read" in current:
            if should_print:
                print(f"Already read KRS {self.krs}, SKIPPING...")
            return True
        return False


# TODO fill the missing name for some fields, they use basic or external
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
    not_scraped = {
        krs: states for krs in KRSs if not KRSRef(krs).is_scraped()
    }
    companies_to_ingest = list_missing_people()[0]
    # TODO list children of the KRSs
    print(
        "Not scraped",
        len(not_scraped),
        "Companies for missing people",
        len(companies_to_ingest),
    )
    for k, v in companies_to_ingest.items():
        not_scraped[k] = list(set(not_scraped[k]).union(v))
    return not_scraped


def people_to_process():
    not_scraped = [id[0] for id in PEOPLE if not PersonRef(id[0]).is_scraped()]
    people_missing = list_missing_people()[1]
    return set(not_scraped).union(people_missing)
