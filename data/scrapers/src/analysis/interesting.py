import typing
from dataclasses import dataclass

import numpy as np

from entities.company import Company, ManualKRS, Owner, Source, Wikipedia
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.map.teryt import Teryt
from scrapers.stores import Context, LocalFile, Pipeline
from scrapers.wiki.process_articles import ProcessWiki


class Companies(Pipeline[Company]):
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

    @property
    def output_class(self):
        return Company

    def process(self, ctx: Context):
        """
        Merges KRS and Wiki data to identify interesting entities.
        """
        self.teryt_pipeline.read_or_process(ctx)
        self.cities_to_teryt = getattr(self.teryt_pipeline, "cities_to_teryt", {})
        graph = self.graph(ctx)

        children_of_hardcoded = self.children_of_hardcoded(ctx, graph)
        wiki_companies = {c.krs: c for c in self.wiki_companies(ctx)}
        krs_companies = {
            c.krs: c for c in self.scraped_companies.read_or_process_list(ctx)
        }

        all_krs = (
            set(krs_companies.keys())
            | set(wiki_companies.keys())
            | set(children_of_hardcoded)
        )

        for krs_id in all_krs:
            if krs_id is None:
                continue
            assert isinstance(krs_id, str), " ".join(
                [
                    f"krs_id: {krs_id}",
                    f"type: {type(krs_id)}",
                    f"krs_companies:{krs_id in krs_companies}",
                    f"wiki_companies:{krs_id in wiki_companies}",
                    f"children_of_hardcoded:{krs_id in children_of_hardcoded}",
                ]
            )

            krs = krs_companies.get(krs_id)
            wiki = wiki_companies.get(krs_id)

            teryt_code = None
            if krs is not None:
                teryt_code = krs.teryt_code
            merge = CompanyMerger(krs, wiki)

            ctx.io.output_entity(
                Company(
                    name=merge.name,
                    city=merge.city,
                    krs=krs_id,
                    teryt_code=teryt_code,
                    sources=merge.sources,
                    # TODO add owners=[],
                )
            )

    def graph(self, ctx: Context):
        graph = self.company_graph(ctx)
        krs_to_owner_teryts: dict[str, set[str]] = {}
        for row in self.hardcoded_companies.read_or_process_list(ctx):
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

    def wiki_companies(self, ctx: Context) -> typing.Iterable[Wikipedia]:
        self.wiki_pipeline.read_or_process(ctx)
        # TODO this could be a method on a pipeline
        wiki_companies_file = LocalFile(
            "company_wikipedia/company_wikipedia.jsonl", "versioned"
        )
        df = ctx.io.read_data(wiki_companies_file).read_dataframe("jsonl")
        for row in df.itertuples(index=False):
            yield Wikipedia(*row)

    def children_of_hardcoded(self, ctx: Context, graph: CompanyGraph) -> list[str]:
        # This is actually a set[KRS] and if we don't cast it to str,
        # sets will contain wrong values
        children_of_hardcoded_set: set[ManualKRS] = graph.all_descendants(
            self.hardcoded_companies.read_or_process_list(ctx)
        )  # type: ignore
        return list((krs.id for krs in children_of_hardcoded_set))

    def company_graph(self, ctx: Context):
        graph = CompanyGraph()
        for company in self.scraped_companies.read_or_process_list(ctx):
            for child in company.children:
                graph.add_parent(company.krs, child)
            for parent in company.parents:
                if isinstance(parent, dict):
                    parent = Owner(**parent)
                if parent.krs is not None:
                    graph.add_parent(parent.krs, company.krs)
        return graph


@dataclass
class CompanyMerger:
    krs: typing.Optional[Company]
    wiki: typing.Optional[Wikipedia]

    @property
    def name(self) -> str | None:
        name = None
        if self.krs is not None and self.krs.name is not None:
            name = self.krs.name
        if name is None and self.wiki is not None and self.wiki.name is not None:
            name = self.wiki.name
        if name is None:
            return None
        return remove_company_suffix(name)

    @property
    def city(self) -> str | None:
        name = attr(self.wiki, "city") or attr(self.krs, "city")
        if name is not None and isinstance(name, str):
            return name.title()
        return None

    @property
    def sources(self) -> list[Source]:
        result = []
        if self.krs is not None:
            result += self.krs.sources
        if self.wiki is not None:
            result += [Source("wiki", self.wiki.name)]
        if len(result) == 0:
            result = [Source("hardcoded")]
        return result


REMOVABLE_SUFFIXES = [
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    "Sp. z o.o.",
    "SPÓŁKA AKCYJNA",
    "SA",
    "S.A.",
]


def remove_company_suffix(name: str) -> str:
    upper = name.upper()
    for suffix in REMOVABLE_SUFFIXES:
        if upper.endswith(suffix.upper()):
            name = name[: -len(suffix)]
            return name.rstrip()
    return name


# TODO is there a pythonic way
def attr(obj, f):
    if obj is not None and f in obj.__dict__:
        return obj.__dict__[f]
    return None
