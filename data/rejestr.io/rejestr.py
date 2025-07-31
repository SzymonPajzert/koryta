import os
from dotenv import load_dotenv

load_dotenv()
REJESTR_KEY = os.getenv("REJESTR_KEY")
print(REJESTR_KEY)

