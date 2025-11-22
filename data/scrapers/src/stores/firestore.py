from typing import Any, Iterable

from google.cloud import firestore


from scrapers.stores import IO


class FirestoreIO:
    db: firestore.Client

    def __init__(self):
        print("Connecting to Firestore...")
        # Use a service account for authentication.
        # Make sure to point to your service account key file.
        # You can also use `gcloud auth application-default login`
        try:
            self.db = firestore.Client(project="koryta-pl", database="koryta-pl")
            print("Successfully connected to Firestore.")
        except Exception as e:
            print(f"Failed to connect to Firestore: {e}")
            print("Please ensure you have authenticated correctly.")
            exit(1)

    def read_collection(
        self, collection: str, stream=True, filters: list[tuple[str, str, Any]] = []
    ) -> Iterable:
        print(f"Reading collection {collection} with {filters}")

        collection_ref = self.db.collection(collection)
        for field, op, value in filters:
            collection_ref = collection_ref.where(
                filter=firestore.FieldFilter(field, op, value)
            )
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
