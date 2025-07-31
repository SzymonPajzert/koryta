import firebase_admin
from firebase_admin import db
from db import KRSs


def list_all():
    companies = db.reference("/external/rejestr-io/krs/").get()
    assert isinstance(companies, dict)
    for id, company in companies.items():
        if "connections" not in company:
            continue
        if "person" not in company["connections"]:
            continue
        for person in company["connections"]["person"].values():
            print(
                ",".join(
                    [
                        id,
                        company["basic"]["nazwy"]["skrocona"],
                        person["tozsamosc"]["imiona_i_nazwisko"],
                        person["state"],
                    ]
                )
            )


if __name__ == "__main__":
    list_all()
