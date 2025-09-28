import os
import sys
from dotenv import load_dotenv
import requests

load_dotenv()
REJESTR_KEY = os.getenv("REJESTR_KEY")
print("Reading rejestr.io key: ", REJESTR_KEY)

if not REJESTR_KEY:
    print("Not found, go to https://rejestr.io/konto/api and set it in .env")
    sys.exit(1)

ALWAYS_ALLOW = False
print("Should I always ask before querying rejestr.io? [Yn]")
if input() == "n":
    print("I will always allow")
    ALWAYS_ALLOW = True
else:
    print("I will always ask for permission")


def get_rejestr_io(url: str):
    allowed = ALWAYS_ALLOW
    print(f"Querying {url}")
    if not ALWAYS_ALLOW:
        print(f"Should I query? [yN]")
        allowed = input() == "y"
    if not allowed:
        print("Not allowed")
        return {}

    response = requests.get(url, headers={"Authorization": REJESTR_KEY})
    if response.status_code != 200:
        print(response.status_code)
        return None
    return response.text
