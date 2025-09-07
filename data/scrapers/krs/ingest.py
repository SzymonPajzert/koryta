# Ingest data from rejestr.io API and put it into our Firebase DB

# Iterate given KRS numbers
# Check if the KRS-ORG ID is populated
# save each in /rejestr/krs/{KRS_ID}/connection
# From /rejestr/krs/{KRS_ID}/connection/{ID}/

from datetime import datetime
from db import KRSRef, PersonRef
from data.scrapers.util.rejestr import get_rejestr_io
from db import orgs_to_process, people_to_process, Aktualnosc, something_removed
from firebase_admin import db
import json


# KRS always has 10 digits
def int_to_krs(number: int) -> str:
    return str(number).zfill(10)


def save_org_connections(krs: str, aktualnosci: list[Aktualnosc]):
    current_org = KRSRef(krs)
    if not current_org.is_scraped():
        basic = get_rejestr_io(f"https://rejestr.io/api/v2/org/{krs}")
        current_org.update({"read": f"{datetime.now()}", "basic": basic})

    for aktualnosc in sorted(aktualnosci, reverse=True):
        connections = get_rejestr_io(
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc={aktualnosc}"
        )
        for connection in connections:
            print(f"Saving connection {connection['id']}...  ")
            type = "person"
            if connection["typ"] == "organizacja":
                type = "org"
            current_org.update(
                {
                    f"connections/{connection['id']}/state": aktualnosc,
                    f"connections/{connection['id']}/type": type,
                }
            )
            current_org.push(
                f"connections/{connection['id']}/relation",
                connection["krs_powiazania_kwerendowane"],
            )

            # Don't write it to the external_basic
            del connection["krs_powiazania_kwerendowane"]

            if type == "org":
                new_org = KRSRef(int_to_krs(connection["id"]))
                if not new_org.is_scraped():
                    new_org.update(
                        {"to_read": f"{datetime.now()}", "external_basic": connection}
                    )
            else:
                # This is always a person
                new_person = PersonRef(connection["id"])
                if not new_person.is_scraped():
                    new_person.update(
                        {
                            "to_read": f"{datetime.now()}",
                            "external_basic": connection,
                            "name": connection["tozsamosc"]["imiona_i_nazwisko"],
                        }
                    )


if __name__ == "__main__":
    show_diff = True

    state_before = None
    state_after = None
    if show_diff:
        state_before = db.reference("/external/rejestr-io").get()
    db_dump = open("./db_dump.json", "w")
    db_dump.write(json.dumps(state_before))

    try:
        while True:
            orgs = orgs_to_process()
            print(
                f"Will try to perform {len(orgs)} reads, which would cost {len(orgs) / 10} PLN [yN]"
            )
            if input() != "y":
                break
            for krs, aktualnosci in orgs.items():
                print(f"Processing {krs}")
                save_org_connections(krs, aktualnosci)

            if len(orgs) == 0:
                break

            print("Loop finished. Should I continue? [yN]")
            if input() != "y":
                break
    except InterruptedError:
        print("Interrupted")
    finally:
        if show_diff:
            state_after = db.reference("/external/rejestr-io").get()
            assert isinstance(state_before, dict)
            assert isinstance(state_after, dict)
            print(
                "Diff:"
                + "\n  ".join(
                    [
                        k + " " + v
                        for (k, v) in something_removed(state_before, state_after)
                    ]
                )
            )
