from pprint import pprint
from collections import Counter

import numpy as np
import pandas as pd

from util.lists import WIKI_POLITICAL_LINKS, TEST_FILES
from scrapers.stores import PipelineModel, Context, LocalFile
from entities.company import InterestingEntity, InterestingReason
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.list import CompaniesKRS
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.companies import company_names
from entities.company import KRS as KrsCompany, ManualKRS
from scrapers.stores import Pipeline


def iterate(ctx, pipeline, constructor):
    try:
        assert pipeline.filename is not None
        df = Pipeline.read_or_process(ctx, pipeline.filename, pipeline.process)
        for row in df.itertuples(index=False):
            yield constructor(row)
    except:
        print("Failed to process pipeline", pipeline)
        raise


class CompaniesMerged(PipelineModel[InterestingEntity]):
    filename = "companies_merged"

    scraped_companies: CompaniesKRS
    hardcoded_companies: CompaniesHardcoded

    def process(self, ctx: Context):
        """
        Merges KRS and Wiki data to identify interesting entities.
        """
        con = ctx.con

        graph = CompanyGraph()
        for company in iterate(ctx, self.scraped_companies, lambda d: KrsCompany(*d)):
            for child in company.children:
                graph.add_parent(company.krs, child)
            for parent in company.parents:
                graph.add_parent(parent, company.krs)

        children_of_hardcoded_set = graph.all_descendants(
            iterate(ctx, self.hardcoded_companies, lambda d: ManualKRS(*d).id)
        )
        children_of_hardcoded = pd.DataFrame({"krs": list(children_of_hardcoded_set)})

        wiki_companies = ctx.io.read_data(
            LocalFile("company_wikipedia.jsonl", "versioned")
        ).read_dataframe("jsonl")
        krs_companies = ctx.io.read_data(
            LocalFile("company_krs.jsonl", "versioned")
        ).read_dataframe("jsonl")

        hardcoded_names = pd.DataFrame(
            {"name": list(company_names.values()) + list(TEST_FILES)}
        )

        query = """
        SELECT 
            COALESCE(w.name, k.name) as name,
            COALESCE(CAST(w.krs AS VARCHAR), CAST(k.krs AS VARCHAR)) as krs,
            w.owner_text,
            w.owner_articles,
            w.content_score,
            k.city as krs_city,
            w.city as wiki_city,
            CASE WHEN ik.krs IS NOT NULL THEN 1 ELSE 0 END as is_interesting_krs,
            CASE WHEN hn.name IS NOT NULL THEN 1 ELSE 0 END as is_hardcoded_name
        FROM wiki_companies w
        FULL OUTER JOIN krs_companies k ON CAST(w.krs AS VARCHAR) = CAST(k.krs AS VARCHAR)
        LEFT JOIN children_of_hardcoded ik ON CAST(k.krs AS VARCHAR) = CAST(ik.krs AS VARCHAR)
        LEFT JOIN hardcoded_names hn ON k.name = hn.name
        """

        df = con.execute(query).df()

        for _, row in df.iterrows():
            reasons = []
            sources = []

            if pd.notna(row["krs"]):
                sources.append("krs")
            if pd.notna(row["content_score"]):  # content_score comes from wiki
                sources.append("wiki")

            # Check reasons
            if row["is_interesting_krs"]:
                reasons.append(
                    InterestingReason(
                        reason="hardcoded_krs",
                        details="In interesting list or owned by one",
                    )
                )
            if row["is_hardcoded_name"]:
                reasons.append(
                    InterestingReason(
                        reason="hardcoded_name", details="In company_names list"
                    )
                )

            # Wiki based reasons
            if pd.notna(row["content_score"]) and row["content_score"] > 0:
                reasons.append(
                    InterestingReason(
                        reason="wiki_content_score",
                        details=f"Score: {row['content_score']}",
                    )
                )

            # Check owners (simple string check for now, can be improved)
            if pd.notna(row["owner_text"]) and row["owner_text"]:
                lower_owner = row["owner_text"].lower()
                if (
                    "skarb państwa" in lower_owner
                    or "miasto" in lower_owner
                    or "województwo" in lower_owner
                    or "gmina" in lower_owner
                ):
                    reasons.append(
                        InterestingReason(
                            reason="owner_text", details=row["owner_text"]
                        )
                    )

            if (
                isinstance(row["owner_articles"], (list, np.ndarray))
                and len(row["owner_articles"]) > 0
            ):
                # owner_articles is a list (numpy array or list in pandas)
                for article in row["owner_articles"]:
                    if isinstance(article, dict):
                        # Handle case where article is a dict (unexpected but possible)
                        article_str = str(article.get("title", article))
                    else:
                        article_str = str(article)

                    lower_article = article_str.lower()

                    if (
                        "skarb państwa" in lower_article
                        or "miasto" in lower_article
                        or "województwo" in lower_article
                        or "gmina" in lower_article
                    ):
                        reasons.append(
                            InterestingReason(
                                reason="owner_article", details=article_str
                            )
                        )
                    if article_str in WIKI_POLITICAL_LINKS:
                        reasons.append(
                            InterestingReason(
                                reason="political_link", details=article_str
                            )
                        )

            if reasons:
                entity = InterestingEntity(
                    name=row["name"],
                    krs=row["krs"] if pd.notna(row["krs"]) else None,
                    reasons=reasons,
                    sources=sources,
                )
                ctx.io.output_entity(entity)
