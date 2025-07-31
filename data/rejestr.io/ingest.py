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

    # TODO reenable "historyczne"
    for aktualnosc in ["aktualne"]:
        connections = get_rejestr_io(
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc={aktualnosc}"
        )
        for connection in connections:
            print("Saving connection")
            connection["state"] = aktualnosc
            type = "person"
            if connection["typ"] == "organizacja":
                type = "org"
            current_org.ref.child("connections").child(type).update(
                {connection["id"]: connection}
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


if __name__ == "__main__":
    for krs in KRSs:
        save_org_connections(krs)
