import sys
import firebase_admin
from firebase_admin import db

firebase_admin.initialize_app(
    options={
        "databaseURL": "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app"
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
    "0000031962", # NFOŚiGW
    "0000146138", # Miejskie Przedsiębiorstwo Wodociągów i Kanalizacji (MPWiK)
    "0000050531", # WarEXPO
    "0000173077", # Miejskie Przedsiębiorstwo Realizacji Inwestycji w Warszawie
    "0000206762", # SKM
    "0000478458", # Szpital Grochowski
    "0000019230", # TBS Bemowo
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

# TODO 
# https://rejestr.io/krs/146138/miejskie-przedsiebiorstwo-wodociagow-i-kanalizacji-w-m-st-warszawie
# Bardzo dobre źródło ludzi w spółkach
# TODO Dla tych oznaczonych, znajdź najpopularniejsze ich miejsca pracy

PEOPLE = [
    ("720445", "marcin-skwierawski"),
]

class KRSRef:
    def __init__(self, krs: str):
        self.krs = krs
        self.ref = db.reference(f"/external/rejestr-io/krs/{krs}")

    def is_scraped(self) -> bool:
        current = self.ref.get()
        if current is not None and "read" in current:
            print(f"Already read KRS {self.krs}, SKIPPING...")
            return True
        return False


class PersonRef:
    def __init__(self, id: str):
        self.id = id
        self.ref = db.reference(f"/external/rejestr-io/person/{id}")

    def is_scraped(self, expect_full=False) -> bool:
        current = self.ref.get()
        assert(not isinstance(current, tuple))
        if current is not None and (not expect_full or "read" in current) and "name" in current:
            print(f"Already read person {self.id} - {current['name']}, SKIPPING...")
            return True
        return False