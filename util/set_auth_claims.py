# This file sets custom claims in firebase of specified user IDs

from sys import argv
from enum import IntEnum
import firebase_admin
from firebase_admin import auth
from firebase_admin.auth import UserRecord

class Level(IntEnum):
    UNKNOWN = 0
    NORMAL = 1
    ADMIN = 2
    
def get_custom_claims_dict(l: Level):
    c = Level.UNKNOWN
    result = {}
    while int(c) <= int(l):
        if c == Level.ADMIN:
            result["admin"] = True
        c = c + 1
    return result
        
def dict_diff(d1, d2):
    if d1 is None:
        d1 = {}
    if d2 is None:
        d2 = {}
    d1_keys = set(d1.keys())
    d2_keys = set(d2.keys())
    shared_keys = d1_keys.intersection(d2_keys)
    added = d1_keys - d2_keys
    removed = d2_keys - d1_keys
    modified = {o: (d1[o], d2[o]) for o in shared_keys if d1[o] != d2[o]}
    
    return f"Added: {added}\nRemoved: {removed}\nModified: {modified}"
        

ROLE_LEVELS = {
    "dx5149dNlFTbKTovirqZ4a8K7ey2": Level.ADMIN,
    "of0BKlwqWLX21Cuml4NMHZ18xoC3": Level.ADMIN,
}

PROJECT_ID = "koryta-pl"

if __name__ == "__main__":
    options = {
        "projectId": PROJECT_ID,
    }
    default_app = firebase_admin.initialize_app(options=options)
    
    for uid, level in ROLE_LEVELS.items():
        user: UserRecord = auth.get_user(uid)
        print(f"{user.display_name} ({user.email}): current levels: {user.custom_claims}")
        change_to = get_custom_claims_dict(level)
        print(f"will set to {level}, dict_diff is:\n{dict_diff(change_to, user.custom_claims)}")
        # Print confirmation, wait for y, default N
        confirmation = input("Confirm? (y/N): ")
        if confirmation.lower() != "y":
            print("Skipping...")
            continue
        
        auth.set_custom_user_claims(uid, change_to)            
    
        