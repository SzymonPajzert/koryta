# Ingest data from rejestr.io API and put it into our Firebase DB

# Iterate given KRS numbers
# Check if the KRS-ORG ID is populated
# TODO get company connections by KRS number
# save each in /rejestr/krs/{KRS_ID}/connection/


# From /rejestr/krs/{KRS_ID}/connection/{ID}/

import requests
from datetime import datetime
from db import KRSRef, PersonRef
from rejestr import REJESTR_KEY
from db import KRSs
from firebase_admin import db


def get_rejestr_io(url: str):
    response = requests.get(url, headers={"Authorization": REJESTR_KEY})
    js = response.json()
    print(url)
    return js


# KRS always has 10 digits
def int_to_krs(number: int) -> str:
    return str(number).zfill(10)


def save_org_connections(krs: str):
    current_org = KRSRef(krs)
    if current_org.is_scraped():
        return
    basic = get_rejestr_io(f"https://rejestr.io/api/v2/org/{krs}")
    current_org.ref.update({"read": f"{datetime.now()}", "basic": basic})

    for aktualnosc in ["aktualne", "historyczne"]:
        connections = get_rejestr_io(
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc={aktualnosc}"
        )
        for connection in connections:
            print(f"Saving connection {connection['id']}...  ", end="")
            type = "person"
            if connection["typ"] == "organizacja":
                type = "org"
            current_org.ref.child("connections").child(f"{connection["id"]}").set(
                {
                    "state": aktualnosc,
                    "type": type,
                }
            )

            if type == "org":
                new_org = KRSRef(int_to_krs(connection["id"]))
                if not new_org.is_scraped():
                    new_org.ref.update(
                        {"to_read": f"{datetime.now()}", "external_basic": connection}
                    )
            else:
                # This is always a person
                new_person = PersonRef(connection["id"])
                if not new_person.is_scraped():
                    new_person.ref.update(
                        {
                            "to_read": f"{datetime.now()}",
                            "external_basic": connection,
                            "name": connection["tozsamosc"]["imiona_i_nazwisko"],
                        }
                    )
                    
            print("DONE")


def something_removed(prev: dict, after: dict) -> list[tuple[str, str]]:
    def diff_pair(k, v):
        if k not in after:
            return [(k, "removed")]
        if isinstance(v, dict) and isinstance(after[k], dict):
            return [(k  + "." + n, t) for n, t in something_removed(v, after[k])]
        elif v != after[k]:
            return [(k, "changed")]
        return []

    return [r for k, v in prev.items() for r in diff_pair(k, v)] + [
        (k, "added") for k in after.keys() if k not in prev
    ]


if __name__ == "__main__":
    state_before = db.reference("/external/rejestr-io").get()
    # TODO dump it somewhere in case it breaks

    for krs in KRSs:
        save_org_connections(krs)

    state_after = db.reference("/external/rejestr-io").get()

    assert isinstance(state_before, dict)
    assert isinstance(state_after, dict)
    print(
        "Diff:"
        + "\n  ".join(
            [k + " " + v for (k, v) in something_removed(state_before, state_after)]
        )
    )
