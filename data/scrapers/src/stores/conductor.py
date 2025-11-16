import os

import duckdb
import pandas as pd

from stores.config import versioned
from stores.download import FileSource
from stores.firestore import FirestoreIO


from scrapers.stores import IO, File, DataRef
from scrapers.stores import FirestoreCollection
from scrapers.stores import DownloadableFile


# class Conductor(IO):
#     def read_data(self, fs: DataRef, process_if_missing=True) -> File:
#         if isinstance(fs, FirestoreCollection):
#             db = FirestoreIO


def get_path(output: str, jsonl: bool, parquet: bool):
    if jsonl:
        return versioned.get_path(f"{output}.jsonl")
    if parquet:
        return versioned.get_path(f"{output}.parquet")

    # TODO write the JSONL output
    # TODO write the parquet output
    raise NotImplementedError("conductor.get_path")


# TODO if one of the sources is missing, reprocess
# TODO if one of the sources is fresher, ask if should reprocess
def pipeline(
    output: str = "",
    sources: list[str] = [],
    force: bool = False,
    jsonl=True,
    parquet=False,
    init_duckdb=False,
):
    def decorator(func):
        nonlocal output
        if output == "":
            output = func.__name__

        def wrapper(*args, **kwargs):
            nonlocal force
            force = kwargs.pop("force", force)

            duckdb_initialized = False
            if init_duckdb and "con" not in kwargs:
                # Initialize duckdb to be passed to the pipeline
                kwargs["con"] = duckdb.connect(database=":memory:")
                duckdb_initialized = True

            matched_file = get_path(output, jsonl, parquet)

            if not os.path.exists(matched_file) or force:
                result = func(*args, **kwargs)
                print(f"Got results, saving to {matched_file}")
                result.to_parquet(matched_file)
            else:
                print(f"Reading memoized {matched_file}")
                result = pd.read_parquet(matched_file)

            if duckdb_initialized:
                kwargs["con"].close()
            return result

        return wrapper

    return decorator
