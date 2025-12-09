import os
from dataclasses import asdict
from typing import Any

import pandas as pd

from stores.config import VERSIONED_DIR


class EntityDumper:
    dbs: list[Any] = []
    used: dict[str, Any] = dict()
    inmemory: dict[str, list[Any]] = dict()
    sort_keys: dict[str, list[str]] = dict()

    _last_written_cache: tuple[str, list] | None = None

    def insert_into(self, v, sort_by):
        mod = type(v).__module__.removeprefix("entities.")
        n = mod + "." + type(v).__name__
        n = n.replace(".", "_")
        if n not in self.inmemory:
            self.inmemory[n] = []
            self.sort_keys[n] = sort_by
        self.inmemory[n].append(v)
        # Update cache on write
        self._last_written_cache = (n, self.inmemory[n])

    def dump_pandas(self):
        # Update cache before dumping
        if self.inmemory:
            name, data = list(self.inmemory.items())[-1]
            self._last_written_cache = (name, data)

        for k, v in self.inmemory.items():
            name = k.lower()
            print(f"Writing {name}...")
            # Ensure the directory exists
            path = os.path.join(VERSIONED_DIR, f"{name}/{name}.jsonl")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            
            df = pd.DataFrame.from_records([asdict(i) for i in v])
            if len(self.sort_keys[k]) > 0:
                df.sort_values(
                    by=self.sort_keys[k],
                    inplace=True,
                    ignore_index=True,
                    ascending=False,
                )
            df.to_json(
                path,
                index=False,
                lines=True,
                orient="records",
            )

        # Clean up the dict
        self.inmemory = dict()

    def get_last_written(self) -> tuple[str, list] | None:
        """Returns the name and data of the last written entity type."""
        return self._last_written_cache
