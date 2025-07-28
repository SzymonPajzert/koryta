import sys
import firebase_admin
from firebase_admin import db

firebase_admin.initialize_app(
    options={
        "databaseURL": "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app"
    }
)

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
]

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

    def is_scraped(self) -> bool:
        current = self.ref.get()
        if isinstance(current, tuple):
            print(f"Unexpectedly the read value of {id} is a tuple")
            sys.exit(1)
        if current is not None and "read" in current and "name" in current:
            print(f"Already read person {self.id} - {current['name']}, SKIPPING...")
            return True
        return False