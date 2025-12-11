import sys
from typing import Any, Iterable

from google.cloud import firestore
from memoized_property import memoized_property  # type:ignore


class FirestoreIO:
    @memoized_property
    def db_client(self) -> firestore.Client:
        print("Connecting to Firestore client...")
        try:
            result = firestore.Client(project="koryta-pl", database="koryta-pl")
            print("Successfully connected to Firestore.")
            return result
        except Exception as e:
            print(f"Failed to connect to Firestore: {e}")
            print("Please ensure you have authenticated correctly.")
            print("Use a service account for authentication.")
            print("Make sure to point to your service account key file.")
            print("You can also use `gcloud auth application-default login`")
            sys.exit(1)

    def read_collection(self, collection: str, stream=True, filters: list[tuple[str, str, Any]] = []) -> Iterable:
        print(f"Reading collection {collection} with {filters}")

        collection_ref = self.db_client.collection(collection)
        for field, op, value in filters:
            collection_ref = collection_ref.where(filter=firestore.FieldFilter(field, op, value))
        if stream:
            for elt in collection_ref.stream():
                yield elt
        else:
            for doc in collection_ref.get():
                yield doc

    def output_entity(self, entity):
        raise NotImplementedError()

        # Assuming entity has a 'to_dict' method and 'id' attribute
        if hasattr(entity, "to_dict") and hasattr(entity, "id"):
            collection_name = entity.__class__.__name__.lower()
            doc_ref = self.db.collection(collection_name).document(entity.id)
            doc_ref.set(entity.to_dict())
        else:
            raise ValueError("Entity must have 'to_dict' method and 'id' attribute")
