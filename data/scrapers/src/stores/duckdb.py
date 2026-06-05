import argparse
import json
import os
from dataclasses import asdict
from functools import cached_property
from typing import Any

import pandas as pd

from stores.config import VERSIONED_DIR


class EntityDumper:
    def __init__(self) -> None:
        self.inmemory: dict[str, list[Any]] = {}
        self.sort_keys: dict[str, list[str]] = {}
        self._last_written_cache: tuple[str, list] | None = None
        self._has_flushed: bool = False
        self._insert_count: int = 0

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--dump-every",
            type=int,
            default=10000,
            metavar="N",
            help="Flush parsed entities to disk every N records to bound memory usage.",
        )
        return parser.parse_known_args()[0]

    def get_output(self, name: str) -> list[Any] | None:
        """Returns the in-memory output for a given entity name."""
        # Normalizing name as done in insert_into
        if name in self.inmemory:
            return self.inmemory[name]

        # Try normalizing the name
        normalized = name.replace(".", "_")
        if normalized in self.inmemory:
            return self.inmemory[normalized]

        raise ValueError(f"No output for {name} in EntityDumper")

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
        if self.args.dump_every is not None:
            self._insert_count += 1
            if self._insert_count % self.args.dump_every == 0:
                self.flush()

    def flush(self) -> None:
        """Append current in-memory entities to JSONL files and clear memory."""
        for k, v in self.inmemory.items():
            if not v:
                continue
            assert not self.sort_keys[k], "flush() cannot be used with sort_by"
            name = k.lower()
            path = os.path.join(VERSIONED_DIR, f"{name}/{name}.jsonl")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a") as f:
                for item in v:
                    f.write(json.dumps(asdict(item)) + "\n")
        self.inmemory = {}
        self._has_flushed = True

    def dump_pandas(self):
        if self._has_flushed:
            self.flush()
            return

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
        self.inmemory = {}

    def get_last_written(self) -> tuple[str, list] | None:
        """Returns the name and data of the last written entity type."""
        return self._last_written_cache
