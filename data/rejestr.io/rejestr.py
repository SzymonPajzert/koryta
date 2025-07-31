import os
import sys
from dotenv import load_dotenv

load_dotenv()
REJESTR_KEY = os.getenv("REJESTR_KEY")
print("Reading rejestr.io key: ", REJESTR_KEY)

if not REJESTR_KEY:
    print("Not found, go to https://rejestr.io/konto/api and set it in .env")
    sys.exit(1)

