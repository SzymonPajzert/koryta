"""
KRSUpdates lists data from https://api-krs.ms.gov.pl/api/Krs/Biuletyn/yyyy-mm-dd
and provides information if there were any updates to the KRS entries we're following
"""

import json
import typing
from dataclasses import dataclass

import pandas as pd

from entities.company import KRS
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile


@dataclass
class KRSUpdate:
    krs: int
    date: str


class KRSUpdates(Pipeline[KRSUpdate]):
    filename = "krs_updates"

    @property
    def output_class(self) -> typing.Type:
        return KRSUpdate

    def process(self, ctx: Context) -> pd.DataFrame:
        results = []
        for blob_ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=api-krs.ms.gov.pl/api/Krs/Biuletyn")
        ):
            assert isinstance(blob_ref, DownloadableFile)
            date_str = blob_ref.url.split("Biuletyn/")[1].split("/", 1)[0]
            try:
                content = ctx.io.read_data(blob_ref).read_string()
                krs_list = json.loads(content)
                for krs in krs_list:
                    if krs:
                        results.append({"krs": KRS(krs).id, "date": date_str})
            except Exception as e:
                print(f"Failed to process {blob_ref.url}: {e}")

        # Return empty dataframe with correct columns if no results
        if not results:
            return pd.DataFrame(columns=["krs", "date"])
        return pd.DataFrame(results)
