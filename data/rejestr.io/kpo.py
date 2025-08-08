# TODO migrate the folder to some more abstract name, e.g. data/scrapers

import requests
from db import DBModel
from typing import Any
from time import sleep
from random import random
from firebase_admin import db


BAZA_KONKURENCYJNOSCI_URL="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements/search?page={page}&limit=100&sort=default&status%5B0%5D=PUBLISHED"

def query_kpo(page: int) -> dict[str, Any]:
    url = BAZA_KONKURENCYJNOSCI_URL.format(page=page)
    return requests.get(url).json()

if __name__ == "__main__":
    root = db.reference("/external/kpo")
    try:
        page = 0
        while True:
            print("Querying page", page, "...")
            result = query_kpo(page)
            for adv in result["data"]["advertisements"]:
                print(f"Saving {adv['id']}...")
                root.update({adv["id"]: adv})
            
            # Sleep a few seconds so the gods don't smite us
            sleep(random() * 10)

            page += 1

    except InterruptedError:
        print("Interrupted")
    finally:
        state_after = root.get()
        assert isinstance(state_after, dict)
        print(f"Now having {len(state_after)} items")