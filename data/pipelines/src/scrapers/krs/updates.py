"""
KRSUpdates lists data from https://api-krs.ms.gov.pl/api/Krs/Biuletyn/yyyy-mm-dd
and provides information if there were any updates to the KRS entries we're following
"""

import json
import typing
from dataclasses import dataclass

import pandas as pd

from entities.company import KRS
from scrapers.krs.columns import normalise
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile


@dataclass
class KRSUpdate:
    krs: int
    date: str


def latest_changes(updates: pd.DataFrame) -> dict[str, str]:
    """KRS number to the last day the bulletin names its entry, from `KRSUpdates`.

    Normalised first: a cached output reads `date` back as a Timestamp and the
    KRS as a number.
    """
    if updates.empty:
        return {}
    days = normalise(updates, "date")
    latest = days.groupby("krs")["date"].max()
    return {str(krs): str(day) for krs, day in latest.items()}


class KRSUpdates(Pipeline[KRSUpdate]):
    filename = "krs_updates"
    dtype = {"krs": str}

    @property
    def output_class(self) -> typing.Type:
        return KRSUpdate

    def days_crawled(self, ctx: Context) -> set[str]:
        """Every bulletin day with a response on file, empty ones included.

        Not derivable from this pipeline's own rows: a day on which no company
        changed produces no rows and is indistinguishable there from a day we
        never fetched. The difference matters to anything that reads "this
        company is not in the bulletin" as "this company did not change" - two
        of the days on file are genuinely empty, and six calendar days in the
        middle of the range were never fetched at all.
        """
        days = set()
        for blob_ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=api-krs.ms.gov.pl/api/Krs/Biuletyn")
        ):
            url = getattr(blob_ref, "url", "")
            if "Biuletyn/" not in url:
                continue
            days.add(url.split("Biuletyn/", 1)[1].split("/", 1)[0])
        return days

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
