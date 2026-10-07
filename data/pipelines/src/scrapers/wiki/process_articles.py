import itertools
import multiprocessing
import typing
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict, dataclass

import mwparserfromhell
import pandas as pd
from memoized_property import memoized_property  # type: ignore
from regex import match, search
from tqdm import tqdm

from entities.company import Wikipedia as Company
from entities.company import WikiShareholder
from entities.person import Wikipedia as People
from scrapers.stores import (
    Context,
    LocalFile,
    Pipeline,
    VersionedBackup,
    backup_disabled,
)
from scrapers.wiki.dump import dump_bytes, wiki_dump, wiki_workers
from scrapers.wiki.shareholders import (
    WikiLinks,
    article_url,
    clean_krs,
    normalize_teryt,
    normalize_title,
    parse_shareholders,
)
from scrapers.wiki.util import parse_date
from util.lists import WIKI_POLITICAL_LINKS
from util.polish import LOWER, UPPER

SAVE_ARTICLES = [
    "Stefan Wilkanowicz",
    "Jan Pamuła (ekonomista)",
    "Wojciech Wróblewski (socjolog)",
]

# Heurisic used to ignore some articles without parsing (expensive operation)
REQUIRED_WORDS = [
    "Naukowiec",
    "Duchowny",
    "Artysta",
    "Biogram",
    "Polityk",
    "Koszykarz",
    "Piłkarz",
    "Sportowiec",
    "Filmowiec",
    "Harcerz",
    "Żołnierz",
    "Tenisista",
    "Wrestler",
    "Rugbysta",
    "Architekt",
    "Astronauta",
    "Medalista",
    "Kierowca",
    "Osoba publiczna",
    "Zawodnik",
    "sportowy",
    "Szachista",
    "Brydż",
    "Przedsiębiorstwo",
    "przedsiębiorstwo",
    "Instytucja państwowa",
    # An association or a club gives its KRS number in a "numer rejestru" of
    # its own infobox, and 48 of the site's foundations and associations have
    # an article that does.
    "numer rejestru",
    # Not parsed for themselves but for the TERYT code they carry, which is
    # how `[[Konin]]` among a company's owners becomes the gmina it is - see
    # `scrapers.wiki.shareholders`.
    "Polskie miasto infobox",
    "jednostka administracyjna infobox",
    "Województwo infobox",
]

#: The infoboxes of the territorial units an owner can be: a city carries its
#: gmina's TERYT code as `TERYT`, a gmina or powiat its own as `TERC`.
REGION_INFOBOXES = ("Polskie miasto", "Polska jednostka administracyjna", "Województwo")


#: An infobox's `państwo` names the wojewodztwo instead of the country now and
#: then: "śląskie", "województwo warmińsko-mazurskie".
_VOIVODESHIPS = (
    "dolnośląskie",
    "kujawsko-pomorskie",
    "lubelskie",
    "lubuskie",
    "łódzkie",
    "małopolskie",
    "mazowieckie",
    "opolskie",
    "podkarpackie",
    "podlaskie",
    "pomorskie",
    "śląskie",
    "świętokrzyskie",
    "warmińsko-mazurskie",
    "wielkopolskie",
    "zachodniopomorskie",
)


def is_polish_country(country: str) -> bool:
    """Whether an infobox's `państwo` is Poland: "PL-PM", "POL", "Polska", a
    wojewodztwo, or nothing at all."""
    text = country.strip()
    if not text:
        return True
    if match(r"(PL(-|$)|POL$|POLSKA\b)", text.upper()):
        return True
    return any(voivodeship in text.lower() for voivodeship in _VOIVODESHIPS)


@dataclass(frozen=True)
class WikiRegion:
    """A city, gmina, powiat or wojewodztwo article, and the unit it is."""

    title: str
    teryt: str


@dataclass
class InfoboxStats:
    count: int
    values: list[str]


class Infobox:
    inf_type: str
    fields: dict[str, str]
    field_links: dict[str, list[str]]
    person_related: bool
    links: list[str]

    def __init__(self, infobox: mwparserfromhell.nodes.template.Template) -> None:
        self.inf_type = infobox.name.split("infobox")[0].strip()
        self.fields = {}
        self.field_links = {}
        #: `udziałowcy`, entry by entry, before anything is resolved. Parsed
        #: here, off the wikitext, because the plain `fields` value has lost
        #: the links and line breaks the entries are told apart by.
        self.shareholders: list[WikiShareholder] = []
        for param in infobox.params:
            name = param.name.strip_code().strip()
            self.fields[name] = param.value.strip_code().strip()
            self.field_links[name] = [
                str(link.title) for link in param.value.filter_wikilinks()
            ]
            if name == "udziałowcy":
                self.shareholders = parse_shareholders(param.value)

        self.person_related = (
            "imię i nazwisko" in self.fields
            or "polityk" in self.fields
            or "osoba" in self.fields
            or self.inf_type
            in [
                "Biogram",
                "Polityk",
                "Naukowiec",
                "Duchowny",
                "Artysta",
                "Sportowiec",
                "Pisarz",
                "Dziennikarz",
                "Menedżer",
            ]
        )
        self.links = [v for vs in self.field_links.values() for v in vs]

    @memoized_property
    def company_related(self) -> bool:
        # An association's or a club's infobox has "numer rejestru" with no
        # "rejestr" beside it, and is as much a place on the site as a company.
        return "rejestr" in self.fields or "numer rejestru" in self.fields

    @memoized_property
    def krs_number(self) -> str | None:
        """`numer rejestru`, when the register it numbers is KRS.

        A foreign company's infobox gives its own register's number in the
        same field - Orange its French SIREN, 380129866 - and five to ten
        digits padded to ten read as a KRS number like any other, so an owner
        linking to Orange's article came out as KRS 0380129866. Of the 3,279
        infoboxes on the 2026-08-31 dump that give such a number, 1,986 name
        KRS as the register and about 80 name another: IČO, SIREN, a
        Handelsregister, REGON or NIP. Of the 1,210 naming none, the country
        is Polish for 1,173 and foreign for 25, so with no register named the
        country decides, and a missing one is taken for Polish. A register
        field with no words in it names no register either: AGRO
        Ubezpieczenia's holds its NIP, beside a KRS number and "Polska".

        None for a number from another register; the field as it stands, ""
        included, otherwise.
        """
        number = self.fields.get("numer rejestru")
        if not number:
            return number
        register = self.fields.get("rejestr", "").strip().lower()
        if search(r"[^\W\d_]", register):
            return (
                number if "krs" in register or "krajowy rejestr" in register else None
            )
        return number if is_polish_country(self.fields.get("państwo", "")) else None

    @memoized_property
    def teryt(self) -> str | None:
        """The territorial unit a city, gmina or powiat infobox is about."""
        if self.inf_type not in REGION_INFOBOXES:
            return None
        for name in ("TERYT", "TERC"):
            code = search(r"\d+", self.fields.get(name, ""))
            if code:
                return normalize_teryt(code.group(0))
        return None

    @memoized_property
    def birth_iso(self):
        return parse_date(self.fields.get("data urodzenia", ""))

    @memoized_property
    def birth_year(self):
        return int(self.birth_iso.split("-")[0]) if self.birth_iso else None

    @staticmethod
    def parse(parsed: mwparserfromhell.wikicode.Wikicode) -> list["Infobox"]:
        all_infoboxes = parsed.filter_templates(matches=lambda t: "infobox" in t.name)
        result = []
        for infobox in all_infoboxes:
            result.append(Infobox(infobox))

        return result


def get_links(parsed: mwparserfromhell.wikicode.Wikicode, prefix=""):
    links = [str(link.title) for link in parsed.filter_wikilinks()]
    if prefix:
        return [link for link in links if link.startswith(prefix)]
    return links


def safe_middle_name_pattern(title):
    for escapable in ["(", ")", "?", "*", "[", "]", "+"]:
        title = title.replace(escapable, f"\\{escapable}")
    return f"'''({title.replace(' ', f'[ {UPPER}{LOWER}]*')})'''"


class WikiArticle:
    title: str
    original_title: str
    categories: list[str]
    links: list[str]
    infoboxes: list[Infobox]

    def __init__(self, title, categories, links, infoboxes, original_title=None):
        self.title = title
        self.original_title = original_title if original_title is not None else title
        self.categories = categories
        self.links = links
        self.infoboxes = infoboxes

    @staticmethod
    def extend_name(title, wikitext):
        pattern = safe_middle_name_pattern(title)
        try:
            full_name = search(pattern, wikitext)
            if full_name is not None and full_name.group(1) != title:
                # print(f"Changing title from {title} to {full_name.group(1)}")
                title = full_name.group(1)
        except Exception as e:
            print(pattern, title, "exception while processing")
            raise e
        return title

    @staticmethod
    def parse_text(title, wikitext, filter_required_words=True):
        if filter_required_words and not any(
            word in wikitext for word in REQUIRED_WORDS
        ):
            return None

        parsed = mwparserfromhell.parse(wikitext)
        infoboxes = Infobox.parse(parsed)
        extended_title = WikiArticle.extend_name(title, wikitext)

        return WikiArticle(
            title=extended_title,
            original_title=title,
            categories=get_links(parsed, prefix="Kategoria:"),
            links=get_links(parsed),
            infoboxes=infoboxes,
        )

    @staticmethod
    def parse(elem: ET.Element):
        title = elem.findtext("{http://www.mediawiki.org/xml/export-0.11/}title")
        revision = elem.find("{http://www.mediawiki.org/xml/export-0.11/}revision")

        if not title:
            print(f"Failed to find title in {elem.tag}")
            return None
        if revision is None:
            print(f"Failed to find revision in {title}")
            return None
        wikitext = revision.findtext("{http://www.mediawiki.org/xml/export-0.11/}text")
        if not wikitext:
            print(f"Failed to find text in {title}")
            return None

        return WikiArticle.parse_text(title, wikitext)

    def get_infobox(self, extractor: typing.Callable[["Infobox"], typing.Any | None]):
        for infobox in self.infoboxes:
            result = extractor(infobox)
            if result is not None:
                return result
        return None

    @memoized_property
    def normalized_links(self):
        def generate():
            for entry in itertools.chain(
                self.categories,
                self.links,
                # Extract links from infobox if they exist
                *[infobox.links for infobox in self.infoboxes],
            ):
                n = entry.rstrip("]").lstrip("[").split("|")[0]
                if n.isdigit():
                    continue
                yield n

        return set(generate())

    @memoized_property
    def content_score(self) -> int:
        """
        When higher than 0, it indicates that this article has political conotations
        """
        score = len(self.normalized_links.intersection(WIKI_POLITICAL_LINKS))

        for infobox in self.infoboxes:
            # TODO extend content score to a better logic
            # https://github.com/SzymonPajzert/koryta/issues/170 #170
            for public_region in ["miasto", "województwo", "gmina"]:
                if public_region in infobox.fields.get("udziałowcy", "").lower():
                    score += 1

        return score

    @memoized_property
    def about_person(self):
        if len(self.infoboxes) == 0:
            return False
        for infobox in self.infoboxes:
            if infobox.person_related:
                year = infobox.birth_year
                if year and year < 1920:
                    return False
                return True
        return False

    @memoized_property
    def about_company(self):
        if len(self.infoboxes) == 0:
            return False
        for infobox in self.infoboxes:
            if infobox.company_related:
                return True
        return False


class Stats:
    interesting_counter = 0
    infobox_types: Counter[str] = Counter()
    infobox_stats: Counter[str] = Counter()
    category_stats: Counter[str] = Counter()

    def ingest_infobox(self, infobox: Infobox):
        self.infobox_types[infobox.inf_type] += 1
        for field in infobox.fields:
            self.infobox_stats[field] += 1

    def ingest_article(self, article: WikiArticle):
        score = article.content_score
        if score > 0:
            self.interesting_counter += 1

            for cat in article.normalized_links:
                if cat in WIKI_POLITICAL_LINKS:
                    continue
                self.category_stats[cat] += 1 + score

            for infobox in article.infoboxes:
                self.ingest_infobox(infobox)


def extract_from_article(
    article: WikiArticle,
) -> People | Company | WikiRegion | None:
    person = article.about_person
    company = article.about_company

    if person and company:
        # raise ValueError("Conflict of mapping to both person and company")
        return None
    elif person:
        title_escaped = article.original_title.replace(" ", "_")
        return People(
            source=f"https://pl.wikipedia.org/wiki/{title_escaped}",
            full_name=article.title,
            party=article.get_infobox(lambda i: i.fields.get("partia", "")),
            birth_iso8601=article.get_infobox(lambda i: i.birth_iso),
            birth_year=article.get_infobox(lambda i: i.birth_year),
            infoboxes=[i.inf_type for i in article.infoboxes],
            content_score=article.content_score,
            links=[],
        )
    elif company:
        # The article is about the company in its first company infobox. One
        # further down is another company's - Raiffeisen-Leasing's article is
        # the Austrian group's and carries Raiffeisen-Leasing Polska in a
        # second infobox, Microsoft's carries Microsoft sp. z o.o. - and lends
        # the article nothing: not its name or owners, and not its KRS number,
        # which would turn every owner that links to the group's article into
        # the subsidiary. An infobox of another kind describes the article's
        # own subject from another side - LOT's airline infobox gives its
        # owners as they are now, its company infobox as they were - so the
        # owners are read from either, in the order of the page.
        own = next(i for i in article.infoboxes if i.company_related)
        boxes = [i for i in article.infoboxes if i is own or not i.company_related]

        def field(extractor: typing.Callable[[Infobox], typing.Any | None]):
            return next((v for i in boxes if (v := extractor(i)) is not None), None)

        # The company infobox names the company as the register does, where an
        # airline's or an airport's names the brand: Port Polska's article
        # gives Centralny Port Komunikacyjny's number.
        name = own.fields.get("nazwa") or field(lambda i: i.fields.get("nazwa") or None)
        return Company(
            name=name or article.title,
            krs=own.krs_number,
            content_score=article.content_score,
            title=article.original_title,
            source=article_url(article.original_title),
            # Unresolved: who an entry is takes the whole dump to say, so
            # `scrape_wiki` fills that in once it has read every article.
            shareholders=field(lambda i: i.shareholders or None) or [],
            categories=list(
                dict.fromkeys(
                    c.removeprefix("Kategoria:").strip() for c in article.categories
                )
            ),
        )

    teryt = article.get_infobox(lambda i: i.teryt)
    if teryt is not None:
        return WikiRegion(title=article.original_title, teryt=teryt)
    return None


def extract(elem: ET.Element) -> People | Company | WikiRegion | None:
    article = WikiArticle.parse(elem)
    if article is None:
        return None
    return extract_from_article(article)


def process_article_worker(args):
    title, wikitext = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if article is None:
            return None
        return extract_from_article(article), article
    except Exception:
        return None


#: The second file `ProcessWiki` writes, beside `person_wikipedia`.
COMPANY_ARTICLES = "company_wikipedia"


class ProcessWiki(Pipeline[People]):
    filename = "person_wikipedia"  # TODO support two filenames
    confirm_run = True

    def process(self, ctx: Context):
        people, companies = scrape_wiki(ctx)

        people.sort(key=lambda x: x.content_score, reverse=True)
        companies.sort(key=lambda x: x.content_score, reverse=True)

        comp_df = pd.DataFrame([asdict(c) for c in companies])
        self.write_dataframe(ctx, comp_df, COMPANY_ARTICLES, "jsonl")

        return pd.DataFrame([asdict(p) for p in people])


def read_company_articles(ctx: Context) -> pd.DataFrame:
    """`ProcessWiki`'s company articles: on disk, else the shared cache's newest.

    A second file rather than a pipeline's output, so neither the refresh
    policy nor the restore `Pipeline.read` does knows it exists - which is why
    the nightly, holding ProcessWiki at what the shared cache has, has never had
    it on disk. Read from the cache into memory and not written down: it is a
    few hundred kilobytes, and a copy left on a machine that never runs
    ProcessWiki would go stale without anything noticing.

    Raises FileNotFoundError when there is no copy to read anywhere.
    """
    local = LocalFile(f"{COMPANY_ARTICLES}/{COMPANY_ARTICLES}.jsonl", "versioned")
    # Read as text: a KRS number read as a number loses its leading zeros.
    dtype = {"krs": str, "title": str, "name": str, "source": str}
    try:
        return ctx.io.read_data(local).read_dataframe("jsonl", dtype=dtype)
    except FileNotFoundError:
        if backup_disabled():
            raise
    return ctx.io.read_data(VersionedBackup(COMPANY_ARTICLES)).read_dataframe(
        "jsonl", dtype=dtype
    )


def scrape_wiki(ctx: Context):
    """
    Parses the Wikipedia dump, filters for target categories,
    and uploads individual XML files to GCS.
    """

    dump = wiki_dump()

    # Use bz2 to decompress the file on the fly
    with ctx.io.read_data(dump).read_zip().read_file() as f:
        # Use iterparse for memory-efficient XML parsing
        # We only care about the 'end' event of a 'page' tag
        print(f"🗂️  Starts processing dump file: {dump.filename}")

        tq = tqdm(total=dump_bytes(), unit_scale=True, smoothing=0.1)
        prev = 0

        def article_generator():
            nonlocal prev
            for event, elem in ET.iterparse(f, events=("end",)):
                current_pos = f.tell()
                tq.update(current_pos - prev)
                prev = current_pos

                if elem.tag.endswith("page"):
                    title = elem.findtext(
                        "{http://www.mediawiki.org/xml/export-0.11/}title"
                    )
                    revision = elem.find(
                        "{http://www.mediawiki.org/xml/export-0.11/}revision"
                    )
                    if title in SAVE_ARTICLES:
                        with open(f"tests/wiki/{title}.xml", "w") as out:
                            out.write(ET.tostring(elem, encoding="unicode"))

                    redirect = elem.find(
                        "{http://www.mediawiki.org/xml/export-0.11/}redirect"
                    )
                    if redirect is not None:
                        # Kept for where it points and nothing else: it is
                        # how `[[Polski Koncern Naftowy Orlen]]` among Energa's
                        # owners reaches the article giving Orlen's KRS
                        # number. Its text is one link, which no worker has
                        # anything to do with.
                        ns = elem.findtext(
                            "{http://www.mediawiki.org/xml/export-0.11/}ns"
                        )
                        source = normalize_title(title)
                        target = normalize_title(redirect.get("title"))
                        if ns == "0" and source and target:
                            redirects[source] = target
                        elem.clear()
                        continue

                    if title and revision:
                        wikitext = revision.findtext(
                            "{http://www.mediawiki.org/xml/export-0.11/}text"
                        )
                        if wikitext:
                            yield (title, wikitext)
                    elem.clear()

        stats = Stats()

        people = []
        companies = []
        regions: list[WikiRegion] = []
        redirects: dict[str, str] = {}

        with multiprocessing.Pool(processes=wiki_workers()) as pool:
            for pair in pool.imap_unordered(
                process_article_worker, article_generator(), chunksize=1000
            ):
                if pair:
                    entity, article = pair
                    if isinstance(entity, WikiRegion):
                        regions.append(entity)
                    elif entity:
                        if isinstance(entity, People):
                            people.append(entity)
                        elif isinstance(entity, Company):
                            companies.append(entity)
                        stats.ingest_article(article)

    print("🎉 Processing complete.")
    print(stats)
    resolve_shareholders(companies, link_index(companies, regions, redirects))
    return people, companies


def link_index(
    companies: list[Company], regions: list[WikiRegion], redirects: dict[str, str]
) -> WikiLinks:
    """What every title an owner can link to is, out of one pass of the dump."""
    krs: dict[str, str] = {}
    for company in companies:
        title = normalize_title(company.title)
        number = clean_krs(company.krs)
        if title and number:
            krs[title] = number
    teryt: dict[str, str] = {}
    for region in regions:
        title = normalize_title(region.title)
        if title:
            teryt[title] = region.teryt
    print(
        f"Owners can link to {len(krs)} company articles with a KRS number and "
        f"{len(teryt)} territorial units, through {len(redirects)} redirects"
    )
    return WikiLinks(redirects=redirects, krs=krs, teryt=teryt)


def resolve_shareholders(companies: list[Company], links: WikiLinks) -> None:
    """Says who each company's listed owners are, now the whole dump is read.

    Printed by kind, because the failure here is silent: a change to the
    parser or to how titles are written can turn every owner into a bare name
    and nothing downstream would notice. On the 2026-08 dump 1,731 of 11,540
    company articles list owners, and their 2,484 entries name a company by
    KRS number 279 times, a territorial unit 110 times and the Treasury 89
    times. The 2,006 left are people, funds, "pozostali" and the owners of
    foreign companies, which most of the articles are about.
    """
    kinds: Counter[str] = Counter()
    for company in companies:
        own_krs = clean_krs(company.krs)
        company.shareholders = [
            links.resolve(shareholder, own_krs) for shareholder in company.shareholders
        ]
        for shareholder in company.shareholders:
            if shareholder.skarb_panstwa:
                kinds["the Treasury"] += 1
            elif shareholder.krs:
                kinds["a company by KRS"] += 1
            elif shareholder.teryt:
                kinds["a territorial unit"] += 1
            else:
                kinds["a name only"] += 1
    listing = sum(1 for company in companies if company.shareholders)
    print(f"{listing} of {len(companies)} company articles list their owners:")
    for kind, count in kinds.most_common():
        print(f"  {count:6d}  {kind}")
