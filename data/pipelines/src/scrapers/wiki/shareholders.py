"""Who owns a company, as its Wikipedia infobox says.

The register cannot answer that for most of the companies that matter. KRS
publishes the shareholders of a spolka akcyjna only when there is exactly one,
so Energa - 90.92% PKN Orlen - and Polimex Mostostal - Enea, Energa, PGE,
PGNiG Technologie and Pekao - have no owner on record at all. Their articles
name them in the infobox's `udzialowcy`, and of the 469 site companies whose
KRS number a Polish article gives, 234 fill that field in.

It is a free-text field, and it is written every way there is:

    [[Skarb Panstwa]] (52,29%)
    94,17% - Urzad Marszalkowski Wojewodztwa Pomorskiego<br>5,83% - Gmina...
    [[Agencja Mienia Wojskowego|AMW]] - 30,44 proc.<br>[[Wojewodztwo ...
    [[Katowice| Miasto Katowice]] i [[Gornoslasko-Zaglebiowska Metropolia|GZM]]
    WASKO SA 459 000 akcji (85%)<br />Skarb Panstwa 81&nbsp;000 akcji (15%)

so `parse_shareholders` reads it as a stream of links, text and line breaks
rather than as a string, splits that into entries, and takes each entry's stake
out of its name.

`WikiLinks` then says who each entry is, using nothing but the dump: the
article it links to - followed through redirects, since `[[Polski Koncern
Naftowy Orlen]]` is one - is either a company article giving a KRS number, or
a city, gmina, powiat or wojewodztwo article giving a TERYT code. An entry with
no link is tried as a title, which is how "PKP S.A." finds Polskie Koleje
Panstwowe. A gmina written out in words and not linked ("Gmina Miasta Torun")
is left to `Companies`, which holds the TERYT register's own index of names.
"""

import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass, field, replace

import mwparserfromhell
from mwparserfromhell.nodes import (
    ExternalLink,
    HTMLEntity,
    Tag,
    Template,
    Text,
    Wikilink,
)
from mwparserfromhell.wikicode import Wikicode

from entities.company import WikiShareholder

#: Namespaces a link can point into that are never an owner.
_NAMESPACES = frozenset(
    {
        "plik",
        "file",
        "grafika",
        "image",
        "kategoria",
        "category",
        "szablon",
        "template",
        "wikipedia",
        "pomoc",
        "portal",
        "wikiprojekt",
    }
)

#: Templates that wrap a name rather than annotating it: the first argument is
#: the text. `link-interwiki` names an owner with no Polish article yet -
#: Ferrovial, which holds half of Budimex, is one.
_TEXT_TEMPLATES = frozenset({"link-interwiki", "nowrap", "nobr"})

#: A stake: "52,29%", "52 %", "30,44 proc.", "~93,5%".
_SHARE = re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*(?:%|proc\b\.?|procent\w*)")

#: What is said about a stake beside it, taken out of the name with it.
_SHARE_NOTE = (
    r"(?:\s*(?:akcji|udziałów|udziały|głosów|kapitału(?:\s+zakładowego)?|"
    r"w\s+kapitale(?:\s+zakładowym)?))?"
)

#: Taken out of a name: the stake and its note, a count of shares, an amount of
#: capital, and the "and others" an article trails off with.
_NAME_NOISE = (
    re.compile(
        r"[~≈]?\s*\d{1,3}(?:[.,]\d+)?\s*(?:%|proc\b\.?|procent\w*)" + _SHARE_NOTE
    ),
    re.compile(r"\d[\d\s.,]*\s*akcji\b"),
    re.compile(r"\d[\d\s.,]*\s*(?:mln|mld|tys\.?)?\s*(?:zł|PLN)\b"),
    re.compile(r"\s+(?:i\s+in\.?|i\s+inni|itd\.?|itp\.?)\s*$"),
    # "(72,9%) udziałów": the note outlives its stake once that is gone.
    re.compile(r"\(\s*\)\s*(?:akcji|udziałów|głosów)\b"),
    # "... (0,66%)<br />oraz pracownicy": a conjunction left at the start.
    re.compile(r"^\s*(?:oraz|i|a\s+także)\s+"),
)

#: An entry that is nothing but a legal form, left behind when a comma inside
#: a name was taken for one between two names: "AeroRegional Paraguaya, S.A.".
_LEGAL_FORM_ONLY = re.compile(
    r"^(?:S\.?\s?A\.?|Sp\.?\s*z\s*o\.?\s?o\.?|SE|AG|GmbH|B\.?V\.?|N\.?V\.?|Inc\.?|"
    r"Ltd\.?|LLC|plc|S\.p\.A\.|S\.A\.S\.|a\.s\.|Co\.?)$",
    re.IGNORECASE,
)

#: A legal form at the end of a name, dropped when the name is tried as a title:
#: "Agencja Rozwoju Przemyslu S.A." is the article "Agencja Rozwoju Przemyslu".
_LEGAL_FORM_SUFFIX = re.compile(
    r"[\s,]+(?:S\.?\s?A\.?|Spółka\s+Akcyjna|Sp\.?\s*z\s*o\.?\s?o\.?|"
    r"Spółka\s+z\s+ograniczoną\s+odpowiedzialnością)$",
    re.IGNORECASE,
)

#: A conjunction at the end of the text between two links: "[[A]] i [[B]]",
#: "[[A]] (50%) oraz [[B]]".
_TRAILING_CONJUNCTION = re.compile(r"(?:^|\s)(?:i|oraz|a\s+także|&)\s*$")


@dataclass(frozen=True)
class _Token:
    """One piece of the field: text, a link, or a line break."""

    kind: str
    text: str = ""
    target: str | None = None


_BREAK = _Token("break")


def normalize_title(title: str | None) -> str | None:
    """An article title the way MediaWiki resolves it.

    Underscores and spaces are the same character, the part after "#" is a
    section rather than another article, and the first letter is
    case-insensitive - `[[skarb panstwa]]` is the article "Skarb panstwa".
    None for a link that cannot be an owner: a file, a category, or an
    interwiki link, which starts with a colon.
    """
    if not title:
        return None
    text = title.replace("_", " ").replace("\u00a0", " ")
    text = text.split("#", 1)[0]
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text.startswith(":"):
        return None
    if ":" in text and text.split(":", 1)[0].strip().lower() in _NAMESPACES:
        return None
    return text[0].upper() + text[1:]


def article_url(title: str) -> str:
    """The address of an article, as `ProcessWiki` writes a person's."""
    return f"https://pl.wikipedia.org/wiki/{title.replace(' ', '_')}"


def clean_krs(raw) -> str | None:
    """The KRS number an infobox gives, padded to ten digits, or None.

    The field is free text like the rest. Almost every one is the bare number,
    but some say "KRS 0000123456" or carry a reference; the first run of five
    to ten digits is the number, and anything shorter is a year or a stray
    footnote.
    """
    if not isinstance(raw, str):
        return None
    match = re.search(r"(?<!\d)(\d{5,10})(?!\d)", raw)
    if match is None:
        return None
    krs = match.group(1).zfill(10)
    return None if krs == "0000000000" else krs


def normalize_teryt(code: str | None) -> str | None:
    """The unit an article's TERYT or TERC code names, as the site keys it.

    A wojewodztwo is two digits and a powiat four. A gmina is seven, the last
    being its RODZ - and a town in a gmina miejsko-wiejska carries 4, the
    town half of the gmina, which owns nothing: Grodkow is 1601034 and the
    gmina that owns its companies is 1601033. So 4 and 5 become 3. 8 and 9
    are Warsaw's dzielnice and delegatury, which own nothing either.
    """
    if not code or not code.isdigit():
        return None
    if len(code) in (2, 4):
        return code
    if len(code) != 7:
        return None
    rodz = code[-1]
    if rodz in ("1", "2", "3"):
        return code
    if rodz in ("4", "5"):
        return code[:-1] + "3"
    return None


def _ascii_upper(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.upper())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", stripped.replace("Ł", "L")).strip()


def is_skarb_panstwa(name: str) -> bool:
    """Whether an entry names the Polish Treasury and nothing else.

    On the whole name, not on a link: plwiki writes the Norwegian treasury as
    `[[skarb panstwa]] [[Norwegia|Norwegii]]` and the Estonian one as "skarb
    panstwa Estonii", and both link or read like ours up to the last word.
    """
    text = _ascii_upper(re.sub(r"\(.*?\)", " ", name)).strip(" .,-")
    return text in (
        "SKARB PANSTWA",
        "SKARB PANSTWA RP",
        "SKARB PANSTWA RZECZYPOSPOLITEJ POLSKIEJ",
    )


def _link_tokens(node: Wikilink) -> Iterator[_Token]:
    target = normalize_title(str(node.title))
    label = node.text.strip_code().strip() if node.text else ""
    if not label:
        label = str(node.title).split("#", 1)[0].strip()
    if target is not None:
        yield _Token("link", label, target)
    elif str(node.title).strip().startswith(":"):
        # An interwiki link: the name is real, the article is not ours.
        yield _Token("text", label)


def _tag_tokens(node: Tag) -> Iterator[_Token]:
    tag = str(node.tag).strip().lower()
    if tag == "ref":
        return
    if tag == "br":
        yield _BREAK
        return
    block = tag in ("li", "p", "div")
    if block:
        yield _BREAK
    if node.contents is not None:
        yield from _tokens(node.contents)
    if block:
        yield _BREAK


def _tokens(code: Wikicode) -> Iterator[_Token]:
    """The field as text, links and line breaks, with references and notes out."""
    for node in code.nodes:
        if isinstance(node, Text):
            yield _Token("text", str(node.value))
        elif isinstance(node, HTMLEntity):
            yield _Token("text", node.normalize())
        elif isinstance(node, Wikilink):
            yield from _link_tokens(node)
        elif isinstance(node, Template):
            name = str(node.name).strip().lower()
            if name in _TEXT_TEMPLATES and node.params:
                param = node.get("pl") if node.has("pl") else node.params[0]
                yield from _tokens(param.value)
        elif isinstance(node, Tag):
            yield from _tag_tokens(node)
        elif isinstance(node, ExternalLink) and node.title is not None:
            yield _Token("text", node.title.strip_code())


@dataclass
class _Entry:
    tokens: list[_Token] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(t.text for t in self.tokens)

    @property
    def targets(self) -> list[str]:
        return list(dict.fromkeys(t.target for t in self.tokens if t.target))


def _append_text(entries: list[_Entry], text: str, depth: int) -> int:
    """Adds a run of text, ending an entry at each break that is not nested.

    A line always ends one. A semicolon or a comma ends one only outside
    parentheses - ZE PAK's owner is "[[Zygmunt Solorz-Zak]] (posrednio,
    65,96%)" - and a comma between two digits never does, being a decimal one.
    Returns how deep in parentheses the text leaves off, since a parenthesis
    can open before a link and close after it.
    """
    start = 0
    for i, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        elif char == "\n" or (depth == 0 and char in ",;"):
            decimal = (
                char == ","
                and 0 < i < len(text) - 1
                and text[i - 1].isdigit()
                and text[i + 1].isdigit()
            )
            if decimal:
                continue
            if text[start:i]:
                entries[-1].tokens.append(_Token("text", text[start:i]))
            entries.append(_Entry())
            start = i + 1
            if char == "\n":
                depth = 0
    if text[start:]:
        entries[-1].tokens.append(_Token("text", text[start:]))
    return depth


def _entries(tokens: list[_Token]) -> list[_Entry]:
    """The field cut into one run of tokens per owner.

    Lines end an entry wherever they stand, and semicolons and commas outside
    parentheses - see `_append_text`. A conjunction does only between two
    links - "[[A]] i [[B]]" is two owners, "Miasto i Gmina Grodkow" is one.
    Whatever stands before the conjunction still belongs to the first: in
    "[[LTU]] (50%) i [[Volga-Dnepr]]" that is LTU's stake.
    """
    entries = [_Entry()]
    depth = 0
    for i, token in enumerate(tokens):
        if token.kind == "break":
            entries.append(_Entry())
            depth = 0
            continue
        if token.kind == "link":
            entries[-1].tokens.append(token)
            continue
        between_links = (
            any(t.kind == "link" for t in entries[-1].tokens)
            and i + 1 < len(tokens)
            and tokens[i + 1].kind == "link"
        )
        conjunction = _TRAILING_CONJUNCTION.search(token.text)
        if between_links and conjunction:
            depth = _append_text(entries, token.text[: conjunction.start()], depth)
            if depth == 0:
                entries.append(_Entry())
                continue
            entries[-1].tokens.append(_Token("text", token.text[conjunction.start() :]))
            continue
        depth = _append_text(entries, token.text, depth)
    return [e for e in entries if e.text.strip()]


def _share(text: str) -> float | None:
    match = _SHARE.search(text)
    if match is None:
        return None
    value = float(match.group(1).replace(",", "."))
    return value if 0 < value <= 100 else None


def _clean_name(text: str) -> str:
    for pattern in _NAME_NOISE:
        text = pattern.sub(" ", text)
    # "(posrednio, 65,96%)" is "(posrednio, )" once the stake is out.
    text = re.sub(r"[\s,;]+\)", ")", text)
    text = re.sub(r"\(\s*\)", " ", text)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \t-–—:,;~")


def parse_shareholders(value: Wikicode | str) -> list[WikiShareholder]:
    """The owners `udzialowcy` lists, unresolved, in the article's order."""
    if isinstance(value, str):
        value = mwparserfromhell.parse(value)
    shareholders: list[WikiShareholder] = []
    for entry in _entries(list(_tokens(value))):
        text = entry.text
        name = _clean_name(text)
        share = _share(text)
        targets = entry.targets
        if not name and not targets:
            if share is not None and shareholders and shareholders[-1].share is None:
                # A stake on a line of its own, under the name it belongs to.
                shareholders[-1] = replace(shareholders[-1], share=share)
            continue
        if _LEGAL_FORM_ONLY.match(name) and not targets and shareholders:
            last = shareholders[-1]
            shareholders[-1] = replace(
                last, name=f"{last.name}, {name}", share=last.share or share
            )
            continue
        shareholders.append(
            WikiShareholder(
                name=name,
                # Two links in one entry is a name the article built out of
                # them - `[[skarb panstwa]] [[Norwegia|Norwegii]]` - and
                # neither link alone is who it names.
                article=targets[0] if len(targets) == 1 else None,
                share=share,
            )
        )
    return shareholders


@dataclass
class WikiLinks:
    """What the dump says an article title is.

    `redirects` maps a redirect's title to its target, `krs` a company
    article's title to the KRS number its infobox gives, `teryt` a city,
    gmina, powiat or wojewodztwo article's title to its unit. Every key is a
    `normalize_title`.
    """

    redirects: dict[str, str] = field(default_factory=dict)
    krs: dict[str, str] = field(default_factory=dict)
    teryt: dict[str, str] = field(default_factory=dict)
    #: `_fold`'s index, built the first time a title misses.
    _folded: dict[str, str | None] | None = field(
        default=None, init=False, repr=False, compare=False
    )

    def canonical(self, title: str | None) -> str | None:
        """The article a title lands on, through at most five redirects."""
        title = normalize_title(title)
        seen = set()
        while title is not None and title in self.redirects and title not in seen:
            seen.add(title)
            if len(seen) > 5:
                break
            title = normalize_title(self.redirects[title])
        return title

    def _known(self, title: str) -> tuple[str | None, str | None]:
        if title in self.krs:
            return self.krs[title], None
        if title in self.teryt:
            return None, self.teryt[title]
        return None, None

    def _fold(self, title: str) -> str | None:
        """A title written in another case, when only one known title is it.

        MediaWiki ignores the case of the first letter only, so `[[ORLEN]]`
        and "Wojewodztwo Pomorskie" miss "Orlen" and "Wojewodztwo pomorskie"
        unless somebody made the redirect. Built over the titles that lead
        somewhere, not over every redirect in the dump, and a spelling two of
        them share answers nothing.
        """
        if self._folded is None:
            folded: dict[str, str | None] = {}
            useful = list(self.krs) + list(self.teryt)
            useful += [
                t
                for t in self.redirects
                if self._known(self.canonical(t) or "") != (None, None)
            ]
            for known in useful:
                key = known.casefold()
                folded[key] = known if folded.get(key, known) == known else None
            self._folded = folded
        return self._folded.get(title.casefold())

    def _identify(self, title: str | None) -> tuple[str | None, str | None]:
        canonical = self.canonical(title)
        if canonical is None:
            return None, None
        krs, teryt = self._known(canonical)
        if krs is None and teryt is None:
            folded = self._fold(canonical)
            if folded is not None:
                krs, teryt = self._known(self.canonical(folded) or "")
        return krs, teryt

    def resolve(
        self, shareholder: WikiShareholder, own_krs: str | None = None
    ) -> WikiShareholder:
        """The entry with who it is filled in, where the dump can tell.

        The Treasury by its name alone, see `is_skarb_panstwa`. Then the article
        the entry links to; then, for an entry with no link or a link to an
        article that is neither a company nor a place, its name tried as a
        title, with and without its legal form. A company never owns itself:
        EuRoPol Gaz lists its own treasury shares, and an edge from a node to
        itself is a loop on the graph rather than a fact.
        """
        if is_skarb_panstwa(shareholder.name):
            return replace(shareholder, skarb_panstwa=True, krs=None, teryt=None)

        krs, teryt = self._identify(shareholder.article)
        if krs is None and teryt is None:
            stripped = _LEGAL_FORM_SUFFIX.sub("", shareholder.name).strip()
            for candidate in dict.fromkeys((shareholder.name, stripped)):
                krs, teryt = self._identify(candidate)
                if krs is not None or teryt is not None:
                    break
        if krs is not None and krs == own_krs:
            krs = None
        return replace(shareholder, krs=krs, teryt=teryt, skarb_panstwa=False)
