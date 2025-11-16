from typing import Any

from time import sleep
from google.cloud import firestore
from tqdm import tqdm
from dataclasses import dataclass
import functools


from scrapers.stores import IO


class FirestoreIO(IO):
    db: firestore.Client

    def __init__(self):
        print("Connecting to Firestore...")
        # Use a service account for authentication.
        # Make sure to point to your service account key file.
        # You can also use `gcloud auth application-default login`
        try:
            self.db = firestore.Client(project="koryta-pl", database="koryta-pl")
            print("Successfully connected to Firestore.")
            sleep(5)
        except Exception as e:
            print(f"Failed to connect to Firestore: {e}")
            print("Please ensure you have authenticated correctly.")
            exit(1)

    def read_collection(
        self, collection: str, stream=True, filters: list[tuple[str, str, Any]] = []
    ):
        print(collection)
        print(filters)
        collection_ref = self.db.collection(collection)
        for field, op, value in filters:
            collection_ref = collection_ref.where(
                filter=firestore.FieldFilter(field, op, value)
            )
        if stream:
            return collection_ref.stream()
        else:
            for doc in collection_ref.get():
                yield doc

    def dump_memory(self, tables_to_dump: None | dict[str, list[str]] = None):
        # FirestoreIO does not manage in-memory tables, so this is a no-op
        raise NotImplementedError()

    def output_entity(self, entity):
        raise NotImplementedError()

        # Assuming entity has a 'to_dict' method and 'id' attribute
        if hasattr(entity, "to_dict") and hasattr(entity, "id"):
            collection_name = entity.__class__.__name__.lower()
            doc_ref = self.db.collection(collection_name).document(entity.id)
            doc_ref.set(entity.to_dict())
        else:
            raise ValueError("Entity must have 'to_dict' method and 'id' attribute")


# db_keys is set to automatically recognize keys that refer to collection keys
def extract_keys(
    prefix: str, d: dict, db_keys
) -> tuple[list[tuple[str, bool]], set[str]]:
    result = []
    values = set()
    for k, v in d.items():
        # TODO update to match Firestore keys as well
        if k in db_keys or (len(k) == 20 and k[0] == "-"):
            k = "<key>"
        is_present = v is not None and v != "" and v != [] and v != {}
        result.append((prefix + "." + k, is_present))
        if isinstance(v, dict):
            keys, sub_values = extract_keys(prefix + "." + k, v, db_keys)
            result += keys
            values.update(sub_values)
        else:
            values.add(str(v))
    return result, values


@functools.total_ordering
@dataclass
class Presence:
    total: int = 0
    present: int = 0

    def __add__(self, other):
        return Presence(
            self.total + other.total,
            self.present + other.present,
        )

    def __eq__(self, other):
        return self.present == other.present

    def __lt__(self, other):
        return self.present < other.present


def path_occurrence(io: FirestoreIO):
    keys = dict()
    collections = dict()
    string_values = set()
    object_keys = set()

    for collection in io.db.collections():
        counter = 0
        for doc in tqdm(collection.stream(), collection.id):
            object_keys.add(doc.id)
            collection_type = collection.id
            data = doc.to_dict()
            if "type" in data:
                collection_type += f"[{data['type']}]"
            counter += 1
            keys_presence, doc_string_values = extract_keys(collection_type, data, {})
            string_values.update(doc_string_values)
            for key, presence in keys_presence:
                keys[key] = keys.get(key, Presence()) + Presence(1, int(presence))
        collections[collection.id] = counter

    # analysis = f"""
    # Person -> Company by ID: {keys["person.employments"]}
    # """

    for k in tqdm(object_keys):
        for v in list(string_values):
            if k in v:
                string_values.remove(v)

    return keys, None, collections, string_values
