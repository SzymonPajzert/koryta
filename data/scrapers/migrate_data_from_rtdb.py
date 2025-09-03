"""
I've made a mistake. Keeping a lot of data (100 MB XD) in Firestore RTDB is expensive (20 PLN).
This script helps us migrate the data, 
"""

from dataclasses import dataclass
from storage import upload_json_to_gcs
from db import db
# from util import trim_object


@dataclass
class Config:
    # These two fields are used to route the data 
    source: str
    method: str
    
    upload_to_storage: str
    remove_from_rtdb: list[str]

# Which paths to migrate
CONFIG : dict[str, Config] = {
    "external/rejestr-io/krs": Config("rejestr-io", "api-v2-org-{krs}", "basic", []),
    "external/rejestr-io/krs": Config("rejestr-io", "api-v2-org-{krs}-synthetic", "", []),
    # "external/rejestr-io/person": Config(),
    # DONE "external/kpo": Config("kpo-horeca", "summary", "", []),
    # DONE "external/kpo_detailed": Config("kpo-horeca", "detailed", "", []),
}

if __name__ == "__main__":    
    for top_level_path, config in CONFIG.items():
        print(f"Reading {top_level_path}")
        entries = db.reference(top_level_path).get()
        assert isinstance(entries, dict)
        print(f"Found {len(entries)} entries")
    
        for key, value in entries.items():
            assert isinstance(value, dict)
            
            if config.upload_to_storage is not None:
                print(f"Uploading {key}/{config.upload_to_storage}")
                if config.upload_to_storage != "":
                    if config.upload_to_storage not in value:
                        print(f"Skipping {key}/{config.upload_to_storage} not present")
                        continue
                    value = value[config.upload_to_storage]
                
                upload_json_to_gcs(
                    source=config.source,
                    method=config.method,
                    object_id=key,
                    json_data=value,
                    verbose=True,
                )
                
            for field in config.remove_from_rtdb:
                db.reference(f"{top_level_path}/{key}/{field}").set(None)