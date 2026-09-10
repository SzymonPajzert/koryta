import collections
import dataclasses
import json
import re
import typing
from datetime import datetime
from typing import Type

from pandas import DataFrame

from entities.company import KRS, Owner, Source
from entities.company import Company as KrsCompany
from entities.person import KRS as KrsPerson
from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import QueryRelation
from scrapers.krs.organs import supervision_kind
from scrapers.map.jst import AMBIGUOUS, SKARB_PANSTWA, JstIndex
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Jst, Teryt, normalize_unit_name
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile, latest_crawls, split_crawl_date

curr_date = datetime.now().strftime("%Y-%m-%d")


#: What each kind of rejestr.io connection is, as a post somebody holds in a
#: company - or None where it is not a post at all.
#:
#: The two names for a registered representative are the opposite way round from
#: how they read, which is worth checking rather than guessing: KRS 0000106310
#: lists exactly the two `KRS_PROXY` people under `prokurenci`, and KRS
#: 0000012221 has no prokurenci at all and lists its `KRS_PROCURATOR` person
#: under `pelnomocnicy`.
#:
#: The None ones are owners, beneficial owners and people a court put over the
#: company. Each is worth having - a shareholder as ownership, a receiver as
#: insolvency - and none of them is a job, which is the only thing this
#: pipeline has anywhere to put.
KRS_RELATION_ROLES: dict[str, str | None] = {
    "KRS_BOARD": "Zarząd",
    "KRS_SUPERVISION": "Rada Nadzorcza",
    "KRS_PROXY": "Prokurent",
    "KRS_PROCURATOR": "Pełnomocnik",
    "KRS_SHAREHOLDER": None,
    "KRS_ONLY_SHAREHOLDER": None,
    "BENEFICIARY": None,
    "KRS_FOUNDER": None,
    "KRS_RECEIVER": None,
    "KRS_CURATOR": None,
    "KRS_COMMISSIONER": None,
    "KRS_RESTRUCTURIZATOR": None,
}


@dataclasses.dataclass(frozen=True)
class Post:
    """One thing one person did at one company, for as long as they did it."""

    role: str
    start: str | None
    end: str | None

    @property
    def years(self) -> str:
        """How long it lasted, in years, as `employed_for` has always read."""
        if self.start is None:
            return "0.00"
        end = datetime.fromisoformat(self.end or curr_date)
        return f"{(end - datetime.fromisoformat(self.start)).days / 365:.2f}"


#: The two shapes rejestr.io gives a person. ``osoba-bez-pesel`` is one it holds
#: no PESEL for - a foreign national, or an entry old enough to predate the
#: number - and it arrives with a name and nothing else: no birth date, no sex.
#: Accepting only the first shape dropped 6,606 entries covering 3,912 people
#: and 6,227 board, supervisory and proxy seats, so `people_to_scrape` could not
#: see them and `companies_without_names` did not know their companies existed.
#:
#: They stop at `PeopleKRS`. `PeopleKRSMerged` selects
#: ``WHERE birth_date IS NOT NULL`` (analysis/people_krs_merged.py:39), which
#: none of them satisfy, so nothing published changes by admitting them here.
PERSON_TYPES = frozenset({"osoba", "osoba-bez-pesel"})


def posts_held(item: dict, unknown: typing.Counter[str] | None = None) -> list[Post]:
    """The posts one rejestr.io person entry says the person held.

    A person turns up once per company, with every connection they have ever had
    to it listed together - and those are not all the same thing, nor all at the
    same time. Krystyna Gryglas sat on the board of KRS 0000076251 from December
    2001 to August 2003 and was its prokurent for the five years after that; 6.5%
    of entries mix kinds like this, and rather more mix dates.

    Collapsing that into a single spell, as this used to, produced a person who
    was on the board for seven years, and it produced them by taking the
    earliest start of anything and the latest end of anything. Which is why one
    row per connection: a post is what somebody held, and its dates are its own.
    """
    posts = []
    for conn in item.get("krs_powiazania_kwerendowane", []):
        assert isinstance(conn, dict)
        typ = conn.get("typ")
        if typ not in KRS_RELATION_ROLES:
            if unknown is not None:
                unknown[str(typ)] += 1
            continue
        role = KRS_RELATION_ROLES[typ]
        if role is None:
            continue
        posts.append(
            Post(role=role, start=conn.get("data_start"), end=conn.get("data_koniec"))
        )
    return posts


class PeopleKRS(Pipeline):
    filename = "person_krs"
    # `id` is rejestr.io's person id and `employed_for` a formatted number;
    # both are all digits, so a restore from the shared cache re-infers them
    # as int64 and float64 unless pinned.
    dtype = {
        "employed_krs": str,
        "id": str,
        "employed_for": str,
    }

    def process(self, ctx: Context):
        return extract_people(ctx)


def extract_people(ctx: Context):
    """Everyone rejestr.io ties to a company, as the register stands now.

    Every crawl of a query is kept in the bucket under its own ``date=``, so the
    prefix holds one blob per company per crawl. Reading all of them states each
    connection once per crawl it survived - the same board seat as it stood in
    February, in May and in July - and the copies do not even agree: a seat that
    ended between two crawls is open in the earlier blob and closed in the later
    one, so the person comes out both still employed and long gone.

    Only the newest crawl of each query describes the register as it is, so that
    is the only one kept. Which crawl that is gets decided over what arrives,
    not over a listing of the bucket, and the reason is `read_many`: it serves
    this prefix from the compressed mirror, seconds against the hour the 29k
    objects take one at a time, and it hands back everything under the hostname
    in whatever order the archive holds it. Naming the newest crawl from a
    listing first would read better but breaks on a mirror built before that
    crawl was taken - the query would contribute nothing at all rather than the
    previous crawl, which is the wrong way to fail.

    The cost of that choice is that superseded blobs are still fetched. On the
    mirror path they arrive inside one archive and are free; on the fallback
    path this is the egress an earlier version of this function avoided.
    """
    unknown_relations: typing.Counter[str] = collections.Counter()
    # subject -> (crawl date, the rows that crawl produced). Keyed by the query
    # with its `date=` removed, which is what identifies the thing crawled.
    latest: dict[str, tuple[str, list[KrsPerson]]] = {}

    for blob_name, blob in ctx.io.read_many(CloudStorage(prefix="hostname=rejestr.io")):
        if "aktualnosc_" not in blob_name:
            continue
        if "/osoby/" in blob_name:
            # A person's own feed answers "which companies is this person tied
            # to", so it holds only `organizacja` entries and never yielded a
            # row here - 4,198 documents parsed for nothing. What is in them is
            # used, just elsewhere: `companies_to_scrape` reads them to find
            # companies worth crawling, and `PersonFeedCoverage` reads the
            # register entry numbers to tell whether the feed is stale.
            continue
        subject, date = split_crawl_date(blob_name)
        seen = latest.get(subject)
        if seen is not None and seen[0] >= date:
            # A crawl this one supersedes. Skipped before parsing rather than
            # after, so the work is proportional to the companies, not to how
            # often they have been crawled.
            continue
        content = blob.read_string()
        if content == "":
            # A failed fetch. Nothing is recorded for it, so a crawl taken
            # before it stands - stale by one crawl beats losing the company.
            print(f"  [WARN] Crawl {blob_name} is empty, skipping")
            continue
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
            raise e
        people: list[KrsPerson] = []
        try:
            for item in data:
                if item.get("typ") in PERSON_TYPES:
                    identity = item.get("tozsamosc", {})
                    for post in posts_held(item, unknown_relations):
                        people.append(
                            KrsPerson(
                                id=item["id"],
                                first_name=identity.get("imie"),
                                last_name=identity.get("nazwisko"),
                                full_name=identity.get("imiona_i_nazwisko"),
                                birth_date=identity.get("data_urodzenia"),
                                second_names=identity.get("drugie_imiona"),
                                sex=identity.get("plec"),
                                rejestrio_type=item.get("typ"),
                                employed_krs=KRS.from_blob_name(blob_name).id,
                                employed_start=post.start,
                                employed_end=post.end,
                                employed_for=post.years,
                                employed_role=post.role,
                            )
                        )
        except KeyError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
            continue
        latest[subject] = (date, people)

    outputs = [person for _, people in latest.values() for person in people]

    if unknown_relations:
        # rejestr.io grew a kind of connection nobody has classified. Dropping
        # it is the safe reading - the alternative is publishing it as a job -
        # but it should not happen quietly.
        print(f"Unclassified rejestr.io relations: {dict(unknown_relations)}")

    return DataFrame.from_records([dataclasses.asdict(d) for d in outputs])


def is_owned_by_queried(item: dict, unknown: typing.Counter[str] | None = None) -> bool:
    """Whether this rejestr.io entry is a company the queried one owns.

    Every connection is looked at, not just the first. A company can be tied to
    the queried one more than once - a board seat and a shareholding, say - and
    rejestr.io lists them in no particular order, so reading only
    ``krs_powiazania_kwerendowane[0]`` dropped the ownership whenever something
    else happened to be listed first. `propagate_is_public` walks these edges,
    so a dropped one is a company that does not inherit being public.
    """
    # Not `any(...)`, which would stop at the first ownership edge and leave the
    # rest of the connections uncounted.
    children = [
        QueryRelation.from_rejestrio(conn).is_child(unknown)
        for conn in item.get("krs_powiazania_kwerendowane", [])
    ]
    return any(children)


class CompaniesKRS(Pipeline[KrsCompany]):
    filename = "company_krs"
    # These are written as strings and have to be read back as strings. Without
    # the pin pandas types the columns as floats, so a REGON of "010053589"
    # comes back as 10053589.0 -- the leading zero gone, and a ".0" appended to
    # every identifier downstream of here.
    dtype = {"krs": str, "nip": str, "regon": str, "teryt_code": str}
    postal_codes: PostalCodes
    jst: Jst
    hardcoded_companies: CompaniesHardcoded
    teryt: Teryt

    def __init__(self) -> None:
        super().__init__()
        self.companies: dict[str, KrsCompany] = {}
        self.company_sources: dict[str, set[Source]] = {}
        self.awaiting_relations: dict[str, list[tuple[str, str]]] = {}
        self.unknown_relations: typing.Counter[str] = collections.Counter()

    @property
    def output_class(self) -> Type:
        return KrsCompany

    def add_company(self, company: KrsCompany):
        krs_id = company.krs
        if krs_id in self.companies:
            existing = self.companies[krs_id]
            existing.name = existing.name or company.name
            existing.city = existing.city or company.city
            existing.teryt_code = existing.teryt_code or company.teryt_code
            existing.nip = existing.nip or company.nip
            existing.regon = existing.regon or company.regon
            existing.activity = existing.activity or company.activity
            existing.is_public = existing.is_public or company.is_public
            # Only an api-krs odpis carries these two; a company first seen
            # through rejestr.io arrives with both empty, and without these
            # lines whichever blob was read first would pin them empty for
            # good.
            existing.form = existing.form or company.form
            existing.supervisory_organ = (
                existing.supervisory_organ or company.supervisory_organ
            )
            for owner in company.parents:
                if owner not in existing.parents:
                    existing.parents.append(owner)
            self.companies[krs_id] = existing
        else:
            self.companies[company.krs] = company

        if krs_id in self.awaiting_relations:
            for parent, child in self.awaiting_relations[krs_id]:
                self.add_relation(parent, child)
            del self.awaiting_relations[krs_id]

        return company

    def add_company_source(self, company: str, uri: str):
        source = uri.removeprefix("gs://koryta-pl-crawled/hostname=")
        source = source.split("/")[0]
        source_type: typing.Literal["rejestr-io", "api-krs"] = "api-krs"
        if source == "rejestr.io":
            source_type = "rejestr-io"
        self.company_sources[company] = self.company_sources.get(company, set()) | {
            Source(source_type, source)
        }

    def add_awaiting(self, company: str, relation: tuple[str, str]):
        self.awaiting_relations[company] = self.awaiting_relations.get(company, []) + [
            relation
        ]

    def add_relation(self, parent: str, child: str):
        if parent in self.companies and child in self.companies:
            self.companies[parent].children.append(child)
            self.companies[child].parents.append(Owner(krs=parent, teryt=None))
        elif child not in self.companies:
            self.add_awaiting(child, (parent, child))
        elif parent not in self.companies:
            self.add_awaiting(parent, (parent, child))

    def iterate_blobs(self, ctx: Context, hostname: str):
        """Every crawled object under ``hostname``, as it was crawled last.

        `add_company` merges each blob into what it already knows field by
        field, keeping the first non-empty value, so re-reading a company's
        older crawls is not harmful the way it is for people - but it is not
        free either, and the ownership edges it replays are the *old* ones. The
        newest crawl is the answer to "who owns this company", so read that.
        """
        listing = [
            blob_ref
            for blob_ref in ctx.io.list_files(
                CloudStorage(prefix=f"hostname={hostname}")
            )
            # A crawl that failed is stored as a zero-byte object, and dropping
            # it here rather than after `latest_crawls` is the whole point: the
            # newest crawl of a company may be the failed one, and taking it
            # and then skipping it loses the company altogether instead of
            # falling back to the last crawl that worked. `extract_people`
            # makes the same choice, for the same reason.
            if isinstance(blob_ref, DownloadableFile) and blob_ref.size != 0
        ]
        for blob_ref in latest_crawls(listing, lambda ref: ref.url):
            blob = ctx.io.read_data(blob_ref)
            content = blob.read_string()
            if content == "":
                # Still checked: a listing that carries no sizes cannot say.
                continue
            data = json.loads(content)
            yield blob_ref.url, data

    def process_rejestrio_blob(
        self, blob_name: str, data, postal_codes: DataFrame
    ) -> None:
        if "aktualnosc_" in blob_name:
            parent: KRS | None = None
            if "/org" in blob_name:
                parent = KRS.from_blob_name(blob_name)
                self.add_company_source(parent.id, blob_name)

            for item in data:
                if item.get("typ") != "organizacja":
                    continue
                c = self.add_company(company_from_rejestrio(item, postal_codes))
                self.add_company_source(c.krs, blob_name)

                if "aktualnosc_aktualne" in blob_name:
                    if parent is not None and is_owned_by_queried(
                        item, self.unknown_relations
                    ):
                        self.add_relation(parent.id, c.krs)

        elif "/org" in blob_name:
            c = company_from_rejestrio(data, postal_codes)
            self.add_company(c)
            self.add_company_source(c.krs, blob_name)

    def process_api_krs_blob(
        self, blob_name: str, data, postal_codes: DataFrame
    ) -> None:
        if "Biuletyn" in blob_name:
            return
        c = company_from_api_krs(postal_codes, self.teryt, data, self.jst_index)
        if c is None:
            return
        self.add_company(c)
        self.add_company_source(c.krs, blob_name)

    def compute_public_krss(self, hardcoded) -> set[str]:
        """Base case: companies explicitly public or hardcoded as public."""
        public_krss = set()
        for company in self.companies.values():
            if company.is_public:
                public_krss.add(company.krs)
            hc = hardcoded.get(company.krs)
            if hc and any(
                src
                in [
                    "MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO_KRSs",
                    "SPOLKI_SKARBU_PANSTWA",
                ]
                for src in hc.sources
            ):
                public_krss.add(company.krs)
                company.is_public = True
        return public_krss

    def build_parent_to_children(self) -> dict[str, list[str]]:
        parent_to_children: dict[str, list[str]] = {}
        for company in self.companies.values():
            for child in company.children:
                parent_to_children.setdefault(company.krs, []).append(child)
            for owner in company.parents:
                if owner.krs:
                    parent_to_children.setdefault(owner.krs, []).append(company.krs)

        for relations in self.awaiting_relations.values():
            for p_id, child_id in relations:
                parent_to_children.setdefault(p_id, []).append(child_id)

        return parent_to_children

    def propagate_is_public(
        self, public_krss: set[str], parent_to_children: dict[str, list[str]]
    ) -> None:
        queue = list(public_krss)
        while queue:
            curr = queue.pop(0)
            for child in parent_to_children.get(curr, []):
                if child in self.companies and not self.companies[child].is_public:
                    self.companies[child].is_public = True
                    queue.append(child)

    def build_output(self, hardcoded) -> list[KrsCompany]:
        output = []
        for company in self.companies.values():
            company_sources = self.company_sources.get(company.krs, set())
            hc = hardcoded.get(company.krs)
            if hc:
                for src in hc.sources:
                    company_sources.add(Source(source="hardcoded", reason=src))

            output.append(dataclasses.replace(company, sources=list(company_sources)))
        return output

    def process(self, ctx: Context):
        """
        Iterates through GCS files from rejestr.io, parses them,
        and extracts information about companies.
        """
        postal_codes = self.postal_codes.read_or_process(ctx)
        self.jst.read_or_process(ctx)
        self.jst_index = getattr(self.jst, "index", None)
        self.hardcoded_companies.process(ctx)
        hardcoded = self.hardcoded_companies.all_companies_krs

        for blob_name, data in self.iterate_blobs(ctx, "rejestr.io"):
            self.process_rejestrio_blob(blob_name, data, postal_codes)

        if self.unknown_relations:
            # A kind of connection between two companies that neither
            # PARENT_RELATION nor IGNORED_PARENT knows. It is read as "not
            # ownership", which is the safe reading, but if it turns out to be
            # one it is a company that will not inherit being public.
            print(f"Unclassified rejestr.io relations: {dict(self.unknown_relations)}")

        for blob_name, data in self.iterate_blobs(ctx, "api-krs.ms.gov.pl"):
            self.process_api_krs_blob(blob_name, data, postal_codes)

        public_krss = self.compute_public_krss(hardcoded)
        parent_to_children = self.build_parent_to_children()
        self.propagate_is_public(public_krss, parent_to_children)
        output = self.build_output(hardcoded)

        self.check_awaiting()
        return DataFrame.from_records([dataclasses.asdict(c) for c in output])

    def check_awaiting(self):
        for k, vs in self.awaiting_relations.items():
            for v in vs:
                if v[0] == k:
                    continue

                raise ValueError(f"Awaiting relations not empty: {k} {v}")


def company_from_rejestrio(data: dict, pcs: DataFrame | None = None) -> KrsCompany:
    krs = data["numery"]["krs"]
    name = data["nazwy"]["skrocona"]
    city = data.get("adres", {}).get("miejscowosc", "")
    teryt_code = None
    if "adres" in data and "teryt" in data["adres"] and data["adres"]["teryt"]:
        t = data["adres"]["teryt"]
        # Prefer powiat (4 digits) if available
        teryt_code = t.get("powiat") or t.get("wojewodztwo")

    if not teryt_code and pcs is not None:
        # rejestr.io calls it `kod`; `kodPocztowy` is what api-krs calls it, and
        # reading only that name here meant every company this branch had to
        # handle - the ones rejestr.io gave no `teryt` for - was looked up on
        # its city alone.
        adres = data.get("adres", {})
        postal_code = adres.get("kod") or adres.get("kodPocztowy")
        teryt_code = get_teryt(pcs, city, postal_code)

    nip = data.get("numery", {}).get("nip")
    regon = data.get("numery", {}).get("regon")

    return KrsCompany(
        krs=krs, name=name, city=city, teryt_code=teryt_code, nip=nip, regon=regon
    )


#: The register is inconsistent about the hyphen in "Kudowa-Zdrój" and
#: "Kędzierzyn-Koźle"; GeoNames is not.
_SPACED_HYPHEN = re.compile(r"\s*-\s*")
_SPA_SUFFIX = re.compile(r"\s+(zdrój|zdroj)$")


def normalize_city(city: str) -> str:
    """A city name in the form the postal code table spells it.

    The same "M. NOWY SĄCZ" prefix TERYT names never carry, plus the hyphen: a
    company whose city no table matches is a company with no region at all, and
    every rewrite here was one of those.
    """
    city = _SPACED_HYPHEN.sub("-", normalize_unit_name(city))
    return _SPA_SUFFIX.sub(r"-\1", city)


def _dominant(candidates: DataFrame) -> str | None:
    """The TERYT code of these rows, if they are near enough unanimous.

    Near enough and not exactly, because one stray row - a hamlet sharing a
    name or a postal code with a town - should not disqualify the town.
    """
    if candidates.empty:
        return None
    counts = candidates["teryt"].value_counts()
    if counts.empty:
        return None
    if counts.iloc[0] / len(candidates) > 0.9:
        return counts.index[0]
    return None


#: How long a TERYT code that names a gmina is. `fallback` only outranks the
#: postal code table when it got this far: a register entry that resolves to a
#: gmina is one whose three names agree with each other and with TERYT, and one
#: that stopped at the powiat or the województwo is an entry that contradicted
#: itself somewhere - the old powiat "warszawski", or a gmina in the wrong
#: powiat - which is no reason to prefer it over a table.
GMINA_CODE_LENGTH = 6


def get_teryt(pcs: DataFrame, city: str, code: str | None, fallback: str = ""):
    """Where a company sits, as a TERYT code, from its address.

    Tried in order of how much each answer is worth: the whole address agreeing
    on one row, then the division the register itself names, then the two keys
    that only guess - the city name as it always did, and the postal code,
    which places the addresses no name in the table matches.
    """
    code = (code or "").replace(" ", "")
    names = [n for n in dict.fromkeys([city.lower(), normalize_city(city)]) if n]

    for name in names:
        exact = pcs[(pcs["city"] == name) & (pcs["postal_code"] == code)]
        if not exact.empty:
            return exact.iloc[0]["teryt"]

    if len(fallback) >= GMINA_CODE_LENGTH:
        return fallback

    for name in names:
        by_city = _dominant(pcs[pcs["city"] == name])
        if by_city is not None:
            return by_city

    # "Warszawa-Włochy" is a district, and in no table keyed on city names;
    # 04-128 is in every one.
    if code:
        by_code = _dominant(pcs[pcs["postal_code"] == code])
        if by_code is not None:
            return by_code

    if fallback:
        # A powiat or a województwo, which every consumer reads as a prefix of
        # the code it wanted, and which beats having no region at all.
        return fallback

    print(f"Failing to find teryt code for: '{city}' '{code}'")
    return ""


#: How many companies the register names the Treasury as an owner of. Kept as a
#: number because it is the size of what `owner_skarb_panstwa` carries: a run
#: that reports far fewer has lost the sentinel somewhere between
#: `company_from_api_krs` and the payload, and would do it silently.
SKARB_PANSTWA_OWNERS = 110


def company_from_api_krs(  # noqa: PLR0915
    pcs: DataFrame, teryt: Teryt, data: dict, jst: "JstIndex | None" = None
) -> KrsCompany | None:
    try:
        if data.get("title") == "Not Found":
            return None

        odpis = data["odpis"]
        krs = odpis.get("naglowekA").get("numerKRS")
        dane = odpis.get("dane", {})
        dzial1 = dane.get("dzial1", {})
        nazwa = dzial1.get("danePodmiotu", {}).get("nazwa")
        siedziba_i_adres = dzial1.get("siedzibaIAdres", {})
        adres = siedziba_i_adres.get("adres", {})
        siedziba = siedziba_i_adres.get("siedziba", {})
        miejscowosc = adres.get("miejscowosc", "").lower()
        postal_code = adres.get("kodPocztowy")

        activity = []
        if odpis["naglowekA"]["rejestr"] == "RejP":
            activity = parse_activity_from_api_krs(dane.get("dzial3", {}))

        is_public = "organPodmiotZalozycielskiMinisterNadzorujacy" in dzial1

        form = dzial1.get("danePodmiotu", {}).get("formaPrawna")
        # Which organ the register itself names, as opposed to the one the
        # legal form implies. See `scrapers.krs.organs`: it is the finer
        # answer, and the one /eksploruj/szpitale reports, but it is not the
        # one anything decides pay on - "brak" is the register listing no
        # organ, which for an SPZOZ is the usual case rather than evidence of
        # a paid board. `entities.company_bodies` still rules on that, off
        # `form`.
        supervisory_organ = supervision_kind(dane.get("dzial2", {}))

        # `siedziba` is the register's own answer to which województwo,
        # powiat and gmina this company is in - three names rather than a code,
        # but three names the postal code table never has to be guessed from.
        teryt_code = get_teryt(
            pcs,
            miejscowosc,
            postal_code,
            fallback=teryt.parse_siedziba(
                siedziba.get("wojewodztwo", ""),
                siedziba.get("powiat", ""),
                siedziba.get("gmina", ""),
            ),
        )
        owners: list[Owner] = []

        # Which wojewodztwo the company itself sits in, used only to break a tie
        # between two units of the same name. Read off the register's own
        # `siedziba` rather than the postal-code lookup: those names are clean
        # uppercase nominatives and only 6 of 7,835 crawls have a malformed one.
        seat_wojewodztwo = None
        if jst is not None:
            siedziba = (dzial1.get("siedzibaIAdres") or {}).get("siedziba") or {}
            seat_wojewodztwo = jst.wojewodztwo_code(siedziba.get("wojewodztwo"))

        # Who is listed as wspolnik or jedyny akcjonariusz. A government owner
        # is named and nothing more - the register carries no TERYT code - so
        # the name has to be resolved. This used to take the *company's own*
        # seat and truncate it to the length the prefix implied, which is right
        # only when the owner happens to be the local government where the
        # company sits: Gmina Miasta Gdansk, holding 10.7% of a Gdynia-seated
        # PKP SKM, came out as Gdynia. It also collapsed every co-owner onto one
        # value, so the sixteen gminy that own KRS 0000094136 were one.
        wspolnicy = dzial1.get("wspolnicySpzoo", []) + dzial1.get(
            "jedynyAkcjonariusz", []
        )
        for w in wspolnicy:
            if "nazwa" not in w:
                continue

            resolved = jst.resolve(w["nazwa"], seat_wojewodztwo) if jst else None
            if resolved == SKARB_PANSTWA:
                # The Treasury owns 110 of the companies here, and the site has
                # a place node for it. It is carried as an owner like any other,
                # but through `teryt` holding the sentinel rather than a code -
                # the Treasury is not a territory and must never be given a
                # TERYT, or it would compete with real regions for a company's
                # seat.
                #
                # `CompaniesPayloads` and `uploader.submit_company` split it out
                # of `owner_teryts` into `owner_skarb_panstwa`, and the ingest
                # resolves that to the node. It deliberately does not travel as
                # a KRS number: `findCompanyByKRS` 404s on a sentinel, and one
                # 404 used to abort the whole upload.
                owners.append(Owner(krs=None, teryt=SKARB_PANSTWA))
                is_public = True
                continue
            if resolved == AMBIGUOUS:
                # Two units of the same name in different powiaty and nothing to
                # choose between them. The company is still public - the owner is
                # certainly *a* gmina - but no edge can be drawn to one.
                is_public = True
                continue
            if resolved:
                owners.append(Owner(krs=None, teryt=resolved))
                is_public = True
                continue

            if "krs" in w and "krs" in w["krs"]:
                parent_krs = w["krs"]["krs"]
                if parent_krs and parent_krs != "0000000000":
                    owners.append(Owner(krs=parent_krs, teryt=None))

        identyfikatory = dzial1.get("danePodmiotu", {}).get("identyfikatory", {})
        nip = identyfikatory.get("nip")
        regon = identyfikatory.get("regon")

        return KrsCompany(
            krs=krs,
            name=nazwa,
            city=miejscowosc,
            teryt_code=teryt_code,
            nip=nip,
            regon=regon,
            parents=owners,
            activity=activity,
            form=form,
            is_public=is_public,
            supervisory_organ=supervisory_organ,
        )
    except KeyError as e:
        raise ValueError(
            f"Failed to extract company data from API KRS response: {e}, data: {data}"
        ) from e
    except TypeError as e:
        print(data)
        raise ValueError(f"Wrong data: {data}") from e


def parse_activity_from_api_krs(dzial3: dict) -> list[str]:
    """
    Extracts the list of activities (PKD codes) from the API KRS response.
    """

    def parse_entry(entry: dict) -> str:
        kod_dzial = entry.get("kodDzial", "")
        kod_klasa = entry.get("kodKlasa", "")
        kod_podklasa = entry.get("kodPodklasa", "")
        return f"{kod_dzial}.{kod_klasa}.{kod_podklasa}"

    activities = []
    if "celDzialaniaOrganizacji" in dzial3:
        # We don't handle Stowarzyszenia yet
        # TODO support them
        return []

    pkd_entry = dzial3.get("przedmiotDzialalnosci", [])
    for entry in pkd_entry["przedmiotPrzewazajacejDzialalnosci"]:
        activities.append(parse_entry(entry))
    for entry in pkd_entry.get("przedmiotPozostalejDzialalnosci", []):
        activities.append(parse_entry(entry))
    return activities
