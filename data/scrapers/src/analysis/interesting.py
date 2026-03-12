import numpy as np
import pandas as pd

from entities.company import KRS as KrsCompany
from entities.company import Company, InterestingReason, ManualKRS, Owner
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.map.teryt import Teryt
from scrapers.stores import Context, LocalFile, Pipeline
from scrapers.wiki.process_articles import ProcessWiki


class Companies(Pipeline):
    """
    This pipeline lists all companies we're aware of and either provides
    a full information on the given company or lists what information
    we're missing on it.
    """

    filename = "companies_merged"

    scraped_companies: CompaniesKRS
    hardcoded_companies: CompaniesHardcoded
    wiki_pipeline: ProcessWiki
    teryt_pipeline: Teryt

    def process(self, ctx: Context):
        """
        Merges KRS and Wiki data to identify interesting entities.
        """
        self.teryt_pipeline.read_or_process(ctx)
        self.cities_to_teryt = getattr(self.teryt_pipeline, "cities_to_teryt", {})
        graph = self.graph(ctx)
        # TODO join them when there's no more query
        wiki_companies = self.wiki_companies(ctx)  # noqa: F841
        children_of_hardcoded = self.children_of_hardcoded(ctx, graph)  # noqa: F841

        # company_krs is already processed by scraped_companies
        krs_companies = ctx.io.read_data(  # noqa: F841
            LocalFile("company_krs/company_krs.jsonl", "versioned")
        ).read_dataframe("jsonl")
        if "owners" not in krs_companies.columns:
            krs_companies = krs_companies.assign(owners=None)

        query = """
        SELECT 
            COALESCE(w.name, k.name) as name,
            COALESCE(CAST(w.krs AS VARCHAR), CAST(k.krs AS VARCHAR)) as krs,
            w.content_score,
            k.city as krs_city,
            CAST(k.teryt_code AS VARCHAR) as teryt_code,
            w.city as wiki_city,
            CASE WHEN ik.krs IS NOT NULL THEN 1 ELSE 0 END as is_interesting_krs,
            ik.owner_teryts,
            k.owners
        FROM wiki_companies w
        FULL OUTER JOIN krs_companies k
            ON CAST(w.krs AS VARCHAR) = CAST(k.krs AS VARCHAR)
        """

        df = ctx.con.execute(query).df()

        for _, row in df.iterrows():
            reasons = self.get_reasons(row)
            sources = []

            if pd.notna(row["krs"]):
                sources.append("krs")
            if pd.notna(row["content_score"]):  # content_score comes from wiki
                sources.append("wiki")
            if reasons:
                entity = Company(
                    name=row["name"],
                    krs=row["krs"] if pd.notna(row["krs"]) else None,
                    teryt_code=row["teryt_code"]
                    if pd.notna(row["teryt_code"])
                    else None,
                    reasons=reasons,
                    sources=sources,
                    children=set(graph.children.get(row["krs"], [])),
                )
                ctx.io.output_entity(entity)

    def graph(self, ctx: Context):
        graph = self.company_graph(ctx)
        krs_to_owner_teryts: dict[str, set[str]] = {}
        for row in iterate_pipeline(
            ctx, self.hardcoded_companies, lambda d: ManualKRS(*d)
        ):
            teryts = getattr(row, "teryts", None)
            if teryts is None:
                continue
            if isinstance(teryts, (list, set, tuple, np.ndarray)) and len(teryts) == 0:
                continue
            descendants = graph.all_descendants([row.id])
            for desc in descendants:
                if desc not in krs_to_owner_teryts:
                    krs_to_owner_teryts[desc] = set()
                krs_to_owner_teryts[desc].update(row.teryts)
        return graph

    def wiki_companies(self, ctx: Context):
        self.wiki_pipeline.read_or_process(ctx)
        return ctx.io.read_data(  # noqa: F841
            LocalFile(
                "company_wikipedia/company_wikipedia.jsonl", "versioned"
            )  # TODO fix
        ).read_dataframe("jsonl")

    def children_of_hardcoded(self, ctx: Context, graph: CompanyGraph) -> list[str]:
        children_of_hardcoded_set = graph.all_descendants(
            iterate_pipeline(ctx, self.hardcoded_companies, lambda d: ManualKRS(*d).id)
        )
        return list(children_of_hardcoded_set)

    def company_graph(self, ctx: Context):
        graph = CompanyGraph()
        for company in iterate_pipeline(
            ctx, self.scraped_companies, lambda d: KrsCompany(*d)
        ):
            for child in company.children:
                graph.add_parent(company.krs, child)
            for parent in company.parents:
                if isinstance(parent, dict):
                    parent = Owner(**parent)
                if parent.krs is not None:
                    graph.add_parent(parent.krs, company.krs)
        return graph

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

        owner_teryts = row.get("owner_teryts")
        if (
            owner_teryts is not None
            and isinstance(owner_teryts, (list, np.ndarray))
            and len(owner_teryts) > 0
        ):
            for t in owner_teryts:
                if t:
                    reasons.append(
                        InterestingReason(
                            reason="owner_teryt",
                            details=str(t),
                        )
                    )

        if pd.notna(row["content_score"]) and row["content_score"] > 0:
            reasons.append(
                InterestingReason(
                    reason="wiki_content_score",
                    details=f"Score: {row['content_score']}",
                )
            )

        owners = row.get("owners")
        if (
            owners is not None
            and isinstance(owners, (list, np.ndarray))
            and len(owners) > 0
        ):
            for owner in owners:
                if isinstance(owner, dict):
                    owner_str = str(owner.get("nazwa", owner))
                else:
                    owner_str = str(owner)
                lower_owner = owner_str.lower()

                if (
                    "skarb państwa" in lower_owner
                    or "miasto" in lower_owner
                    or "województwo" in lower_owner
                    or "gmina" in lower_owner
                    or "powiat" in lower_owner
                ):
                    reasons.append(
                        InterestingReason(reason="krs_owner", details=owner_str)
                    )
                    krs_city = row.get("krs_city")
                    if krs_city and isinstance(krs_city, str):
                        lower_city = krs_city.lower()
                        if lower_city in lower_owner:
                            for city_name, teryt in self.cities_to_teryt.items():
                                if city_name.lower() == lower_city:
                                    reasons.append(
                                        InterestingReason(
                                            reason="owner_teryt", details=teryt
                                        )
                                    )
                                    break

        return reasons


def iterate_pipeline(ctx, pipeline: Pipeline, constructor):
    try:
        df = pipeline.read_or_process(ctx)
        for row in df.itertuples(index=False):
            yield constructor(row)
    except:
        print("Failed to process pipeline", pipeline)
        raise
