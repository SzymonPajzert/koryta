"""
We will iterate data in rtdb://external/rejestr-io/person

This script migrates data from Firebase Realtime Database (RTDB) to Cloud Firestore.
It reads person data from `rtdb://external/rejestr-io/person`, transforms it,
and writes it to two new collections in Firestore: `external` and `votes`.

This corresponds to data referenced in model.ts as PersonRejestr

DONE Create entry in firestore://external/{newRandomID1} with fields:
  - person.name.first
  - person.name.last
  - person.name.full
  - person.gender
  - person.birth.date
  - source.id - e.g. 599
  - source.type - "rejestr-io/person"
  
DONE Create an entry in firestore://votes/{newRandomID2} with fields:
  - reference
    - entity_id - not set this time
    - external_id - set to newRandomID1
  - scores collection (each document for user of our website). If score is set, we will use UID of0BKlwqWLX21Cuml4NMHZ18xoC3, my vote
    - score - number
    
"""

import firebase_admin
from firebase_admin import db
from google.cloud import firestore
from tqdm import tqdm

print("Connecting to databases...")
DATABASE_URL = "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app"            
firebase_admin.initialize_app(
    options={
        "databaseURL": DATABASE_URL,
        "databaseAuthVariableOverride": {"uid": "reader"},
    }
)

firestore_db = firestore.Client(project="koryta-pl", database="koryta-pl")
print("Successfully connected to Firestore.")

def migrate_rejestr_io_data():
    """
    Migrates person data from Firebase RTDB to Cloud Firestore.
    """
    
    print("Reading data from RTDB path: external/rejestr-io/person")
    people_ref = db.reference("external/rejestr-io/person")
    people_data = people_ref.get()

    if not people_data:
        print("No data found at the specified RTDB path. Exiting.")
        return

    print(f"Found {len(people_data)} entries to migrate.")

    # Use a batch to write to Firestore for efficiency
    batch = firestore_db.batch()

    for person_rtdb_id, person in people_data.items():
        print(f"Processing person: {person.get('name', 'N/A')} (ID: {person_rtdb_id})")

        # Create a new document in the 'external' collection
        external_doc_ref = firestore_db.collection("external").document()

        tozsamosc = person.get("external_basic", {}).get("tozsamosc", {})
        first_name = tozsamosc.get("imie")
        last_name = tozsamosc.get("nazwisko")
        gender = tozsamosc.get("plec")
        external_data = {
            "person": {
                "name": {
                    "first": first_name,
                    "last": last_name,
                    "full": person.get("name", ""),
                },
                "gender": gender,
                "birth": {
                    "date": tozsamosc.get("data_urodzenia"),
                },
            },
            "source": {
                "id": person_rtdb_id,
                "type": "rejestr-io/person",
            },
        }
        batch.set(external_doc_ref, external_data)

        # If there's a score, create a corresponding 'votes' entry
        if "score" in person and person["score"] != 0:
            votes_doc_ref = firestore_db.collection("votes").document()
            vote_data = {
                "reference": {"external_id": external_doc_ref.id},
                "scores": {
                    "of0BKlwqWLX21Cuml4NMHZ18xoC3": {"general": person["score"]}
                },
            }
            batch.set(votes_doc_ref, vote_data)

    print("Committing batch to Firestore...")
    batch.commit()
    print("Migration complete!")
    
def copy_entries(source: str, destination: str):
    """
    Migrates person data from Firebase RTDB to Cloud Firestore.
    """
    
    print(f"Reading data from RTDB path: {source}")
    people_ref = db.reference(source)
    people_data = people_ref.get()

    if not people_data:
        print("No data found at the specified RTDB path. Exiting.")
        return

    print(f"Found {len(people_data)} entries to migrate.")

    # Use a batch to write to Firestore for efficiency
    batch = firestore_db.batch()

    for person_rtdb_id, data in tqdm(people_data.items()):
        # Create a new document in the 'external' collection
        external_doc_ref = firestore_db.collection(destination).document()
        data["rtdb_id"] = person_rtdb_id        
        batch.set(external_doc_ref, data)

    print("Committing batch to Firestore...")
    batch.commit()
    print("Migration complete!")

if __name__ == "__main__":
    # DONE migrate_rejestr_io_data()
    # DONE copy_entries("employed", "person")
    # DONE copy_entries("company", "place")
    # DONE copy_entries("data", "article")
    pass
