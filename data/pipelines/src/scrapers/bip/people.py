"""Telling a person's oświadczenie majątkowe from the rest of a BIP page.

A BIP rarely puts the name in the file's address (47% of the declarations
found in the 10-22 crawl did, all on one half of the sites and none on the
other), so a link is matched by what a reader sees: its label, the table row or
list item it stands in, the heading above it, and the page's title (see
``scrapers.common.links.LinkContext``). Names are compared as stems on folded
text, so "radnego Jana Kowalskiego" finds Jan Kowalski and "Kowalskiej" finds
Kowalska.

Pure functions; the crawler's people mode (``jobs.bip_crawler.people``) walks
the pages and downloads what these pick.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from dataclasses import dataclass

from entities.util import decode_url
from scrapers.bip.classify import is_document_url
from scrapers.common.links import LinkContext

# On folded text: lower case, ASCII, words separated by single spaces.
DECLARATION = re.compile(r"oswiadcz")
ASSETS = re.compile(r"majatk")
OFFICE = re.compile(
    r"(?:^| )(?:rad[ay]|radn\w*|sejmik\w*|wojt\w*|burmistrz\w*|prezydent\w*|starost\w*|"
    r"zarzad\w*|marszal\w*|kadencj\w*)"
)
#: Sections that never hold declarations but eat a unit's page budget.
NEGATIVE = re.compile(
    r"przetarg|zamowien|ogloszen|nabor|kariera|uchwal|protokol|budzet|podatk|zarzadzeni|"
    r"ochron|odpad|zezwolen|konkurs|petycj|skarg|rodo|dostepnos|kontakt|ankiet|wybor|"
    r"rekrutac|planowan|zagospodarow|inwestycj|dotacj|sprawozdan|interpelac|aktualnosc"
)
#: A declaration-like file that is a blank form or guidance, not anybody's.
BLANK_FORM = re.compile(
    r"wzor|druk|formularz|instrukcj|zasad|informacj|objasnien|rozporzadzen|ustaw"
)
YEAR = re.compile(r"(?<!\d)(20[12]\d)(?!\d)")


def fold(text: object) -> str:
    raw = unicodedata.normalize("NFKD", str(text or "").lower().replace("ł", "l"))
    return re.sub(r"[^a-z0-9]+", " ", raw.encode("ascii", "ignore").decode()).strip()


def url_words(url: str) -> str:
    """A URL's words, decoded and folded."""
    return fold(decode_url(url))


def stem(word: str, *, min_a: int = 5) -> str:
    """Enough of a name to find it declined: Kowalski -> kowalsk, Kowalskiej -> kowalsk.

    A final "a" goes from words of ``min_a`` letters up: five for surnames, so
    Sowa stays "sowa" rather than finding Sowiński; four for first names, so
    Anna finds "Anny" and Ewa stays "ewa".
    """
    word = fold(word).replace(" ", "")
    for ending in ("dzka", "dzki", "ska", "ski", "cka", "cki"):
        if word.endswith(ending):
            return word[:-1]
    if word.endswith("a") and len(word) >= min_a:
        return word[:-1]
    return word


@dataclass(frozen=True)
class Seeker:
    """One person to find on a unit's BIP: a candidacy's key and name stems."""

    key: str
    first: str
    last: str

    @classmethod
    def of(cls, key: str, first_name: str, last_name: str) -> Seeker:
        # A double surname is matched by its longer part; labels drop one now and then.
        parts = [p for p in re.split(r"[-\s]+", last_name or "") if p]
        longest = max(parts, key=len) if parts else ""
        return cls(key, stem(first_name, min_a=4), stem(longest))

    @property
    def name(self) -> tuple[str, str]:
        return self.first, self.last

    def named_in(self, text: str, url: str = "") -> tuple[bool, bool]:
        """(surname, first name too) in folded ``text``; a long surname may run
        into ``url`` with no separator."""
        if not self.last:
            return False, False
        last = _word(self.last).search(text) is not None
        if not last and url and len(self.last) >= 6:
            last = self.last in url.replace(" ", "")
        if not last:
            return False, False
        first = bool(self.first) and (
            _word(self.first).search(text) is not None
            or (
                bool(url)
                and len(self.first) >= 4
                and self.first in url.replace(" ", "")
            )
        )
        return True, first


#: What may follow a name's stem in Polish, folded: Kowalsk-i/-iego/-iemu,
#: Nowak-a/-iem, Ann-a/-y/-ie. Nothing longer, so "Nowak" does not find
#: "Nowakowski" and "Jan" does not find "Janina".
_ENDINGS = (
    "",
    "a",
    "e",
    "i",
    "o",
    "u",
    "y",
    "em",
    "ie",
    "im",
    "om",
    "ow",
    "ej",
    "ego",
    "emu",
    "owi",
    "owie",
    "ach",
    "ami",
    "iego",
    "iej",
    "iemu",
    "ich",
    "imi",
    "owa",
    "owej",
)


@functools.cache
def _word(stem_: str) -> re.Pattern[str]:
    endings = "|".join(sorted(_ENDINGS, key=len, reverse=True))
    return re.compile(r"(?:^| )" + re.escape(stem_) + r"(?:" + endings + r")(?= |$)")


#: Words that start with a capital in a BIP label without being anybody's name.
_NOT_NAMES = frozenset(
    fold(w)
    for w in """oświadczenie oświadczenia majątkowe majątkowy majątkowego radny radnego
    radnej radnych rada rady gminy gmina miasta miasto powiatu powiat województwa
    sejmiku sejmik wójt wójta burmistrz burmistrza prezydent prezydenta starosta
    starosty zastępca zastępcy sekretarz sekretarza skarbnik skarbnika kierownik
    kierownika dyrektor dyrektora przewodniczący przewodniczącego urząd urzędu
    miejski miejskiej gminny gminnego powiatowy powiatowego korekta korekty pobierz
    plik pliki rok roku stan stanu dzień początek koniec kadencji kadencja
    uzupełnienie załącznik pan pani członek członka zarządu zarząd biuletyn
    informacji publicznej bip pdf doc docx""".split()
)
_TOKEN = re.compile(r"[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+(?:-[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)?")


def names_somebody(text: str, *, initials_only: bool = False) -> bool:
    """Whether raw (unfolded) ``text`` holds what looks like a person's name: an
    initial and a capitalised word ("B. Kułacz"), or two capitalised words in a
    row, none of them the vocabulary of a declarations page.

    ``initials_only`` takes the first form alone, for a page title: titles carry
    office and place names too ("Rada Miejska Chojnowa").
    """
    text = text or ""
    previous = False
    for match in _TOKEN.finditer(text):
        token = match.group()
        initial = len(token) == 1 and token.isupper() and text[match.end() :][:1] == "."
        name_like = (
            token[0].isupper() and len(token) > 1 and fold(token) not in _NOT_NAMES
        )
        if name_like and previous:
            return True
        previous = initial or (name_like and not initials_only)
    return False


def link_score(link: LinkContext, seekers: list[Seeker], depth: int) -> float:
    """How likely following a page link leads to the unit's declarations."""
    text = fold(link.anchor) + " " + url_words(link.url)
    score = 0.0
    if DECLARATION.search(text) and ASSETS.search(text):
        score += 10
    elif DECLARATION.search(text) or ASSETS.search(text):
        score += 4
    if OFFICE.search(text):
        score += 2
    if any(s.named_in(text)[0] for s in seekers):
        score += 3
    years = [int(y) for y in YEAR.findall(text)]
    if years and max(years) >= 2018:
        score += 1
    if NEGATIVE.search(text):
        score -= 4
    return score - 0.5 * depth


@dataclass(frozen=True)
class Candidate:
    """A document link one seeker might be named in (``key`` "" when nobody is)."""

    key: str
    url: str
    anchor: str
    context: str
    page_url: str
    declaration_like: bool
    first_name: bool
    score: float


def _years(text: str) -> list[int]:
    return [int(y) for y in YEAR.findall(text)]


_ID_QUERY = re.compile(r"[?&](?:id|zid|iddok|idplik)=[^&#]*", re.I)


def is_file_link(url: str) -> bool:
    """A link to a document, when more than an ``?id=`` query says so.

    ``is_document_url`` takes any ``?id=`` for a file, and on a CMS of
    ``index.php?id=N`` pages that makes every menu link one.
    """
    return is_document_url(url) and is_document_url(_ID_QUERY.sub("", url))


def _named(text: str, url: str, seekers: list[Seeker]) -> list[tuple[Seeker, bool]]:
    found = [(s, *s.named_in(text, url)) for s in seekers]
    return [(s, first) for s, last, first in found if last]


def candidates(
    page_url: str, page_title: str, links: list[LinkContext], seekers: list[Seeker]
) -> list[Candidate]:
    """Document links on one page that name one of the seekers, or that name nobody.

    A link names whoever its label (or address) names; failing that, its row or
    list item; failing that, the heading over it; failing that, the page's title
    (a page about one person, "Jan Kowalski - oświadczenia majątkowe", lends that
    person its documents). A tier that names somebody who is not a seeker ends
    the search: the link is theirs, not anybody's from a wider tier. Documents
    on a declarations page that name nobody at all (one file for the whole
    council, or labels like "za 2023") come back with an empty ``key``.
    """
    title = fold(page_title)
    title_names = {s.name for s in seekers if s.named_in(title)[0]}
    page_people = (
        [s for s in seekers if s.name in title_names] if len(title_names) == 1 else []
    )
    page_declarations = bool(DECLARATION.search(title) or ASSETS.search(title))
    # A page about one person nobody seeks ("... - B. Kułacz - Stan majątkowy na
    # 31.12.2025 r."): its files are theirs, whatever the labels say.
    title_somebody = not title_names and names_somebody(page_title, initials_only=True)
    out: list[Candidate] = []
    for link in links:
        if not is_document_url(link.url):
            continue
        address = url_words(link.url)
        label = fold(link.anchor) + " " + address
        if BLANK_FORM.search(label):
            continue
        around = " ".join(fold(x) for x in (link.anchor, link.row, link.heading))
        around += " " + address
        named: list[tuple[Seeker, bool]] = []
        somebody_else = False
        for text, raw, url in (
            (label, link.anchor, address),
            (fold(link.row), link.row, ""),
            (fold(link.heading), link.heading, ""),
        ):
            named = _named(text, url, seekers)
            if named:
                break
            if names_somebody(raw):
                somebody_else = True
                break
        if not named and not somebody_else and page_people:
            named = [(s, s.named_in(title)[1]) for s in page_people]
        declaration_like = bool(
            DECLARATION.search(around) or ASSETS.search(around) or page_declarations
        )
        years = _years(around)
        base: float = (3 if declaration_like else 0) + (
            1 if ".pdf" in link.url.lower() else 0
        )
        if years:
            base += 1.5 if max(years) >= 2024 else 1 if max(years) >= 2019 else 0
        context = " | ".join(x for x in (link.row, link.heading) if x)[:400]
        for seeker, first in named:
            out.append(
                Candidate(
                    seeker.key,
                    link.url,
                    link.anchor,
                    context,
                    page_url,
                    declaration_like,
                    first,
                    base + (2 if first else 0),
                )
            )
        unnamed = (
            not named
            and not somebody_else
            and not title_somebody
            and page_declarations
            and bool(ASSETS.search(around) or ASSETS.search(title))
            and is_file_link(link.url)
        )
        if unnamed:
            out.append(
                Candidate(
                    "", link.url, link.anchor, context, page_url, True, False, base
                )
            )
    return out


def choose(
    found: list[Candidate], seekers: list[Seeker], per_person: int, unnamed_cap: int
) -> dict[str, list[Candidate]]:
    """What to download for each seeker.

    Declaration-like links only. When some of a seeker's links carry their first
    name too, only those: a namesake's or a relative's form shares the surname.
    Seekers nothing names get the unit's unnamed declaration files, at most
    ``unnamed_cap`` of them, for the OCR step to look inside.
    """
    picked: dict[str, list[Candidate]] = {}
    for seeker in seekers:
        own = [c for c in found if c.key == seeker.key and c.declaration_like]
        firsts = [c for c in own if c.first_name]
        ranked = sorted(firsts or own, key=lambda c: -c.score)
        urls: list[Candidate] = []
        for c in ranked:
            if c.url not in {u.url for u in urls}:
                urls.append(c)
            if len(urls) >= per_person:
                break
        if urls:
            picked[seeker.key] = urls
    unnamed = sorted(
        {c.url: c for c in found if c.key == "" and c.declaration_like}.values(),
        key=lambda c: -c.score,
    )
    if unnamed and unnamed_cap > 0:
        for seeker in seekers:
            if seeker.key not in picked:
                picked[seeker.key] = [
                    Candidate(
                        seeker.key,
                        c.url,
                        c.anchor,
                        c.context,
                        c.page_url,
                        True,
                        False,
                        c.score,
                    )
                    for c in unnamed[:unnamed_cap]
                ]
    return picked


def satisfied(found: list[Candidate], seekers: list[Seeker], per_person: int) -> bool:
    """Every seeker has ``per_person`` declaration-like links with their first name."""
    counts: dict[str, set[str]] = {}
    for c in found:
        if c.declaration_like and c.first_name:
            counts.setdefault(c.key, set()).add(c.url)
    return all(len(counts.get(s.key, ())) >= per_person for s in seekers)
