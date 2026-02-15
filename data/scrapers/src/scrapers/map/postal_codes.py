import os

import pandas as pd

from scrapers.stores import Context, DownloadableFile, Pipeline

postal_codes_file = DownloadableFile(
    url="https://raw.githubusercontent.com/symerio/postal-codes-data/refs/heads/master/data/geonames/PL.txt",
    filename_fallback="postal_codes_pl.txt",
)


class PostalCodes(Pipeline):
    filename = "postal_codes"

    def process(self, ctx: Context):
        file = ctx.io.read_data(postal_codes_file)
        # Reading tab-separated file without header
        # Col 1: Postal Code
        # Col 8: TERYT Code (Gmina level usually)
        df = file.read_dataframe(
            "csv",
            csv_sep="\t",
        )

        with file.read_file() as f:
            df = pd.read_csv(
                f,
                sep="\t",
                header=None,
                dtype=str,
                usecols=[1, 2, 8],
                names=["postal_code", "city", "teryt"],
            )

        # Filter out rows where TERYT is NaN
        df = df.dropna(subset=["teryt"])
        df["city"] = df["city"].str.lower()
        return df
