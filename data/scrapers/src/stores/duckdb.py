from dataclasses import fields, asdict
import os

import pandas as pd

from util.polish import PkwFormat
from stores.config import VERSIONED_DIR
from datetime import datetime


class EntityDumper:
    dbs = []
    used = dict()
    inmemory = dict()

    def insert_into(self, v):
        mod = type(v).__module__.removeprefix("entities.")
        n = mod + "." + type(v).__name__
        n = n.replace(".", "_")
        if n not in self.inmemory:
            self.inmemory[n] = []
        self.inmemory[n].append(v)

    def dump_pandas(self):
        for k, v in self.inmemory.items():
            name = k.lower()
            print(f"Writing {name}...")
            df = pd.DataFrame.from_records([asdict(i) for i in v])
            df.to_json(
                os.path.join(VERSIONED_DIR, f"{name}.jsonl"),
                index=False,
                lines=True,
                orient="records",
            )
