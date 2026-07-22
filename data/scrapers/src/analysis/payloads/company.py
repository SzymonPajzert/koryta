import argparse
from functools import cached_property

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from scrapers.koryta.download import KorytaCompanies
from scrapers.stores import Context, Pipeline


class CompaniesPayloads(Pipeline):
    """Emits ingest payloads for companies already submitted to koryta.pl.

    Joins the enriched `Companies` data (PKD `activity` + the `is_public`
    spółka-publiczna flag) with the set of companies already on the site
    (`KorytaCompanies`), so a migration re-submits only companies that already
    exist. The payloads intentionally carry no owners/teryt, so the ingest
    endpoint only updates node-level `activity`/`categories`/`isPublic` and does
    not create or duplicate edges.
    """

    volatile = True
    filename = None

    companies: Companies

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export listing already "
            "submitted companies. Defaults to the latest available export.",
            default=None,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        # TODO this should be a field and dependency
        submitted_df = KorytaCompanies(self.args.koryta_date).read_or_process(ctx)
        submitted_krs = {
            str(krs).zfill(10) for krs in submitted_df["krs"].dropna().tolist()
        }
        print(f"{len(submitted_krs)} companies already submitted to koryta.pl")

        companies_df = self.companies.read_or_process(ctx)

        payloads = []
        for row in companies_df.to_dict(orient="records"):
            krs = row.get("krs")
            if krs is None or (isinstance(krs, float) and np.isnan(krs)):
                continue
            krs = str(krs).zfill(10)
            if krs not in submitted_krs:
                continue

            name = row.get("name")
            if not isinstance(name, str) or not name:
                name = krs

            activity = row.get("activity")
            if not isinstance(activity, (list, np.ndarray)):
                activity = []

            is_public = row.get("is_public")
            is_public = (
                bool(is_public) if isinstance(is_public, (bool, np.bool_)) else False
            )

            payloads.append(
                {
                    "krs": krs,
                    "name": name,
                    "activity": list(activity),
                    "is_public": is_public,
                }
            )

        print(f"Emitting {len(payloads)} company payloads")
        if not payloads:
            return pd.DataFrame(columns=["krs", "name", "activity", "is_public"])
        return pd.DataFrame.from_records(payloads)
