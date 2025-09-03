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
            
# TODO implement the root caching for readonly operations

firebase_admin.initialize_app(
    options={
        "databaseURL": DATABASE_URL,
        "databaseAuthVariableOverride": {"uid": DB_UID},
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
    # '0000717327',
    # '0000709363',
    # '0000610301',
    # '0000590980',
    # '0000491363',
    # '0000489456',
    # '0000466256',
    # '0000445684',
    # '0000438391',
    # '0000406958',
    # '0000393247',
    # '0000384496',
    # '0000383595',
    # '0000376721',
    # '0000374289',
    # '0000362603',
    # '0000334972',
    # '0000320810',
    # '0000309337',
    # '0000303109',
    # '0000301970',
    # '0000296158',
    # '0000296096',
    # '0000295769',
    # '0000295719',
    # '0000295398',
    # '0000294799',
    # '0000294345',
    # '0000292313',
    # '0000285139',
    # '0000278401',
    # '0000271562',
    # '0000245948',
    # '0000245701',
    # '0000245260',
    # '0000231611',
    # '0000223325',
    # '0000224997',
    # '0000222666',
    # '0000217265',
    # '0000216521',
    # '0000210810',
    # '0000207124',
    # '0000206684',
    # '0000201647',
    # '0000195933',
    # '0000186112',
    # '0000183992',
    # '0000179749',
    # '0000171101',
    # '0000171630',
    # '0000171488',
    # '0000167073',
    # '0000154178',
    # '0000146925',
    # '0000144861',
    # '0000144813',
    # '0000144370',
    # '0000144209',
    # '0000139719',
    # '0000136430',
    # '0000133116',
    # '0000132241',
    # '0000130672',
    # '0000121606',
    # '0000127140',
    # '0000124925',
    # '0000124187',
    # '0000121087',
    # '0000116560',
    # '0000115362',
    # '0000114383',
    # '0000109444',
    # '0000107922',
    # '0000109815',
    # '0000109624',
    # '0000108417',
    # '0000103624',
    # '0000108580',
    # '0000107547',
    # '0000106403',
    # '0000106150',
    # '0000104717',
    # '0000105443',
    # '0000104893',
    # '0000097316',
    # '0000100679',
    # '0000097998',
    # '0000100887',
    # '0000099256',
    # '0000089881',
    # '0000097716',
    # '0000093623',
    # '0000096722',
    # '0000095342',
    # '0000094881',
    # '0000083121',
    # '0000075508',
    # '0000087670',
    # '0000072586',
    # '0000086641',
    # '0000084678',
    # '0000082137',
    # '0000082699',
    # '0000081582',
    # '0000068470',
    # '0000082312',
    # '0000079849',
    # '0000079827',
    # '0000079235',
    # '0000078704',
    # '0000075683',
    # '0000076693',
    # '0000069315',
    # '0000075450',
    # '0000075953',
    # '0000073983',
    # '0000072790',
    # '0000064511',
    # '0000072093',
    # '0000070790',
    # '0000070851',
    # '0000069983',
    # '0000070348',
    # '0000070087',
    # '0000069600',
    # '0000067663',
    # '0000069432',
    # '0000067912',
    # '0000066104',
    # '0000064518',
    # '0000063527',
    # '0000065325',
    # '0000062594',
    # '0000062574',
    # '0000059625',
    # '0000059492',
    # '0000060730',
    # '0000060409',
    # '0000059307',
    # '0000058915',
    # '0000056964',
    # '0000057728',
    # '0000056031',
    # '0000056561',
    # '0000056738',
    # '0000054418',
    # '0000055912',
    # '0000052733',
    # '0000052910',
    # '0000049952',
    # '0000051440',
    # '0000050948',
    # '0000050306',
    # '0000045833',
    # '0000049427',
    # '0000049387',
    # '0000048645',
    # '0000049056',
    # '0000047934',
    # '0000047244',
    # '0000047030',
    # '0000046731',
    # '0000046440',
    # '0000043467',
    # '0000045857',
    # '0000045641',
    # '0000043226',
    # '0000044777',
    # '0000044577',
    # '0000044260',
    # '0000043695',
    # '0000041811',
    # '0000040398',
    # '0000037873',
    # '0000033018',
    # '0000038114',
    # '0000037545',
    # '0000038544',
    # '0000037957',
    # '0000037568',
    # '0000034968',
    # '0000035770',
    # '0000035275',
    # '0000033768',
    # '0000032649',
    # '0000029756',
    # '0000029621',
    # '0000028860',
    # '0000027471',
    # '0000027497',
    # '0000027591',
    # '0000026874',
    # '0000026438',
    # '0000025769',
    # '0000026012',
    # '0000024354',
    # '0000017753',
    # '0000023302',
    # '0000022931',
    # '0000016853',
    # '0000022693',
    # '0000020596',
    # '0000023144',
    # '0000021598',
    # '0000021977',
    # '0000020227',
    # '0000019880',
    # '0000019193',
    # '0000014128',
    # '0000016274',
    # '0000015995',
    # '0000015552',
    # '0000016065',
    # '0000015501',
    # '0000011226',
    # '0000014800',
    # '0000012483',
    # '0000011871',
    # '0000011737',
    # '0000011591',
    # '0000010696',
    # '0000011274',
    # '0000010660',
    # '0000009831',
    # '0000007187',
    # '0000006923',
    # '0000006791',
    # '0000004324',
    # '0000002251',
    # '0000760312',
    # '0000759991',
    # '0000684374',
    # '0000684366',
    # '0000673893',
    # '0000636771',
    # '0000616517',
    # '0000478929',
    # '0000379574',
    # '0000377163',
    # '0000360701',
    # '0000352848',
    # '0000346063',
    # '0000333979',
    # '0000329573',
    # '0000326587',
    # '0000325752',
    # '0000323946',
    # '0000319968',
    # '0000319537',
    # '0000313140',
    # '0000313335',
    # '0000311546',
    # '0000308183',
    # '0000305180',
    # '0000302817',
    # '0000300196',
    # '0000295898',
    # '0000295452',
    # '0000294679',
    # '0000293968',
    # '0000293205',
    # '0000291803',
    # '0000291115',
    # '0000288470',
    # '0000288091',
    # '0000288816',
    # '0000287031',
    # '0000284830',
    # '0000246335',
    # '0000235550',
    # '0000233164',
    # '0000222843',
    # '0000221256',
    # '0000219832',
    # '0000212144',
    # '0000212092',
    # '0000187168',
    # '0000173377',
    # '0000166294',
    # '0000165153',
    # '0000162581',
    # '0000161895',
    # '0000151326',
    # '0000148006',
    # '0000141317',
    # '0000135878',
    # '0000130020',
    # '0000122489',
    # '0000114136',
    # '0000120619',
    # '0000119699',
    # '0000111726',
    # '0000106418',
    # '0000107392',
    # '0000106766',
    # '0000106213',
    # '0000105622',
    # '0000095097',
    # '0000100551',
    # '0000093691',
    # '0000067459',
    # '0000087281',
    # '0000088012',
    # '0000085139',
    # '0000085112',
    # '0000084500',
    # '0000081968',
    # '0000079715',
    # '0000077664',
    # '0000080230',
    # '0000080451',
    # '0000076661',
    # '0000077431',
    # '0000070356',
    # '0000058058',
    # '0000066285',
    # '0000065348',
    # '0000067092',
    # '0000066791',
    # '0000064238',
    # '0000063796',
    # '0000061298',
    # '0000059084',
    # '0000058719',
    # '0000057827',
    # '0000056440',
    # '0000055396',
    # '0000054811',
    # '0000028502',
    # '0000051300',
    # '0000051899',
    # '0000051042',
    # '0000047774',
    # '0000047950',
    # '0000046181',
    # '0000033744',
    # '0000038389',
    # '0000037343',
    # '0000036758',
    # '0000034886',
    # '0000031738',
    # '0000029387',
    # '0000027151',
    # '0000022237',
    # '0000008042',
    # '0000007411',
    # '0000002710',
    # '0000000893',
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
    # TODO list children of the KRSs
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
