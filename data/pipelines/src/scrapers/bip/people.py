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
from collections.abc import Iterable
from dataclasses import dataclass

from entities.util import decode_url
from scrapers.bip.classify import host_of, is_document_url, normalize_url, path_of
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
#: A declaration-like file that is a blank form or guidance, not anybody's;
#: or nobody's asset declaration: a GDPR clause for those who file them, a
#: lustration or de minimis statement, the site's easy-to-read and
#: accessibility texts, which a page titled with a seeker lent them (10-31).
BLANK_FORM = re.compile(
    r"wzor|druk|formularz|instrukcj|zasad|informacj|objasnien|rozporzadzen|ustaw|"
    r"klauzul|przetwarzan\w* danych|lustrac|de minimis|pomoc\w* publiczn|"
    r"konflikt\w* interes|latw\w* do czytania|dostepnosc|cookie|polityk\w* prywatn"
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
    """One person to find on a unit's BIP: a candidacy's key and name stems.

    ``form`` is "m" or "f" for a surname that tells a man's from a woman's
    (Kowalski, Kowalska), "" for one that does not (Nowak, or a man's Gąska,
    a noun). ``own`` holds the stems of the seeker's other given names and of
    the rest of a double surname: beside the surname they are nobody else's.
    """

    key: str
    first: str
    last: str
    form: str = ""
    own: tuple[str, ...] = ()

    @classmethod
    def of(
        cls, key: str, first_name: str, last_name: str, middle_name: str = ""
    ) -> Seeker:
        # A double surname is matched by its longer part; labels drop one now and then.
        parts = [p for p in re.split(r"[-\s]+", last_name or "") if p]
        longest = max(parts, key=len) if parts else ""
        folded = fold(longest)
        form = (
            "m"
            if folded.endswith(("ski", "cki", "dzki"))
            else "f"
            if folded.endswith(("ska", "cka", "dzka"))
            and fold(first_name).endswith("a")
            else ""
        )
        middles = [w for w in re.split(r"[-\s]+", middle_name or "") if w]
        own = tuple(stem(w, min_a=4) for w in middles) + tuple(
            stem(p) for p in parts if p is not longest
        )
        return cls(key, stem(first_name, min_a=4), stem(longest), form, own)

    @property
    def name(self) -> tuple[str, str]:
        return self.first, self.last

    def named_in(
        self, text: str, url: str = "", first_names: frozenset[str] = frozenset()
    ) -> tuple[bool, bool]:
        """(surname, first name too) in folded ``text``; a long surname may run
        into ``url`` with no separator, a first name too (`_in_address`)."""
        if not self.last:
            return False, False
        last = _word(self.last).search(text) is not None
        if not last and url and len(self.last) >= 6:
            last = self.last in url.replace(" ", "")
        if not last:
            return False, False
        first = bool(self.first) and (
            any(_word(form).search(text) for form in _first_forms(self.first))
            or (
                bool(url)
                and len(self.first) >= 4
                and _in_address(self.first, self.last, url, first_names)
            )
        )
        return True, first


@functools.cache
def _first_forms(first: str) -> tuple[str, ...]:
    """A first name's stem and the stems its declension needs besides: Marek's
    "Marka", Paweł's "Pawła" lose the e; Ewa's "Ewy" the a of a short name."""
    forms = [first]
    if len(first) >= 4 and first.endswith(("ek", "el")):
        forms.append(first[:-2] + first[-1])
    if len(first) == 3 and first.endswith("a"):
        forms.append(first[:-1])
    return tuple(forms)


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
    informacji publicznej bip pdf doc docx radni kierownicy pracownicy dyrektorzy
    członkowie""".split()
)
_TOKEN = re.compile(r"[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+(?:-[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)?")
#: Words an initial follows in an address or a patron's name, not a person's:
#: "ul. J. Słowackiego", "Szkoła Podstawowa im. M. Konopnickiej".
_BEFORE_A_NAMESAKE = frozenset("ul al pl os im ks sw gen prof dr nr".split())


def initialled_names(text: str) -> list[tuple[str, str]]:
    """(initial, name) for each "B. Kułacz" in raw ``text``: not after an address
    or patron's abbreviation, nor in a chain like "S.A." or "M.St."."""
    text = text or ""
    tokens = list(_TOKEN.finditer(text))
    found = []
    for i, match in enumerate(tokens[:-1]):
        token, after = match.group(), tokens[i + 1]
        word = after.group()
        if not (
            len(token) == 1
            and token.isupper()
            and re.fullmatch(r"\.\s*", text[match.end() : after.start()])
        ):
            continue
        if i and fold(tokens[i - 1].group()) in _BEFORE_A_NAMESAKE:
            continue
        if len(word) < 2 or not word[0].isupper() or fold(word) in _NOT_NAMES:
            continue
        if len(word) <= 3 and text[after.end() :][:1] == ".":
            continue  # "M.St.", "S.A."
        found.append((token, word))
    return found


def names_somebody(
    text: str, *, initials_only: bool = False, initials: bool = True
) -> bool:
    """Whether raw (unfolded) ``text`` holds what looks like a person's name: an
    initial and a capitalised word ("B. Kułacz"), or two capitalised words in a
    row, none of them the vocabulary of a declarations page.

    ``initials_only`` takes the first form alone, for a page title: titles carry
    office and place names too ("Rada Miejska Chojnowa"). ``initials=False``
    takes the second alone: on a page about one seeker, "J. Kaczmarka" is the
    seeker in a form ``Seeker.named_in`` misses, not somebody else.
    """
    if initials and initialled_names(text):
        return True
    if initials_only:
        return False
    previous = False
    for match in _TOKEN.finditer(text or ""):
        token = match.group()
        name_like = (
            token[0].isupper() and len(token) > 1 and fold(token) not in _NOT_NAMES
        )
        if name_like and previous:
            return True
        previous = name_like
    return False


def _could_be(seekers: list[Seeker], initial: str, word: str) -> bool:
    """Whether a seeker could be "initial. word": the same first letter, and a
    surname that starts as the word does (declined, Kaczmarek is "Kaczmarka")."""
    first, last = fold(initial), fold(word)
    return any(s.first.startswith(first) and s.last[:4] == last[:4] for s in seekers)


#: What the seekers' own council or office is called, folded, by a candidacy's
#: ``office``. A big BIP files the declarations of its staff, its youth council
#: and, in Warsaw, 18 district councils beside the council's: the 10-29 walk of
#: bip.warszawa.pl read 149 declaration pages and found none of 96 councillors.
_OFFICE_TERMS = {
    "Rada gminy": r"rad\w* gmin\w*|radn\w*",
    "Rada miasta": r"rad\w* miast\w*|rad\w* miejsk\w*|rad\w* m st|radn\w*",
    "Rada powiatu": r"rad\w* powiat\w*|radn\w*",
    "Sejmik": r"sejmik\w*|radn\w* wojewodztw\w*",
    "Rada dzielnicy": r"dzielnic\w*",
    "Wójt": r"wojt\w*",
    "Burmistrz": r"burmistrz\w*",
    "Prezydent": r"prezydent\w*",
}


def office_terms(
    offices: Iterable[str], places: Iterable[str] = ()
) -> re.Pattern[str] | None:
    """The folded words naming the seekers' own councils and offices, or None.

    A district council's seekers want their own district (``places``: unit names
    like "Bemowo (dzielnica)"); anybody else's want no district at all: Warsaw's
    BIP files 18 district councils beside the city's, "radnych Dzielnicy Bemowo"
    as close to "radni" as "radnych m.st. Warszawy" is.
    """
    offices = set(offices)
    terms = {_OFFICE_TERMS[o] for o in offices if o in _OFFICE_TERMS}
    if "Rada dzielnicy" in offices:
        districts = {fold(p.split(" (")[0]) for p in places if "(dzielnica)" in p}
        if districts:
            terms.discard(_OFFICE_TERMS["Rada dzielnicy"])
            terms |= {re.escape(d) for d in districts if d}
    if not terms:
        return None
    words = "(?:" + "|".join(sorted(terms)) + ")"
    if "Rada dzielnicy" in offices:
        return re.compile(r"(?:^| )" + words)
    return re.compile(r"^(?!.*(?:^| )dzielnic)(?:.*? )?" + words)


def same_file(url: str) -> str:
    """A file however its address is spelt: http or https, with www. or without."""
    clean = normalize_url(url)
    return host_of(clean) + path_of(clean)


def link_score(
    link: LinkContext,
    seekers: list[Seeker],
    depth: int,
    prefer: re.Pattern[str] | None = None,
) -> float:
    """How likely following a page link leads to the unit's declarations;
    ``prefer`` (`office_terms`) names the seekers' own council."""
    text = fold(link.anchor) + " " + url_words(link.url)
    score = 0.0
    if DECLARATION.search(text) and ASSETS.search(text):
        score += 10
    elif DECLARATION.search(text) or ASSETS.search(text):
        score += 4
    if OFFICE.search(text):
        score += 2
    if prefer is not None and prefer.search(text):
        score += 3
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
#: An AkcessNet page, menu item or article: its "&id=" makes it look like a
#: file, and a page titled with one seeker's name lent them its ~100 menu links.
_AKCESSNET_PAGE = re.compile(r"/index\.php\?(?:[^#]*&)?idg=\d", re.I)


def is_file_link(url: str) -> bool:
    """A link to a document, when more than an ``?id=`` query says so.

    ``is_document_url`` takes any ``?id=`` for a file, and on a CMS of
    ``index.php?id=N`` pages that makes every menu link one.
    """
    return is_document_url(url) and is_document_url(_ID_QUERY.sub("", url))


def _plain(text: str) -> str:
    """``text`` without diacritics, its case and punctuation kept: the dot in
    "L.Barwinek" tells an initial from the word "w" in "Kowalski w Gminie"."""
    raw = unicodedata.normalize(
        "NFKD", (text or "").replace("ł", "l").replace("Ł", "L")
    )
    return "".join(c for c in raw if not unicodedata.combining(c))


@functools.cache
def _mention(stem_: str) -> re.Pattern[str]:
    """A surname's stem and its ending as a word of `_plain` text, digits
    after it allowed ("d.litwiniuk12"); a long one may carry an initial
    written onto it ("JMaterek"), caught in the first group."""
    endings = "|".join(sorted(_ENDINGS, key=len, reverse=True))
    glued = "([a-z])?" if len(stem_) >= 5 else "()"
    return re.compile(
        r"(?<![a-z0-9])" + glued + re.escape(stem_) + r"(" + endings + r")(?![a-z])"
    )


#: Endings of a -ski/-cki/-dzki surname, folded, that say whose it is: Kowalska,
#: Kowalskiej are a woman's; Kowalski, Kowalskiego, Kowalskiemu, Kowalskim a man's.
_HERS, _HIS = frozenset({"a", "iej"}), frozenset({"i", "iego", "iemu", "im"})
#: An initial before a surname: "L.Barwinek", "L.-Barwinek", "8571_s-kuropatwa";
#: not the "r." of "za 2023 r. Kowalski".
_INITIAL_BEFORE = re.compile(
    r"(?:^|[^a-z0-9\s]|(?<![0-9])\s)([a-z])\s*([._+-])[\s._+-]*$"
)
#: An initial after one: "Kułaj.W", "semeniuk_d-pk", "Szatkowski D."; not the
#: "w" of "Kowalskiego - w związku".
_INITIAL_AFTER = re.compile(r"[._+-]+([a-z])(?![a-z0-9])|\s+([a-z])\.")
#: A two-letter initial, case and dot required: "Sz. Kowalski" (Szymon), "Nowak
#: Cz." (Czesław); not "cz. 1" (część).
_INITIAL2_BEFORE = re.compile(r"(?:^|[^A-Za-z0-9])([CS][zZ]|C[hH])\.[\s_-]*$")
_INITIAL2_AFTER = re.compile(
    r"\s+([CS][zZ]|C[hH])\.(?!\s*(?:\d|[IVXivx]+(?![A-Za-z])))"
)
_WORD_BEFORE = re.compile(r"([a-z]+)[^a-z0-9]*$")
_WORD_AFTER = re.compile(r"[^a-z0-9]*([a-z]+)")
#: How a first name declines: Jan-a/-owi/-em/-ie, Ann-y/-ie/-ę/-ą, Jerz-ego/-emu.
#: No -ów or -owa: those make Józefów and Tomaszów places, not people.
_FIRST_ENDINGS = ("a", "e", "i", "u", "y", "ie", "em", "iem", "owi", "ego", "emu")
#: Words that match a first name's stem without being any form of it: "maj" is
#: Maja's stem, but in "osw_maj_zeman_t" it is majątkowe.
_NOT_FIRST_NAMES = frozenset({"maj"})


def _first_name(word: str, first_names: frozenset[str]) -> bool:
    """Whether a `_plain` word is a first name (a stem in ``first_names``), declined
    or not: Michał, Michała, Iwony."""
    if len(word) < 3 or word in _NOT_FIRST_NAMES:
        return False
    stems = {stem(word, min_a=4)} | {
        word[: -len(e)] for e in _FIRST_ENDINGS if word.endswith(e)
    }
    return bool(stems & first_names)


_DIGITS = re.compile(r"(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])")


def _in_address(first: str, last: str, url: str, first_names: frozenset[str]) -> bool:
    """Whether a first name's stem is in an address's words as itself, run
    into the surname or a number ("0krzysztof_adam_koltys", "nowakmichal")
    but not inside another first name ("wojcik_mariusz" is no Maria's,
    "kowalczyk_karolina" no Karol's), the surname ("michalek_dariusz" is no
    Michał's) or two words ("maria_nowak" no Marian's)."""
    longer = [n for n in first_names if len(n) > len(first) and n.startswith(first)]
    for word in _DIGITS.sub(" ", url).split():
        if _first_name(word, first_names) and not _word(first).search(word):
            continue
        surname = [m.span() for m in re.finditer(re.escape(last), word)]
        for match in re.finditer(re.escape(first), word):
            if any(a <= match.start() and match.end() <= b for a, b in surname):
                continue
            if any(word.startswith(n, match.start()) for n in longer):
                continue
            return True
    return False


def _theirs(seeker: Seeker, word: str) -> bool:
    """Whether a word is a form of the seeker's first or other own names."""
    return any(
        _word(name).search(word)
        for name in (*_first_forms(seeker.first), *seeker.own)
        if name
    )


def _verdict(
    seeker: Seeker, cased: str, match: re.Match[str], first_names: frozenset[str]
) -> str:
    """Whose one mention of the seeker's surname is: "namesake" (the other
    one's -ski/-ska form, an initial or a first name beside it that is not
    theirs), "own" (their own initial), "neutral" (nothing either way) or
    "skip" ("p." for pani or pan, which says nothing)."""
    plain = cased.lower()
    glued, ending = match.group(1) or "", match.group(2)
    if seeker.form == "m" and ending in _HERS:
        return "namesake"
    if seeker.form == "f" and ending in _HIS:
        return "namesake"
    before, after = plain[: match.start()], plain[match.end() :]
    letter, prior = glued, ""
    if not letter and (found := _INITIAL_BEFORE.search(before)):
        # "p. Wąsowicz", "__p_orzelska": pani or pan; "P. Wąsowicz" a Paweł.
        if cased[found.start(1)] == "p":
            return "skip"
        letter = found.group(1)
        if chain := _INITIAL_BEFORE.search(before[: found.start(1)]):
            prior = chain.group(1)
    elif not letter and (found := _INITIAL_AFTER.match(after)):
        letter = found.group(1) or found.group(2)
    elif not letter and (
        found := _INITIAL2_BEFORE.search(cased[: match.start()])
        or _INITIAL2_AFTER.match(cased[match.end() :])
    ):
        letter = found.group(1).lower()
    if letter and seeker.first:
        if seeker.first.startswith(letter):
            return "own"
        # The initial of a second given name says nothing: J. B. Nowak is
        # Jacek Benedykt, T.D.Dudek may be a Tomasz, and B. Nowak alone may
        # be somebody else.
        if prior and seeker.first.startswith(prior):
            return "neutral"
        return (
            "neutral" if any(o.startswith(letter) for o in seeker.own) else "namesake"
        )
    for found in (_WORD_BEFORE.search(before), _WORD_AFTER.match(after)):
        if not found:
            continue
        word = found.group(1)
        if _first_name(word, first_names) and not _theirs(seeker, word):
            return "namesake"
    return "neutral"


def _whose(seeker: Seeker, raws: Iterable[str], first_names: frozenset[str]) -> str:
    """Whose ``raws`` make the seeker's surname: "namesake" when a mention is
    plainly somebody else's and none plainly theirs, "own" when one is
    plainly theirs (a text that names their first name too is), "neutral"
    when none says either way, "" when there is no mention."""
    verdicts: set[str] = set()
    for raw in raws:
        if not raw:
            continue
        if seeker.named_in(fold(raw))[1]:
            return "own"
        cased = _plain(raw)
        for match in _mention(seeker.last).finditer(cased.lower()):
            verdicts.add(_verdict(seeker, cased, match, first_names))
    verdicts.discard("skip")
    if "own" in verdicts:
        return "own"
    if "namesake" in verdicts:
        return "namesake"
    return "neutral" if verdicts else ""


def _named(
    text: str,
    url: str,
    seekers: list[Seeker],
    raws: Iterable[str] = (),
    first_names: frozenset[str] = frozenset(),
) -> tuple[list[tuple[Seeker, bool]], bool]:
    """The seekers ``text`` names (with whether by first name too), and whether
    it named one only as somebody else of their surname (`_whose`)."""
    raws = list(raws)
    found = [(s, *s.named_in(text, url, first_names)) for s in seekers]
    named = [(s, first) for s, last, first in found if last]
    kept = [
        (s, first)
        for s, first in named
        if first or _whose(s, raws, first_names) != "namesake"
    ]
    return kept, len(kept) < len(named)


def candidates(
    page_url: str,
    page_title: str,
    links: list[LinkContext],
    seekers: list[Seeker],
    *,
    first_names: frozenset[str] = frozenset(),
) -> list[Candidate]:
    """Document links on one page that name one of the seekers, or that name nobody.

    A link names whoever its label (or address) names; failing that, its row or
    list item; failing that, the heading over it; failing that, the page's title
    (a page about one person, "Jan Kowalski - oświadczenia majątkowe", lends that
    person its documents). A tier that names somebody who is not a seeker ends
    the search: the link is theirs, not anybody's from a wider tier. So does one
    that names a seeker's surname only as somebody else's (``first_names``, the
    first names' stems, tell "Michał Rzepka" from Józef; `_whose`).
    Documents on a declarations page that name nobody at all (one file for the
    whole council, or labels like "za 2023") come back with an empty ``key``.
    """
    title = fold(page_title)
    in_title, namesake_titled = _named(title, "", seekers, [page_title], first_names)
    title_names = {s.name for s, _ in in_title}
    page_people = (
        [s for s in seekers if s.name in title_names] if len(title_names) == 1 else []
    )
    page_declarations = bool(DECLARATION.search(title) or ASSETS.search(title))
    # A page about one person nobody seeks ("... - B. Kułacz - Stan majątkowy na
    # 31.12.2025 r."): its files are theirs, whatever the labels say. Unless a
    # seeker could be that person in a form named_in misses ("J. Kaczmarka").
    title_somebody = not title_names and (
        namesake_titled
        or any(
            not _could_be(seekers, initial, word)
            for initial, word in initialled_names(page_title)
        )
    )
    out: list[Candidate] = []
    for link in links:
        if not is_document_url(link.url) or _AKCESSNET_PAGE.search(link.url):
            continue
        # The path's words, not the host's: "piotr" in powiat-piotrkowski-api's
        # name is nobody's first name.
        path = decode_url(path_of(link.url))
        address = fold(path)
        label = fold(link.anchor) + " " + address
        if BLANK_FORM.search(label):
            continue
        around = " ".join(fold(x) for x in (link.anchor, link.row, link.heading))
        around += " " + address
        named: list[tuple[Seeker, bool]] = []
        somebody_else = False
        tiers = (
            (label, (link.anchor, path), address),
            (fold(link.row), (link.row,), ""),
            (fold(link.heading), (link.heading,), ""),
        )
        for i, (text, raws, url) in enumerate(tiers):
            named, namesake = _named(text, url, seekers, raws, first_names)
            if named:
                # A surname that says nothing more ("/rzepka.pdf") yields to a
                # wider tier, or the page's title, naming somebody else of it
                # ("Michał Rzepka | radny | pobierz").
                wider = [r for _, rs, _ in tiers[i + 1 :] for r in rs] + [page_title]
                named = [
                    (s, first)
                    for s, first in named
                    if first
                    or _whose(s, raws, first_names) == "own"
                    or _whose(s, wider, first_names) != "namesake"
                ]
                somebody_else = not named
                break
            if namesake or names_somebody(raws[0], initials=not page_people):
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
            if same_file(c.url) not in {same_file(u.url) for u in urls}:
                urls.append(c)
            if len(urls) >= per_person:
                break
        if urls:
            picked[seeker.key] = urls
    unnamed = sorted(
        {
            same_file(c.url): c for c in found if c.key == "" and c.declaration_like
        }.values(),
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
            counts.setdefault(c.key, set()).add(same_file(c.url))
    return all(len(counts.get(s.key, ())) >= per_person for s in seekers)
