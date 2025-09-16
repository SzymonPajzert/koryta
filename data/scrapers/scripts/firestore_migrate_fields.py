from util.firestore import firestore_db, path_occurrence
from google.cloud import firestore
from tqdm import tqdm
from dataclasses import dataclass

@dataclass
class Context:
    path: str
    value: dict
    db: firestore.Client
    batch: any
    root_id: str  # ID of the document that is being processed

def delete(verbose=False, confirm=False):
    def func(ctx: Context):
        collection, path = ctx.path.split(".", 1)
        if verbose or confirm:
            print(f"Deleting {collection}/{path}: {ctx.value}")
        if confirm and input("Are you sure? (y/n)") != "y":
            return
        ctx.batch.update(ctx.db.collection(collection).document(ctx.root_id), {path: firestore.DELETE_FIELD})        
    return func

@dataclass
class EdgeConfig:
    edge_type: str
    field_mapping: dict = None
    revert: bool = False
    
def remove_directory(id: str) -> str:
    if "/" in id:
        return id.split("/", 1)[1]
    return id

def create_edge(ctx: Context, source_id, target_id, edge_type, **kwargs):
    if "target" in kwargs:
        kwargs["target"] = remove_directory(kwargs["target"])

    ctx.batch.create(ctx.db.collection("edges").document(), document_data=dict({
        "source": remove_directory(source_id),
        "target": remove_directory(target_id),
        "type": edge_type,
    }, **kwargs))
    
def nested_access(config: EdgeConfig, value, field_name):
    if config.field_mapping is not None and field_name in config.field_mapping:
        obj = value
        for k in config.field_mapping[field_name].split("."):
            obj = obj.get(k, None)
            if obj is None:
                return None
        return obj
    return value.get(field_name, None)
    
def create_link(ctx: Context, root, value, config: EdgeConfig):
    data = {}

    for field in config.field_mapping:
        data[field] = nested_access(config, value, field)

    if data["target"] == "" or data["target"] is None:
        if len(data) > 0 and "".join(v for v in data.values() if v is not None) != "":
            raise ValueError(f"No ID found for {ctx.path}: {value}")
        return
        
    source = ctx.root_id
    if config.revert:
        source = data["target"]
        data["target"] = ctx.root_id
    create_edge(ctx, source, data["target"], config.edge_type, **data)
        
@dataclass
class BlobConfig:
    edge_type: str
    field_name: str
    extract_field: str
        
def create_and_link_blob(ctx: Context, root, value, config: BlobConfig):
    extracted_value = value
    if config.extract_field is not None:
        extracted_value = value[config.extract_field]
    
    if extracted_value == "" or extracted_value is None or extracted_value == {}:
        return
        
    blob_doc = ctx.db.collection("nodes").document()
    ctx.batch.create(blob_doc, document_data={
        "type":"blob",
        config.field_name: extracted_value
    })
    ctx.batch.create(ctx.db.collection("edges").document(), document_data={
        "source": ctx.root_id,
        "target": blob_doc.id,
        "type": config.edge_type,
    })
    
# Some links can be actually just text - in that case, move it to comment
def create_link_or_blob(ctx: Context, root, value, config: EdgeConfig):
    if nested_access(config, value, "target") not in ["", None, {}]:
        create_link(ctx, root, value, config)
    else:
        create_and_link_blob(ctx, root, value, BlobConfig(config.edge_type, "text", "text"))


def for_each_value(each_value_function, config):
    def func(ctx: Context):
        assert(isinstance(ctx.value, dict))
        for value in ctx.value.values():
            each_value_function(ctx, ctx.value, value, config)
        collection, path = ctx.path.split(".", 1)
        ctx.batch.update(ctx.db.collection(collection).document(ctx.root_id), {path: firestore.DELETE_FIELD})
    return func

def for_value(value_function, config):
    def func(ctx: Context):
        value_function(ctx, ctx.value, ctx.value, config)
        collection, path = ctx.path.split(".", 1)
        ctx.batch.update(ctx.db.collection(collection).document(ctx.root_id), {path: firestore.DELETE_FIELD})
    return func

# TODO report if found any paths without operation
OPERATIONS = {
    "article.date": None,
    "article.name": None,
    "article.sourceURL": None,
    "article.user": None,
    "article.shortName": None,
    "article.estimates.mentionedPeople": None,
    "article.status.tags": None,
    "article.subtitle": None,
    "external": None,
    "person.name": None,
    "person.parties": None,
    "person.user": None, # TODO Clean user and date in the future
    "person.date": None,
    "person.imageUrl": None,
    "place.name": None,
    "place.krsNumber": None,
    # TODO user, date should be somewhere else, e.g audits collection
    "place.user": None,
    "place.date": None,
    "suggestions": None,
    "votes": None,

    "suggestions": delete(),
    "article.status": delete(),
    "article.enrichedStatus": delete(),
    "article.rtdb_id": delete(),
    "article.isFetchingTitle": delete(),
    "article.destination": delete(),
    "article.status.markedDone": delete(),
    "article.status.signedUp": delete(),
    "article.equal": delete(),
    "article.similarity": delete(),
    "article.priority": delete(),
    "article.hasPlace": delete(),
    "article.issues": delete(),
    "person.rtdb_id": delete(),
    "person.priority": delete(),
    "person.hasPlace": delete(),
    "person.subtitle": delete(),
    "person.issues": delete(),
    "person.equal": delete(),
    "person.similarity": delete(),
    "person.destination": delete(),
    "person.descriptionLen": delete(),
    "person.sources": delete(),
    "place.rtdb_id": delete(),
    
    "article.companies": for_each_value(create_link, EdgeConfig("mentions", field_mapping={"target": "id"})),
    "article.people": for_each_value(create_link, EdgeConfig("mentions", field_mapping={"target": "id"})),
    "person.employments": for_each_value(
        create_link_or_blob,
        EdgeConfig(
            "employed",
            field_mapping={"target": "connection.id", "name": "relation", "text": "text"})),
    "person.connections": for_each_value(
        create_link_or_blob,
        EdgeConfig(
            "connection",
            field_mapping={"target": "connection.id", "name": "relation", "text": "text"},
        )
    ),
    "place.owners": for_each_value(create_link, EdgeConfig("owns", revert=True, field_mapping={"target": "id"})),
    "place.owner": for_value(create_link, EdgeConfig("owns", revert=True, field_mapping={"target": "id"})),
    "place.manager": for_value(create_link, EdgeConfig("employed", revert=True, field_mapping={"target": "id"})),
    
    "article.comments": for_each_value(create_and_link_blob, BlobConfig("comment", "text", "text")),
    "person.comments": for_each_value(create_and_link_blob, BlobConfig("comment", "text", "text")),
    "place.comments": for_each_value(create_and_link_blob, BlobConfig("comment", "text", "text")),
    "person.sourceURL": for_value(create_and_link_blob, BlobConfig("source", "url", None)),
}

def find_nested_fields(collection_name, data):
    nested_keys = set()
    for key, value in data.items():
        nested_keys.add(f"{collection_name}.{key}")
        if isinstance(value, dict):
            nested_keys.update(find_nested_fields(f"{collection_name}.{key}", value))
    return nested_keys

def perform_operations():
    bulk_writer = firestore_db.bulk_writer()

    for collection in firestore_db.collections():
        print(f"Performing operations in collection: '{collection.id}'")
        for doc in collection.stream():
            data = doc.to_dict()
            nested_keys = find_nested_fields(collection.id, data)
            
            for key, operation in OPERATIONS.items():
                if key in nested_keys:
                    if operation is None:
                        continue
                    # print(f"Performing operation for {key}")
                    field_path = key.split(".", 1)[1]
                    value = doc.get(field_path)
                    try:
                        operation(Context(key, value, firestore_db, bulk_writer, doc.id))
                    except KeyError:
                        print(f"KeyError for {key}, {value}")
                        raise
                    except:
                        print(f"Exception for {key}")
                        raise
                        
                
    bulk_writer.flush()
    print("Operations complete!")
    
def print_path_diff(paths_before, paths_after):
    added_paths = {}
    removed_paths = {}

    for path, count in paths_after.items():
        if path not in paths_before:
            added_paths[path] = count
        elif paths_after[path] > paths_before[path]:
            added_paths[path] = count - paths_before[path]

    for path, count in paths_before.items():
        if path not in paths_after:
            removed_paths[path] = count
        elif paths_before[path] > paths_after[path]:
            removed_paths[path] = count - paths_after[path]

    print("\n--- Path Differences ---")
    if added_paths:
        print("Added paths:")
        for path, count in added_paths.items():
            print(f"  + {path}: {count} entities")
    else:
        print("No new paths added.")

    if removed_paths:
        print("Removed paths:")
        for path, count in removed_paths.items():
            print(f"  - {path}: {count} entities")
    else:
        print("No paths removed.")

    if not added_paths and not removed_paths:
        print("No changes in paths detected.")

def migrate_to_nodes(collections: list[str]):
    print("\n--- Migrating documents to 'nodes' collection ---")
    bulk_writer = firestore_db.bulk_writer()
    nodes_collection_ref = firestore_db.collection("nodes")

    for collection_name in collections:
        collection_target = collection_name
        if isinstance(collection_name, tuple):
            collection_name, collection_target = collection_name
        print(f"Processing collection: '{collection_name}'")
        docs = firestore_db.collection(collection_name).stream()
        for doc in tqdm(docs, desc=f"Migrating {collection_name} to {collection_target}"):
            data = doc.to_dict()
            # Add a 'type' field to the node data
            data['type'] = collection_target
            # Create a new document in 'nodes' collection
            new_node_ref = nodes_collection_ref.document(doc.id) # Keep the same ID for now
            bulk_writer.set(new_node_ref, data)
            # Optionally, delete the original document if you want to move
            bulk_writer.delete(doc.reference)
            
    bulk_writer.flush()
    print("Migration complete!")

if __name__ == "__main__":
    paths_before, _, _, values_before = path_occurrence()
    
    perform_operations()
    
    # TODO compare Presence print_path_diff(paths_before, paths_after)
    
    migrate_to_nodes(["article", "person", "place", ("external", "record")])
    
    paths_after, _, _, values_after = path_occurrence()
    
    print(len(values_before), len(values_after))
    print("\n".join(list(values_before.difference(values_after))))
    print("\n".join(list(values_after.difference(values_before))))
