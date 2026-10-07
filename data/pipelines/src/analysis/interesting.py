import dataclasses
import difflib
import re
import typing
from collections import Counter
from dataclasses import dataclass

import numpy as np
import pandas as pd

from entities.company import Company, Owner, Source, Wikipedia, WikiShareholder
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.map.jst import AMBIGUOUS, SKARB_PANSTWA, JstIndex, normalise
from scrapers.map.teryt import Jst, Teryt
from scrapers.stores import Context, Pipeline, iterate_pipeline
from scrapers.wiki.process_articles import read_company_articles
from scrapers.wiki.shareholders import clean_krs


class Companies(Pipeline[Company]):
    """
    This pipeline lists all companies we're aware of and either provides
    a full information on the given company or lists what information
    we're missing on it.

    Beside the register it reads the company articles of the Polish Wikipedia,
    which `ProcessWiki` takes out of the dump. An article that gives a
    company's KRS number and agrees about its name lends it three things: its
    address (`wikipedia`), its categories (`wiki_categories`, the sector a
    reader filed it under) and, where the register names no owner at all, the
    owners its infobox lists. See `wiki_article_for` and `wiki_owners`.
    """

    filename = "companies_merged"
    # All identifiers, never numbers. A REGON may start with a zero and a NIP
    # is a 10-digit string; pandas reads either as an integer without this and
    # the leading zeros are gone for good.
    dtype = {"krs": str, "teryt_code": str, "nip": str, "regon": str}

    scraped_companies: CompaniesKRS
    hardcoded_companies: CompaniesHardcoded
    teryt_pipeline: Teryt
    jst: Jst

    @property
    def output_class(self):
        return Company

    def process(self, ctx: Context):
        """
        Merges KRS and Wiki data to identify interesting entities.
        """
        self.teryt_pipeline.read_or_process(ctx)
        self.cities_to_teryt = getattr(self.teryt_pipeline, "cities_to_teryt", {})
        self.jst.read_or_process(ctx)
        jst_index: JstIndex | None = getattr(self.jst, "index", None)
        graph = self.graph(ctx)

        children_of_hardcoded = self.children_of_hardcoded(ctx, graph)
        wiki_companies: dict[str, list[Wikipedia]] = {}
        for article in self.wiki_companies(ctx):
            article_krs = clean_krs(article.krs)
            if article_krs is not None:
                wiki_companies.setdefault(article_krs, []).append(article)
        krs_companies = {
            c.krs: c for c in self.scraped_companies.read_or_process_list(ctx)
        }

        # Not the Wikipedia companies: an article lends what it knows to a
        # company the register has, and never adds one. A company known only
        # from an article has no PKD codes and no legal form, and its payload
        # would write an empty category list over whatever the site holds.
        all_krs = set(krs_companies.keys()) | set(children_of_hardcoded)

        wiki_report: Counter[str] = Counter()
        disagreeing: list[str] = []
        outputs = []
        # Sorted, so the same companies are written in the same order every
        # run. key=str: a NaN, skipped just below, does not compare with a str.
        for krs_id in sorted(all_krs, key=str):
            if pd.isna(krs_id):
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
            articles = wiki_companies.get(krs_id, [])
            wiki = wiki_article_for(krs.name if krs is not None else None, articles)
            if articles and wiki is None:
                disagreeing.append(
                    f"{krs_id} {krs.name if krs is not None else ''!s} - "
                    + ", ".join(str(a.title) for a in articles)
                )

            teryt_code = None
            if krs is not None:
                teryt_code = krs.teryt_code
            merge = CompanyMerger(krs, wiki)

            parents = list(krs.parents) if krs is not None else []
            if wiki is not None:
                wiki_report["with an article"] += 1
                if not parents:
                    parents = wiki_owners(
                        wiki.shareholders,
                        krs_id,
                        jst_index,
                        teryt_code[:2] if isinstance(teryt_code, str) else None,
                    )
                    if parents:
                        wiki_report["owners from the article"] += 1

            outputs.append(
                Company(
                    name=merge.name,
                    city=merge.city,
                    krs=krs_id,
                    teryt_code=teryt_code,
                    sources=merge.sources,
                    activity=krs.activity if krs is not None else [],
                    # Only KRS has it, and it is what places the SPZOZ hospitals
                    # -- see `entities.company_categories`.
                    form=krs.form if krs is not None else None,
                    is_public=krs.is_public if krs is not None else False,
                    # Only KRS knows it too, and the payloads read this output
                    # rather than company_krs: a field not named here is
                    # dropped on the way to the site without a word.
                    supervisory_organ=(
                        krs.supervisory_organ if krs is not None else None
                    ),
                    # Only KRS carries these, so there is nothing to reconcile
                    # -- but without them this output cannot be joined to any
                    # register that identifies a company by its tax id, which
                    # is what public-procurement sources do.
                    nip=krs.nip if krs is not None else None,
                    regon=krs.regon if krs is not None else None,
                    # Who owns it, as `company_from_api_krs` read it out of
                    # dzial1: a company by KRS number, a gmina/powiat/
                    # wojewodztwo by the TERYT code its register name resolved
                    # to. Dropped here until now - the TODO that stood in this
                    # spot - which is why `CompaniesPayloads` emitted no owners
                    # however hard it looked for them, and why `RegionPayloads`
                    # found no gmina worth a node. The article's owners only
                    # where the register names none - see `wiki_owners`.
                    parents=parents,
                    wikipedia=wiki.source if wiki is not None else None,
                    wiki_categories=list(wiki.categories) if wiki is not None else [],
                )
            )

        print(
            f"Wikipedia: {wiki_report['with an article']} companies have an "
            f"article of their own, and {wiki_report['owners from the article']} "
            f"of them take their owners from it; {len(disagreeing)} articles give "
            "a company's KRS number under another name and are left out:"
        )
        for line in disagreeing:
            print(f"  {line}")

        marked = public_through_wiki_owners(outputs, krs_companies)
        print(
            f"Wikipedia: {len(marked)} companies are public through an owner "
            "only an article names, or through a company that is: "
            + ", ".join(marked[:20])
            + (", ..." if len(marked) > 20 else "")
        )
        return pd.DataFrame.from_records([dataclasses.asdict(o) for o in outputs])

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

    def wiki_companies(self, ctx: Context) -> list[Wikipedia]:
        """`ProcessWiki`'s company articles, or none when there is nothing to read.

        None is a run without Wikipedia rather than a failed one: the register
        is the source of record and everything an article adds is optional.
        So a machine with no copy of the articles, and a copy written before
        they carried an address and owners, both merge without them - and say
        so, with the command that fixes it.

        Read rather than declared as a dependency, on purpose. A declared
        `ProcessWiki` is read or run before `process` whether or not anything
        uses it, so this pipeline used to start a twelve-minute parse of the
        dump wherever `person_wikipedia` was missing - which it never reads -
        and rewrite the tracked fixtures in tests/wiki on the way. The articles
        change with a dump twice a month; the night rebuilds this every day.
        """
        try:
            df = read_company_articles(ctx)
        except FileNotFoundError as e:
            print(f"No Wikipedia company articles to merge, so none are: {e}")
            return []
        missing = {"title", "source", "shareholders", "categories"} - set(df.columns)
        if missing:
            print(
                f"The Wikipedia company articles predate {sorted(missing)}, so "
                "none are merged; `koryta ProcessWiki --refresh ProcessWiki` "
                "writes them anew"
            )
            return []
        return list(iterate_pipeline(df, Wikipedia))

    def children_of_hardcoded(self, ctx: Context, graph: CompanyGraph) -> list[str]:
        children_of_hardcoded_set = graph.all_descendants(
            company.id for company in self.hardcoded_companies.read_or_process_list(ctx)
        )
        return list((krs for krs in children_of_hardcoded_set))

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


#: How alike an article's name and the register's have to be for the article
#: to be the company's own - see `wiki_article_for`.
NAME_AGREEMENT = 0.6

#: Legal forms, which one name spells out and the other abbreviates or drops.
#: Normalised, as `scrapers.map.jst.normalise` writes them.
_LEGAL_FORMS = (
    "SPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA",
    "SPOLKA AKCYJNA",
    "SPOLKA KOMANDYTOWA",
    "SPOLKA JAWNA",
    "SP Z O O",
    "S A",
    "SA",
    "SP K",
    "W LIKWIDACJI",
    "W UPADLOSCI",
)


def _comparable(name: str | None) -> list[str]:
    """A name's words, the way two spellings of one company's name share them."""
    text = normalise(re.sub(r"\(.*?\)", " ", name or ""))
    text = re.sub(r"\s+", " ", " " + re.sub(r"[^A-Z0-9 ]", " ", text) + " ")
    for form in _LEGAL_FORMS:
        text = text.replace(f" {form} ", " ")
    return text.split()


def name_agreement(register_name: str, article: Wikipedia) -> float:
    """How well an article's title or infobox name agrees with the register's.

    1 when every word of the shorter name is among the longer's - "Naftoport"
    and PRZEDSIEBIORSTWO PRZELADUNKU PALIW PLYNNYCH "NAFTOPORT" - and otherwise
    how alike the two are as strings.
    """
    register = _comparable(register_name)
    best = 0.0
    for candidate in (article.title, article.name):
        words = _comparable(candidate)
        if not words or not register:
            continue
        shorter, longer = sorted((words, register), key=len)
        if set(shorter) <= set(longer):
            return 1.0
        ratio = difflib.SequenceMatcher(None, " ".join(words), " ".join(register))
        best = max(best, ratio.ratio())
    return best


def wiki_article_for(
    register_name: str | None, articles: list[Wikipedia]
) -> Wikipedia | None:
    """The company's own article, among the ones that give its KRS number.

    An infobox's KRS number is an editor's claim and almost always a true one,
    but it is not always on the company's own article. A power station gives
    its operator's number - Elektrownia Rybnik is filed under PGE Energia
    Ciepla's - and a company's predecessors keep theirs - Soda-Matwy and
    Janikosoda, both Soda Polska Ciech now. So the names have to agree as well,
    by `NAME_AGREEMENT`. (A number from another country's register never gets
    this far: `Infobox.krs_number` leaves it out.)

    Measured over the 467 site companies an article gives the KRS number of
    (the 2026-08 dump against the 2026-10-07 register): 448 are linked and 19
    left out. About half of those are the cases above; the rest are companies
    renamed since the article was written - Presspublica is Gremi Media now -
    whose link a reader can still add by hand.
    """
    if not articles:
        return None
    if not register_name:
        return articles[0] if len(articles) == 1 else None
    best = max(articles, key=lambda article: name_agreement(register_name, article))
    if name_agreement(register_name, best) < NAME_AGREEMENT:
        return None
    return best


#: How an article names a local government that the register names directly:
#: by its office, or as its samorzad. Rewritten to what `JstIndex` reads.
_JST_SPELLINGS = (
    ("URZAD MARSZALKOWSKI WOJEWODZTWA ", "WOJEWODZTWO "),
    ("SAMORZAD WOJEWODZTWA ", "WOJEWODZTWO "),
    ("URZAD MIASTA ", "MIASTO "),
    ("URZAD MIEJSKI W ", "GMINA MIEJSKA W "),
    ("POWIAT GRODZKI ", "MIASTO NA PRAWACH POWIATU "),
    ("M.ST. ", "MIASTO STOLECZNE "),
    ("M. ST. ", "MIASTO STOLECZNE "),
)


def _register_spelling(name: str) -> str:
    text = normalise(name)
    for prefix, replacement in _JST_SPELLINGS:
        if text.startswith(prefix):
            return replacement + text[len(prefix) :]
    return text


def wiki_owners(
    shareholders: list[WikiShareholder],
    krs: str,
    jst: JstIndex | None,
    seat_wojewodztwo: str | None,
) -> list[Owner]:
    """The owners an article lists, as the `Owner`s an edge can be drawn from.

    Read only for a company the register names no owner of: where the register
    speaks it is current and the article may not be. The register publishes a
    spolka akcyjna's shareholders only when there is a single one, so this is
    mostly the SAs - Energa, Polimex Mostostal, PGZ, the special economic
    zones.

    An entry `ProcessWiki` has resolved is taken as it is. One it could not is
    tried against the TERYT register by name, the way `company_from_api_krs`
    reads a shareholder - "Gmina Miasta Gdansk" is no article's title - once
    the ways an article names a local government and the register does not are
    rewritten. The Treasury is not taken from that pass: `JstIndex` reads
    anything starting "Skarb Panstwa" as ours, and plwiki writes the Estonian
    one that way. An entry nobody can place is a person, a fund or a foreign
    company, and not something the site has a node for.
    """
    owners: list[Owner] = []
    for shareholder in shareholders:
        owner = None
        if shareholder.skarb_panstwa:
            owner = Owner(krs=None, teryt=SKARB_PANSTWA, source="wiki")
        elif shareholder.krs:
            if shareholder.krs != krs:
                owner = Owner(krs=shareholder.krs, teryt=None, source="wiki")
        elif shareholder.teryt:
            owner = Owner(krs=None, teryt=shareholder.teryt, source="wiki")
        elif jst is not None:
            resolved = jst.resolve(
                _register_spelling(shareholder.name), seat_wojewodztwo
            )
            if resolved and resolved not in (AMBIGUOUS, SKARB_PANSTWA):
                owner = Owner(krs=None, teryt=resolved, source="wiki")
        if owner is not None and owner not in owners:
            owners.append(owner)
    return owners


def public_through_wiki_owners(
    companies: list[Company], register: dict[str, Company]
) -> list[str]:
    """Marks public every company an article gives a public owner, and below.

    A public owner is the Treasury, a gmina, powiat or wojewodztwo, or a
    company that is public itself, and any stake will do. Szymon, 2026-10-07,
    on the 22 site companies this decided: "even the minority stakeholder is
    enough as a decision maker that could influence them". It is the rule the
    register's own owners already follow - `CompaniesKRS.propagate_is_public`
    marks every child of a public company public whatever the stake - so PKP
    Cargo (33% PKP) is public on the same terms as a spolka with a gmina among
    its wspolnicy. Which public owners hold only a minority is not recorded
    yet; that is task track-minority-public-ownership.

    Then carried down every ownership edge, the register's and the articles'
    alike, from the companies this marks and from no other: CompaniesKRS has
    already walked the register's own from its own public companies, and could
    not start from these, never having seen an article. So a company an
    article makes public makes its subsidiaries public, and one whose article
    names a company another article made public is public in turn.

    `register` is CompaniesKRS's output by KRS number, for the subsidiaries
    rejestr.io lists under a company rather than the parents an odpis lists
    over it. Returns the KRS numbers it marked, in the order it marked them.
    """
    by_krs = {company.krs: company for company in companies}
    children: dict[str, list[str]] = {}
    for company in register.values():
        for child in company.children:
            children.setdefault(company.krs, []).append(child)
    for company in companies:
        for owner in company.parents:
            if owner.krs:
                children.setdefault(owner.krs, []).append(company.krs)

    marked: list[str] = []
    for company in companies:
        if company.is_public:
            continue
        wiki = [owner for owner in company.parents if owner.source == "wiki"]
        # `teryt` is a gmina, powiat or wojewodztwo, or the Treasury's sentinel.
        if any(
            owner.teryt or (owner.krs in by_krs and by_krs[owner.krs].is_public)
            for owner in wiki
        ):
            company.is_public = True
            marked.append(company.krs)

    queue = list(marked)
    while queue:
        for child in children.get(queue.pop(0), []):
            subsidiary = by_krs.get(child)
            if subsidiary is not None and not subsidiary.is_public:
                subsidiary.is_public = True
                marked.append(child)
                queue.append(child)
    return marked


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
