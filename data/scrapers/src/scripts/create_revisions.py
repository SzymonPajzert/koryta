from google.cloud import firestore
from tqdm import tqdm

db = firestore.Client(project="koryta-pl", database="koryta-pl")


def create_revisions(
    source_collection,
    dest_collection,
    migrate_node_types: list[str] | None,
    remove_node_types: list[str],
    ignore_migrate_node_types: list[str] = [],
    limit=1000,
):
    """
    Reads data from SOURCE_COLLECTION, copies values to new documents in DEST_COLLECTION
    and links the new document's ID in the original document using LINK_FIELD.
    """
    source_ref = db.collection(source_collection)
    dest_ref = db.collection(dest_collection)

    print(f"Fetching documents from {source_collection}...")

    count = 0
    for doc in tqdm(list(source_ref.stream()), mininterval=5):
        data = doc.to_dict()

        if count >= limit:
            print(f"Limit {limit} reached")
            break

        if data is None:
            continue

        if data["type"] in remove_node_types:
            source_ref.document(doc.id).delete()
            print(
                f"Deleted document {doc.id} from {source_collection} \
                    with {data['type']}"
            )
            count += 1
            continue

        if migrate_node_types is not None and data["type"] not in migrate_node_types:
            continue
        if data["type"] in ignore_migrate_node_types:
            continue

        if "revision_id" in data:
            continue

        new_doc_ref = dest_ref.document()
        for removable in ["user", "date", "source", "target"]:
            if removable in data:
                del data[removable]

        new_doc_ref.set(
            {
                "node_id": source_ref.document(doc.id),
                "update_user": "of0BKlwqWLX21Cuml4NMHZ18xoC3",
                "update_time": firestore.SERVER_TIMESTAMP,
                "data": data,
            }
        )
        doc.reference.update({"revision_id": dest_ref.document(new_doc_ref.id)})
        count += 1
        print(
            f"Migrated document {doc.id} from {source_collection} \
                with {data['type']} to {new_doc_ref.id}"
        )

    print(
        f"Successfully created {count} revisions in {dest_collection} \
            and updated {source_collection}."
    )


def main():
    create_revisions("nodes", "revisions", ["person", "place", "article"], ["record"])
    create_revisions(
        "edges",
        "revisions",
        # mentions - article and person / company
        # employed person and company
        # owns company to company
        # connection - person to person
        None,  # basically ["employed", "mentions", "owns", "connection"]
        [],
        # comment - to be removed
        # source - node to blob
        ignore_migrate_node_types=["comment", "source"],
    )
