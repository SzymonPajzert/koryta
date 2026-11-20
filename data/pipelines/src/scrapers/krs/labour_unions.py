"""Trade unions in KRS, and the public company each one belongs to.

A seat in a union's zarząd or komisja rewizyjna at the company a person also
sits on the board of reads as an employee: the staff elect members of a
supervisory board, and the unions put those people up. Such a person is a
weak candidate for the queue (decision on 2026-11-20). A union somewhere
else - KADRA's leaders on hospital boards, Centrum Narodowe Młodych Rolników
on municipal ones - is the opposite, and is not penalised.

Unions are registered in register S under the legal form "ZWIĄZEK ZAWODOWY",
and a company's union usually names it: "ZWIĄZEK ZAWODOWY PRACOWNIKÓW
TECHNICZNYCH I ADMINISTRACJI "DOZÓR" "ENERGETYKA" SPÓŁKA Z O.O. W LUBINIE".
`jobs.krs_unions` lists them through the register's name search into
`SEARCH_LOG` - 9,184 on 2026-11-20 - and `LabourUnions` adds the unions the
crawl already met and ties each to the public company its name names: 1,371
of them. Only those are read further. `ScrapeRejestrIO` asks for their
register entries for free, which is what lets `CompaniesKRS` know them, and
`koryta_krs_odpis --labour-unions` fetches the odpis pełny that names their
boards for `PeopleKRSCombined`.
"""

import dataclasses
import gzip
import json
import re
import typing
from collections.abc import Iterable, Mapping

import pandas as pd

from scrapers.krs.columns import is_public
from scrapers.krs.list import CompaniesKRS
from scrapers.map.jst import normalise
from scrapers.stores import CloudStorage, Context, Pipeline

#: Where `jobs.krs_unions` writes what the name search found: gzipped jsonl
#: parts of `UnionHit`, one per run, never rewritten.
SEARCH_LOG = CloudStorage(
    prefix="jobs/krs_unions/search/",
    bucket="koryta-pl-sharedcache",
    binary=True,
)

#: What a union's name or legal form says, without diacritics. The form is
#: "ZWIĄZEK ZAWODOWY" for nearly all; federations and the national
#: confederations have others.
_UNION_MARKERS = (
    "ZWIAZEK ZAWODOWY",
    "ZWIAZKU ZAWODOWEGO",
    "ZWIAZKOW ZAWODOWYCH",
    "ZWIAZEK MIEDZYBRANZOWY",
    "NSZZ",
)


def is_labour_union(name: typing.Any, form: typing.Any = None) -> bool:
    for value in (form, name):
        if isinstance(value, str) and value:
            text = normalise(value)
            if any(marker in text for marker in _UNION_MARKERS):
                return True
    return False


@dataclasses.dataclass
class UnionHit:
    """One union the register's name search returned."""

    krs: str
    name: str
    city: str
    #: The day the search was run, so the newest of two hits wins.
    searched: str
    #: The filter that found it, for reading a run's coverage back.
    query: str = ""

    def to_line(self) -> str:
        return json.dumps(dataclasses.asdict(self), ensure_ascii=False)

    @classmethod
    def from_line(cls, line: str) -> "UnionHit":
        data = json.loads(line)
        known = {f.name for f in dataclasses.fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


def read_search_log(ctx: Context) -> typing.Iterator[UnionHit]:
    for ref in ctx.io.list_files(SEARCH_LOG):
        raw = ctx.io.read_data(ref).read_bytes()
        for line in gzip.decompress(raw).decode("utf-8").split("\n"):
            if line.strip():
                yield UnionHit.from_line(line)


# --- Matching a union's name to a company's -------------------------------

#: Words that say what kind of entity a company is, not which one.
_LEGAL_FORM = re.compile(
    r"\b(SPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA|SPOLKA AKCYJNA|SPOLKA KOMANDYTOWA"
    r"|SP Z O O|SP ZOO|S A|W LIKWIDACJI|W UPADLOSCI|SPOLKA)\b"
)
#: Skipped on both sides when comparing word sequences.
_STOPWORDS = frozenset(
    {"I", "W", "Z", "ZE", "NA", "DO", "OD", "IM", "IMIENIA", "PRZY", "ORAZ"}
)


def _words(text: str) -> list[str]:
    plain = re.sub(r"[^A-Z0-9]+", " ", normalise(text))
    plain = _LEGAL_FORM.sub(" ", plain)
    return plain.split()


def _significant(words: Iterable[str]) -> list[str]:
    return [w for w in words if w not in _STOPWORDS]


def _stem(word: str) -> str:
    """Enough of a word to survive Polish declension.

    A union names its company in the genitive or locative - PRZEDSIĘBIORSTWA
    for PRZEDSIĘBIORSTWO, MIEJSKIEGO for MIEJSKIE - so a company word matches
    a union word starting with all but its last three letters (`_declined`).
    """
    return word if len(word) <= 4 else word[: max(4, len(word) - 3)]


def _declined(union_word: str, company_word: str) -> bool:
    """Whether the union's word can be the company's in another case.

    The same start is not enough: KOLEJARZY starts like KOLEJE and is
    another word. An ending adds at most two letters - MIEJSKIE, MIEJSKIEGO -
    or three for a locative in -IE or a genitive in -EGO: ZAKŁAD, ZAKŁADZIE;
    MIEJSKI, MIEJSKIEGO.
    """
    if not union_word.startswith(_stem(company_word)):
        return False
    extra = len(union_word) - len(company_word)
    return -2 <= extra <= 2 or (extra == 3 and union_word.endswith(("IE", "EGO")))


def _contains_in_order(
    union: typing.Sequence[str], company: typing.Sequence[str], exact: bool
) -> bool:
    if not company or len(company) > len(union):
        return False
    for start in range(len(union) - len(company) + 1):
        if all(
            union[start + i] == word if exact else _declined(union[start + i], word)
            for i, word in enumerate(company)
        ):
            return True
    return False


#: How a healthcare unit ends its name whatever it is called: a tail that
#: every hospital in a town shares.
_HEALTHCARE_FORM = re.compile(
    r"\b(SAMODZIELNY |NIE)?PUBLICZNY (SPECJALISTYCZNY )?(ZAKLAD|ZESPOL ZAKLADOW|ZESPOL)"
    r" OPIEKI ZDROWOTNEJ\b"
)


def _before_town(words: list[str]) -> tuple[str, ...]:
    """The name without where it is - what comes before its first W - nor
    its healthcare form."""
    for i, word in enumerate(words):
        if word in ("W", "WE") and i > 0:
            words = words[:i]
            break
    return tuple(_significant(_HEALTHCARE_FORM.sub(" ", " ".join(words)).split()))


def _longest_tail(union: list[str], head: tuple[str, ...]) -> int:
    """How many of the name's last words the union names, in order.

    A company renamed into a group keeps its old name at the end: the unions
    of GRUPA AZOTY ZAKŁADY AZOTOWE "PUŁAWY" were registered as unions of
    ZAKŁADY AZOTOWE "PUŁAWY". The town is not part of it, or "W M. ST.
    WARSZAWIE" would be three words every union in Warsaw can name.
    """
    for size in range(len(head) - 1, 1, -1):
        if _contains_in_order(union, head[-size:], exact=False):
            return size
    return 0


#: The part of a name in quotes: "REMASZ" in KOMPANIJNE ZAKŁADY REMONTOWE
#: "REMASZ", the name a union is likeliest to use on its own.
_QUOTED = re.compile(
    r'["\u201c\u201d\u201e]([^"\u201c\u201d\u201e]+)["\u201c\u201d\u201e]'
)


def _brands(name: str) -> list[tuple[str, ...]]:
    return [
        tuple(words)
        for quoted in _QUOTED.findall(name)
        if (words := _significant(_words(quoted))) and len("".join(words)) >= 4
    ]


def _quoted_employers(union_name: str) -> set[tuple[str, ...]]:
    """What a union puts in quotes, but for its own name.

    'PRZY "REMASZ"' names a company; 'ZWIĄZEK ZAWODOWY "KADRA"' and
    'ZWIĄZEK ZAWODOWY "BAŁUTY"' name the union, right after ZAWODOWY.
    """
    text = normalise(union_name)
    found = set()
    for match in _QUOTED.finditer(text):
        before = _words(text[: match.start()])
        if before and before[-1] in ("ZAWODOWY", "ZAWODOWE", "ZAWODOWYCH"):
            continue
        if words := _significant(_words(match.group(1))):
            found.add(tuple(words))
    return found


def _acronyms(words: list[str]) -> set[str]:
    """MPWIK for "MIEJSKIE PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI".

    Read from the words before the first W, which is where a name says its
    town, with and without the conjunctions.
    """
    if "W" in words:
        words = words[: words.index("W")]
    if len(_significant(words)) < 3:
        return set()
    return {
        "".join(w[0] for w in words),
        "".join(w[0] for w in _significant(words)),
    }


def _abbreviations(union: list[str], town: str) -> set[str]:
    """The union's words that can stand for a whole name: last, or before W
    or the town. "PRZY MPWIK SP. Z O.O. W LUBINIE" names a company by its
    initials; "PGE ENERGIA CIEPŁA" is a name that starts with three letters,
    and they are not PORT GDAŃSKI EKSPLOATACJA's.
    """
    town_stem = _stem(town.split(maxsplit=1)[0]) if town else ""
    found = set()
    for i, word in enumerate(union):
        after = union[i + 1] if i + 1 < len(union) else None
        if after is None or after == "W" or (town_stem and after.startswith(town_stem)):
            found.add(word)
    return found


def _town(value: typing.Any) -> str:
    """A seat as both sides can compare it: the search writes "M. WROCŁAW"
    where `CompaniesKRS` has "Wrocław"."""
    if not isinstance(value, str):
        return ""
    town = re.sub(r"^(M\.?\s*ST\.?\s+|M\.\s*)", "", normalise(value))
    return re.sub(r"\s*-\s*", "-", town)


@dataclasses.dataclass(frozen=True)
class Employer:
    krs: str
    name: str
    city: str
    #: Owned by the state rather than a gmina, powiat or województwo - see
    #: `state_owned`. Only these have unions in other towns.
    national: bool = False


@dataclasses.dataclass(frozen=True)
class Match:
    employer: Employer
    #: "name" - a state company's name, in any town; "city" - a name in the
    #: union's town; "tail" - its last words, "brand" - its part in quotes,
    #: "acronym" - MPWIK and the like, each in the union's town.
    how: str
    #: Words matched, so the most specific of two matches wins.
    words: int

    #: Between two matches of as many words, the whole name over a part of it.
    STRENGTH = {"name": 4, "city": 4, "tail": 3, "brand": 2, "acronym": 1}

    def rank(self) -> tuple[int, int]:
        return self.words, self.STRENGTH[self.how]


@dataclasses.dataclass(frozen=True)
class _Entry:
    employer: Employer
    #: The name's words without the conjunctions, as matched.
    core: tuple[str, ...]
    town: str
    #: Nobody else in the register has this name - see `EmployerIndex.unique`.
    unique: bool
    #: The name before its town - see `_before_town`.
    head: tuple[str, ...] = ()
    brands: tuple[tuple[str, ...], ...] = ()


class EmployerIndex:
    """The public companies, ready to be found in a union's name.

    Filed under the first letters of each of their words, so a union is
    compared with the companies that share a word with it rather than with
    all of them: 9,184 unions against ~6,000 public companies one by one is
    minutes, this is seconds.
    """

    #: Letters of a first word a company is filed under.
    KEY = 4

    def __init__(self, employers: Iterable[Employer], all_names: Iterable[str] = ()):
        counts: dict[tuple[str, ...], int] = {}
        for name in all_names:
            core = tuple(_significant(_words(name)))
            counts[core] = counts.get(core, 0) + 1
        self.by_start: dict[str, list[_Entry]] = {}
        self.by_acronym: dict[str, list[_Entry]] = {}
        for employer in employers:
            words = _words(employer.name)
            core = tuple(_significant(words))
            if not core:
                continue
            entry = _Entry(
                employer,
                core,
                _town(employer.city),
                self.unique(core, counts.get(core, 1)),
                _before_town(words),
                tuple(_brands(normalise(employer.name))),
            )
            for word in set(core):
                self.by_start.setdefault(_stem(word)[: self.KEY], []).append(entry)
            for acronym in _acronyms(words):
                self.by_acronym.setdefault(acronym, []).append(entry)

    @staticmethod
    def unique(core: tuple[str, ...], companies_named: int) -> bool:
        """A name nobody else in the register has, and long enough to mean it.

        "KGHM POLSKA MIEDŹ" is found in a union's name wherever the union
        sits; "ZAKŁAD GOSPODARKI KOMUNALNEJ" only in its own town.
        """
        return len(core) >= 2 and len(" ".join(core)) >= 10 and companies_named <= 1

    def candidates(self, union: list[str]) -> set[_Entry]:
        found: set[_Entry] = set()
        for word in union:
            for length in range(1, self.KEY + 1):
                found.update(self.by_start.get(word[:length], ()))
        return found

    def employers(self, union_name: str, union_city: str = "") -> list[Match]:
        """The public companies the union's name names, the most specific.

        In the union's own town any company is found by its name. Elsewhere
        only a state company is, and only by a name no other company has:
        Poczta Polska's 97 unions are all over the country, while the 66
        unions of a ZAKŁAD OPIEKI ZDROWOTNEJ elsewhere are not the one in
        Chełm Śląski. Initials are read only where no name is found.
        """
        raw = _words(union_name)
        union = _significant(raw)
        city = _town(union_city)
        quoted = _quoted_employers(union_name)
        found: list[Match] = []
        for entry in self.candidates(union):
            same_town = bool(city) and entry.town == city
            # A one-word name - ENERGETYKA, TERMAL - is matched whole, or
            # ENERGETYKÓW would find every ENERGETYKA in the country.
            if _contains_in_order(union, entry.core, exact=len(entry.core) == 1):
                if same_town:
                    found.append(Match(entry.employer, "city", len(entry.core)))
                elif entry.unique and entry.employer.national:
                    found.append(Match(entry.employer, "name", len(entry.core)))
                continue
            if not same_town:
                continue
            # Three words of the end at least: two would take a union of
            # PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ for one of the ZAKŁAD
            # GOSPODARKI KOMUNALNEJ in the same town.
            if (tail := _longest_tail(union, entry.head)) >= 3:
                found.append(Match(entry.employer, "tail", tail))
            for brand in entry.brands:
                # A quoted name that is the town's own says nothing:
                # "PUŁAWY" in Puławy.
                if brand in quoted and " ".join(brand) != city:
                    found.append(Match(entry.employer, "brand", len(brand)))
        if city and not found:
            for word in _abbreviations(raw, city):
                for entry in self.by_acronym.get(word, ()):
                    if entry.town == city:
                        found.append(Match(entry.employer, "acronym", len(entry.core)))
        if not found:
            return []
        top = max(m.rank() for m in found)
        best = sorted(
            {m for m in found if m.rank() == top}, key=lambda m: m.employer.krs
        )
        # Two companies of one name are one company twice - a struck-off
        # entry beside its successor. More, or a part of a name that two
        # names share, is a name too common to say which: the ten Warsaw
        # hospitals whose names end in SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI
        # ZDROWOTNEJ.
        names = {m.employer.name for m in best}
        if len(best) > 2 or (
            best[0].how in ("tail", "brand", "acronym") and len(names) > 1
        ):
            return []
        return best


def ancestors(krs: str, parents: Mapping[str, Iterable[str]]) -> set[str]:
    """The company and every company above it."""
    top = {krs}
    frontier = [krs]
    while frontier:
        current = frontier.pop()
        for parent in parents.get(current, ()):
            if parent not in top:
                top.add(parent)
                frontier.append(parent)
    return top


#: Owners whose companies have nothing in common but the owner: ARP, PFR, a
#: regional development agency or fund.
_HOLDING_WORDS = ("AGENCJA", "FUNDUSZ", "TOWARZYSTWO FINANSOWE", "TOWARZYSTWO FUNDUSZY")


def is_holding(name: typing.Any) -> bool:
    return isinstance(name, str) and any(w in normalise(name) for w in _HOLDING_WORDS)


def corporate_group(
    krs: str,
    parents: Mapping[str, Iterable[str]],
    children: Mapping[str, Iterable[str]],
    holdings: typing.Container[str] = frozenset(),
) -> set[str]:
    """The company, its owner, and everything either of them owns.

    Energetyka sp. z o.o. (0000012900) is owned by KGHM, and so are the INVEST
    PV companies a man from Energetyka's union went on to the boards of: one
    employer, as far as the person is concerned.

    One level up and no further, not into a holding (`is_holding`), and not
    from a company with several owners: a joint venture of PGE, ENEA and
    TAURON would make all three groups one employer.
    """
    owners = list(dict.fromkeys(parents.get(krs, ())))
    top = owners[0] if len(owners) == 1 and owners[0] not in holdings else krs
    group = {krs, top}
    frontier = list(group)
    while frontier:
        current = frontier.pop()
        for child in children.get(current, ()):
            if child not in group:
                group.add(child)
                frontier.append(child)
    return group


# --- The pipeline -----------------------------------------------------------


@dataclasses.dataclass
class LabourUnion:
    krs: str
    name: str
    city: str
    #: Where the union is known from: "search", "crawl" or both.
    source: str
    employer_krs: str | None = None
    employer_name: str | None = None
    match: str | None = None
    #: Every KRS of the employer's corporate group - see `corporate_group`.
    employer_group: list[str] = dataclasses.field(default_factory=list)


COLUMNS = [f.name for f in dataclasses.fields(LabourUnion)]


def _krs_list(value: typing.Any) -> list[str]:
    if value is None or isinstance(value, (float, str)):
        return []
    out = []
    for item in value:
        if isinstance(item, dict):
            item = item.get("krs")
        if item:
            out.append(str(item).zfill(10))
    return out


#: The lists of state companies `CompaniesKRS` names as a company's source.
_STATE_LISTS = frozenset(
    {"SPOLKI_SKARBU_PANSTWA", "PROKURATORIA_SPOLKI_SKARBU_PANSTWA"}
)


def state_owned(company: Mapping[str, typing.Any]) -> bool:
    """The Treasury or a ministry owns it, by `CompaniesKRS`'s own record.

    A Treasury share, a ministry's or Prokuratoria's list, or the Treasury
    as the owner - and not a gmina's, powiat's or województwo's TERYT code,
    which is what a local company's owner carries.
    """
    share = company.get("treasury_share")
    if (
        share is not None
        and not (isinstance(share, float) and pd.isna(share))
        and share != ""
    ):
        return True
    for source in _dicts(company.get("sources")):
        reason = str(source.get("reason") or "")
        if reason in _STATE_LISTS or reason.startswith("MINISTERSTWO_"):
            return True
    return any(
        owner.get("teryt") == "SKARB PANSTWA"
        for owner in _dicts(company.get("parents"))
    )


def _dicts(value: typing.Any) -> list[dict]:
    """The dicts of a list column, as jsonl or parquet gives it back."""
    if value is None or isinstance(value, (float, str, dict)):
        return []
    return [item for item in value if isinstance(item, dict)]


class LabourUnions(Pipeline[LabourUnion]):
    """Every union known, one row per public employer its name names.

    A union naming no public company has one row with no employer: it is
    known, and nothing here is read from its board.
    """

    filename = "labour_unions"
    dtype = {"krs": str, "employer_krs": str}

    companies: CompaniesKRS

    @property
    def output_class(self):
        return LabourUnion

    def process(self, ctx: Context) -> pd.DataFrame:
        companies = self.companies.read_or_process(ctx)
        unions = self.known_unions(read_search_log(ctx), companies)
        rows = list(self.attach(unions, companies))
        df = pd.DataFrame([dataclasses.asdict(r) for r in rows], columns=COLUMNS)
        attached = df.dropna(subset=["employer_krs"])
        print(
            f"Labour unions: {df['krs'].nunique()} known, "
            f"{attached['krs'].nunique()} tied to {attached['employer_krs'].nunique()} "
            f"public companies {attached['match'].value_counts().to_dict()}"
        )
        return df

    @staticmethod
    def known_unions(
        hits: Iterable[UnionHit], companies: pd.DataFrame
    ) -> dict[str, dict]:
        unions: dict[str, dict] = {}
        for hit in sorted(hits, key=lambda h: h.searched):
            unions[hit.krs.zfill(10)] = {
                "name": hit.name,
                "city": hit.city,
                "source": "search",
            }
        for row in companies.to_dict("records"):
            if not is_labour_union(row.get("name"), row.get("form")):
                continue
            krs = str(row["krs"]).zfill(10)
            if krs in unions:
                unions[krs]["source"] = "both"
            else:
                unions[krs] = {
                    "name": row.get("name") or "",
                    "city": row.get("city") or "",
                    "source": "crawl",
                }
        return unions

    @staticmethod
    def attach(
        unions: Mapping[str, dict], companies: pd.DataFrame
    ) -> typing.Iterator[LabourUnion]:
        if "is_public" in companies:
            companies = companies.assign(is_public=is_public(companies["is_public"]))
        records = companies.to_dict("records")
        parents = {
            str(r["krs"]).zfill(10): _krs_list(r.get("parents")) for r in records
        }
        children = {
            str(r["krs"]).zfill(10): _krs_list(r.get("children")) for r in records
        }
        state = {str(r["krs"]).zfill(10) for r in records if state_owned(r)}
        holdings = {
            str(r["krs"]).zfill(10) for r in records if is_holding(r.get("name"))
        }
        public = [
            Employer(
                str(r["krs"]).zfill(10),
                str(r.get("name") or ""),
                str(r.get("city") or ""),
                national=bool(ancestors(str(r["krs"]).zfill(10), parents) & state),
            )
            for r in records
            if r.get("is_public") is True
            and not is_labour_union(r.get("name"), r.get("form"))
        ]
        index = EmployerIndex(public, (str(r.get("name") or "") for r in records))
        for krs, union in sorted(unions.items()):
            matches = index.employers(union["name"], union["city"])
            if not matches:
                yield LabourUnion(krs=krs, **union)
            for m in matches:
                yield LabourUnion(
                    krs=krs,
                    **union,
                    employer_krs=m.employer.krs,
                    employer_name=m.employer.name,
                    match=m.how,
                    employer_group=sorted(
                        corporate_group(m.employer.krs, parents, children, holdings)
                    ),
                )


def attached_unions(unions: pd.DataFrame) -> list[str]:
    """The KRS of every union tied to a public company, each once, in order."""
    if unions is None or unions.empty or "employer_krs" not in unions:
        return []
    tied = unions[unions["employer_krs"].map(lambda v: isinstance(v, str) and v != "")]
    return list(dict.fromkeys(tied["krs"].astype(str).str.zfill(10)))


def union_groups(unions: pd.DataFrame) -> dict[str, frozenset[str]]:
    """Union KRS -> every company of the employers it belongs to."""
    groups: dict[str, set[str]] = {}
    if unions is None or unions.empty:
        return {}
    for row in unions.to_dict("records"):
        employer = row.get("employer_krs")
        if not isinstance(employer, str) or not employer:
            continue
        krs = str(row["krs"]).zfill(10)
        groups.setdefault(krs, set()).update(
            _krs_list(row.get("employer_group")) or [employer]
        )
    return {krs: frozenset(group) for krs, group in groups.items()}
