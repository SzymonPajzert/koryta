from typing import Any

import pandas as pd

from analysis.interesting import Companies
from scrapers.stores import Context, Pipeline


class CompanyPayloads(Pipeline):
    filename = None

    companies: Companies

    def process(self, ctx: Context) -> pd.DataFrame:
        # TODO type this correctly
        payloads: list[dict[str, Any]] = []
        companies_df = self.companies.read_or_process(ctx)
        for _, row in companies_df.iterrows():
            city = row.get("city") or row.get("krs_city") or row.get("wiki_city")
            payloads.append(
                {
                    "krs": row.get("krs"),
                    "name": row.get("name"),
                    "city": city,
                    "owns": row.get("children") or [],
                    "teryt_powiat": [],
                }
            )

        return pd.DataFrame(payloads)
