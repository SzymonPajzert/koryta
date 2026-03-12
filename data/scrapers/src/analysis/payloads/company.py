from typing import Any, cast

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from analysis.payloads.util import strip_none
from scrapers.stores import Context, Pipeline


class CompanyPayloads(Pipeline):
    filename = None

    companies: Companies

    def process(self, ctx: Context) -> pd.DataFrame:
        # TODO type this correctly
        payloads: list[dict[str, Any]] = []
        companies_df = self.companies.read_or_process(ctx)
        for _, row in companies_df.iterrows():
            c_payload = map_company_payload(row)
            if c_payload:
                payloads.append(
                    {
                        "entity_type": "company",
                        "entity_id": row.get("krs"),
                        "krs": row.get("krs"),
                        "teryt_powiat": [],
                        "payload": c_payload,
                    }
                )

        return pd.DataFrame(payloads)


def map_company_payload(row: pd.Series) -> dict[str, Any] | None:
    if not row.get("krs") or not row.get("name"):
        return None

    payload = {
        "krs": row.get("krs"),
        "name": row.get("name"),
        "city": row.get("city") or row.get("krs_city") or row.get("wiki_city"),
        "owns": row.get("children") or [],
    }

    owner_teryts = get_owner_teryts(row)
    if len(owner_teryts) > 0:
        # Prefer the most specific (longest) teryt code if multiple exist
        owner_teryts.sort(key=len, reverse=True)
        payload["teryt"] = owner_teryts[0].removesuffix(".0")
    elif is_communal(row) and pd.notna(row.get("teryt_code")):
        payload["teryt"] = str(row.get("teryt_code")).removesuffix(".0")

    return cast(dict[str, Any], strip_none(payload))


def get_owner_teryts(row: pd.Series) -> list[str]:
    owner_teryts = []
    reasons = row.get("reasons")
    if isinstance(reasons, (list, np.ndarray)):
        for r in reasons:
            r_type = (
                r.get("reason") if isinstance(r, dict) else getattr(r, "reason", None)
            )
            r_details = (
                r.get("details") if isinstance(r, dict) else getattr(r, "details", None)
            )
            if r_type == "owner_teryt" and r_details:
                owner_teryts.append(str(r_details))
    return owner_teryts


def is_communal(row: pd.Series) -> bool:
    if len(get_owner_teryts(row)) > 0:
        return True

    if pd.notna(row.get("owner_text")) and row.get("owner_text"):
        lower_owner = str(row.get("owner_text")).lower()
        if (
            "miasto" in lower_owner
            or "województwo" in lower_owner
            or "gmina" in lower_owner
        ):
            return True

    owner_articles = row.get("owner_articles")
    if isinstance(owner_articles, (list, np.ndarray)) and len(owner_articles) > 0:
        for article in owner_articles:
            if isinstance(article, dict):
                article_str = str(article.get("title", article))
            else:
                article_str = str(article)

            lower_article = article_str.lower()
            if (
                "miasto" in lower_article
                or "województwo" in lower_article
                or "gmina" in lower_article
            ):
                return True
    return False
