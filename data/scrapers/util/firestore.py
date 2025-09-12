from google.cloud import firestore
from tqdm import tqdm

print("Connecting to Firestore...")
# Use a service account for authentication.
# Make sure to point to your service account key file.
# You can also use `gcloud auth application-default login`
try:
    firestore_db = firestore.Client(project="koryta-pl")
    print("Successfully connected to Firestore.")
except Exception as e:
    print(f"Failed to connect to Firestore: {e}")
    print("Please ensure you have authenticated correctly.")
    exit(1)

# db_keys is set to automatically recognize keys that refer to collection keys
def extract_keys(prefix: str, d: dict, db_keys): 
    result = []
    for k, v in d.items():
        # TODO update to match Firestore keys as well
        if k in db_keys or (len(k) == 20 and k[0] == '-'):
            k = "<key>"
        result.append(prefix + "." + k)
        if isinstance(v, dict):
            result += extract_keys(prefix + "." + k, v, db_keys)
    return result

def path_occurrence():
    keys = dict()
    collections = dict()
    
    for collection in firestore_db.collections():
        counter = 0
        for doc in tqdm(collection.stream(), collection.id):
            counter += 1
            for key in extract_keys(collection.id, doc.to_dict(), {}):
                keys[key] = keys.get(key, 0) + 1
        collections[collection.id] = counter
                
    return keys, collections