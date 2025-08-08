# TODO migrate the folder to some more abstract name, e.g. data/scrapers

import requests
from db import DBModel
from typing import Any
from time import sleep
from random import random
from firebase_admin import db

LIST_URL="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements/search?page={page}&limit=100&sort=default&status%5B0%5D=PUBLISHED"
ITEM_URL="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements/{id}"

root = db.reference("/external/kpo")

def query_kpo(page: int) -> dict[str, Any]:
    url = LIST_URL.format(page=page)
    return requests.get(url).json()

def query_item(id: str, sleep_time) -> dict[str, Any]:
    # Sleep a bit
    sleep(random() * sleep_time)
    url = ITEM_URL.format(id=id)
    return requests.get(url).json()

def iterate_pages():
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
        
def iterate_items():
    data = root.get()
    assert(isinstance(data, dict))
    for id, value in data.items():
        if "read" not in value:
            print(f"trying to read {id}")
            data = query_item(id, 5)
            root.update({id: {"read": True, "data": data}})
            

if __name__ == "__main__":
    try:
        # Already done iterate_pages()
        iterate_items()

    except InterruptedError:
        print("Interrupted")
    finally:
        state_after = root.get()
        assert isinstance(state_after, dict)
        print(f"Now having {len(state_after)} items")