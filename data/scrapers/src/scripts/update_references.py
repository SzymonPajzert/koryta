"""
This script updates references in Firestore collections after a migration from RTDB.

It iterates through documents in a source collection (e.g., 'article'), and for each
document, it updates the 'links' array. It replaces the old RTDB-based IDs
in the links with the new Firestore document IDs by looking up the corresponding
documents in the target collections ('person', 'place') using the stored 'rtdb_id'.
"""

from stores.firestore import firestore_db, path_occurrence
from tqdm import tqdm
import json


def get_id_mapping(collections: list[str]) -> dict[str, str]:
    """
    Creates a mapping from rtdb_id to Firestore document ID for a given collection.

    Args:
        collection_name: The name of the Firestore collection (e.g., 'person', 'place').

    Returns:
        A dictionary mapping {rtdb_id: firestore_id}.
    """
    mapping = {}
    for collection_name in collections:
        prev_size = len(mapping)
        print(f"Creating ID mapping for collection: '{collection_name}'...")
        docs = firestore_db.collection(collection_name).stream()
        for doc in tqdm(docs, desc=f"Mapping {collection_name}"):
            data = doc.to_dict()
            assert data is not None
            if "rtdb_id" in data:
                mapping[data["rtdb_id"]] = "/".join([collection_name, doc.id])
            else:
                raise ValueError("Missing rtdb_id in Firestore document")
        print(f"Found {len(mapping) - prev_size} entries in '{collection_name}'.")
    return mapping


def update_links(mapping):
    batch = firestore_db.batch()

    for collection in firestore_db.collections():
        print(f"Updating links in collection: '{collection.id}'")
        for doc in tqdm(collection.stream(), collection.id):
            data = doc.to_dict()
            raw = json.dumps(data)
            update = False
            for source, replacement in mapping.items():
                if source in raw:
                    update = True
                    raw = raw.replace(source, replacement)
            if update:
                updated = json.loads(raw)
                batch.set(
                    firestore_db.collection(collection.id).document(doc.id), updated
                )
                print(f"Updated {collection.id}/{doc.id}")

    batch.commit()


if __name__ == "__main__":
    mapping = get_id_mapping(["person", "place", "article"])
    print()
    # TODO remove fields that are flukes in the DB, by % of usage
    paths, _, collections, _ = path_occurrence()

    print(json.dumps(mapping, indent=2))
    # print(json.dumps(firestore_paths(mapping), indent=2))

    # 2. Update references in the 'article' collection
    update_links(mapping)
    # print("\nReference migration complete!")
