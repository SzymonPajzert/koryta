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
    sort_keys = dict()

    def insert_into(self, v, sort_by):
        mod = type(v).__module__.removeprefix("entities.")
        n = mod + "." + type(v).__name__
        n = n.replace(".", "_")
        if n not in self.inmemory:
            self.inmemory[n] = []
            self.sort_keys[n] = sort_by
        self.inmemory[n].append(v)

    def dump_pandas(self):
        for k, v in self.inmemory.items():
            name = k.lower()
            print(f"Writing {name}...")
            df = pd.DataFrame.from_records([asdict(i) for i in v])
            if len(self.sort_keys[k]) > 0:
                df.sort_values(
                    by=self.sort_keys[k],
                    inplace=True,
                    ignore_index=True,
                    ascending=False,
                )
            df.to_json(
                os.path.join(VERSIONED_DIR, f"{name}.jsonl"),
                index=False,
                lines=True,
                orient="records",
            )

        # Clean up the dict
        self.inmemory = dict()

    def get_last_written(self) -> tuple[str, list] | None:
        """Returns the name and data of the last written entity type."""
        if not self.inmemory:
            return None
        # Since dict preserves insertion order in Python 3.7+, the last item is the last written
        name, data = list(self.inmemory.items())[-1]
        return name, data
