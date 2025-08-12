import requests
from db import DBModel
from typing import Any
from time import sleep
from random import random
from firebase_admin import db
from tqdm import tqdm

LIST_URL="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements/search?page={page}&limit=100&sort=default&status%5B0%5D=PUBLISHED"
ITEM_URL="https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements/{id}"

root_basic = db.reference("/external/kpo")

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
            root_basic.update({adv["id"]: adv})
        
        # Sleep a few seconds so the gods don't smite us
        sleep(random() * 10)

        page += 1
        
def iterate_items():
    existing = root_basic.get()
    detailed = DBModel("/external/kpo_detailed")
    current = detailed.get()
    if current:
        assert(isinstance(current, dict))
    else:
        current = {}
    assert(isinstance(existing, dict))
    
    print(f"Found {len(existing)} items to process, {len(current)} already processed")
    to_process = set(existing.keys()) - set(current.keys())
    for id in tqdm(to_process, initial=len(current), total=len(existing), smoothing=0.01):        
        print(f"trying to read {id}")
        data = query_item(id, 3)
        detailed.update({id: data})
            

if __name__ == "__main__":
    try:
        # Already done iterate_pages()
        iterate_items()

    except InterruptedError:
        print("Interrupted")
    finally:
        pass
        # state_after = root_basic.get()
        # assert isinstance(state_after, dict)
        # print(f"Now having {len(state_after)} items")