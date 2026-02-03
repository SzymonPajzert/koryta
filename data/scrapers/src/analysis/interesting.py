import numpy as np
import pandas as pd

from entities.company import KRS as KrsCompany
from entities.company import InterestingEntity, InterestingReason, ManualKRS
from scrapers.krs.companies import company_names
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.stores import Context, LocalFile, Pipeline
from scrapers.wiki.process_articles import ProcessWiki
from util.lists import TEST_FILES, WIKI_POLITICAL_LINKS


def iterate(ctx, pipeline: Pipeline, constructor):
    try:
        df = pipeline.read_or_process(ctx)
        for row in df.itertuples(index=False):
            yield constructor(row)
    except:
        print("Failed to process pipeline", pipeline)
        raise


class CompaniesMerged(Pipeline):
    filename = "companies_merged"

    scraped_companies: CompaniesKRS
    hardcoded_companies: CompaniesHardcoded
    wiki_pipeline: ProcessWiki

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
        children_of_hardcoded = pd.DataFrame({"krs": list(children_of_hardcoded_set)})  # noqa: F841

        self.wiki_pipeline.read_or_process(ctx)
        wiki_companies = ctx.io.read_data(  # noqa: F841
            LocalFile(
                "company_wikipedia/company_wikipedia.jsonl", "versioned"
            )  # TODO fix
        ).read_dataframe("jsonl")

        # company_krs is already processed by scraped_companies
        krs_companies = ctx.io.read_data(  # noqa: F841
            LocalFile("company_krs/company_krs.jsonl", "versioned")
        ).read_dataframe("jsonl")

        hardcoded_names = pd.DataFrame(  # noqa: F841
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
            CAST(k.teryt_code AS VARCHAR) as teryt_code,
            w.city as wiki_city,
            CASE WHEN ik.krs IS NOT NULL THEN 1 ELSE 0 END as is_interesting_krs,
            CASE WHEN hn.name IS NOT NULL THEN 1 ELSE 0 END as is_hardcoded_name
        FROM wiki_companies w
        FULL OUTER JOIN krs_companies k
            ON CAST(w.krs AS VARCHAR) = CAST(k.krs AS VARCHAR)
        LEFT JOIN children_of_hardcoded ik
            ON CAST(k.krs AS VARCHAR) = CAST(ik.krs AS VARCHAR)
        LEFT JOIN hardcoded_names hn ON k.name = hn.name
        """

        df = con.execute(query).df()

        for _, row in df.iterrows():
            reasons = self.get_reasons(row)
            sources = []

            if pd.notna(row["krs"]):
                sources.append("krs")
            if pd.notna(row["content_score"]):  # content_score comes from wiki
                sources.append("wiki")
            if reasons:
                entity = InterestingEntity(
                    name=row["name"],
                    krs=row["krs"] if pd.notna(row["krs"]) else None,
                    teryt_code=row["teryt_code"] if pd.notna(row["teryt_code"]) else None,
                    reasons=reasons,
                    sources=sources,
                    children=set(graph.children.get(row["krs"], [])),
                )
                ctx.io.output_entity(entity)

    def get_reasons(self, row):
        reasons = []
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
                    InterestingReason(reason="owner_text", details=row["owner_text"])
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
                        InterestingReason(reason="owner_article", details=article_str)
                    )
                if article_str in WIKI_POLITICAL_LINKS:
                    reasons.append(
                        InterestingReason(reason="political_link", details=article_str)
                    )

        return reasons
