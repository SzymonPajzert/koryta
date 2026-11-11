"""Which parties a candidate's own PKW statements put them with.

Beside the committee a candidate stood for, PKW records two statements about
their party: what the candidate declared about their own membership
(`party_member`: „członek partii politycznej: Prawo i Sprawiedliwość”, „nie
należy do partii politycznej”) and who backed the candidacy (`supported_by`:
„popierana przez partię polityczną: Prawo i Sprawiedliwość”, „pop. przez:
SLD”). The second is recorded on any list, a local voters' committee's
included, and that is where it says most: the committee's name names no party.

Szymon, 2026-11-11: a backing counts as an affiliation, as a membership does.
The site's parties mean affiliation in the broad sense, and the page is to show
how each one is known rather than list them all alike.

Both columns name the party in whatever form the year's file used: in full, as
an abbreviation, in the genitive after „członek” („członek Prawa i
Sprawiedliwości”), in the accusative after „przez” („pop. przez: Platformę
Obywatelską RP”). `party_names` is a curated table of those forms, exact for
the reason `committee_to_party` is: an association that borrows a party's word
is not the party, and a local one is no party at all. A name nobody has
classified gives no party, and `PeoplePayloads` reports the ones that cost the
most, so the table can grow on evidence.
"""

import re

from scrapers.pkw.elections import (
    OTHER_PARTY,
    normalise_committee,
    parties_of_committee,
    party_sort_key,
)

#: Party names as the membership and backing columns write them, in the form
#: `statement_name` leaves them: lowercased, quotes dropped, spacing settled.
#: The national parties the site does not name go to `OTHER_PARTY`, as their
#: committees do in `committee_to_party`; Konfederacja's member parties among
#: them, until decide-whether-konfederacja-s-predecessor-lists-korwin-ruch says
#: otherwise.
party_names: dict[str, list[str]] = {
    # PiS
    "prawo i sprawiedliwość": ["PiS"],
    "prawa i sprawiedliwości": ["PiS"],
    "pis": ["PiS"],
    # PO, and Koalicja Obywatelska, which `committee_to_party` files as PO too.
    "platforma obywatelska": ["PO"],
    "platforma obywatelska rp": ["PO"],
    "platforma obywatelska rzeczypospolitej polskiej": ["PO"],
    "platformy obywatelskiej": ["PO"],
    "platformy obywatelskiej rp": ["PO"],
    "platformy obywatelskiej rzeczypospolitej polskiej": ["PO"],
    "platformę obywatelską": ["PO"],
    "platformę obywatelską rp": ["PO"],
    "platformę obywatelską rzeczypospolitej polskiej": ["PO"],
    "po": ["PO"],
    "po rp": ["PO"],
    # The 2006 council file's abbreviation, 1,082 candidates.
    "porp": ["PO"],
    "koalicja obywatelska": ["PO"],
    "koalicji obywatelskiej": ["PO"],
    "koalicję obywatelską": ["PO"],
    "ko": ["PO"],
    # PSL
    "polskie stronnictwo ludowe": ["PSL"],
    "polskiego stronnictwa ludowego": ["PSL"],
    "psl": ["PSL"],
    # SLD, and Nowa Lewica after the 2021 rename, kept apart as on the site.
    "sojusz lewicy demokratycznej": ["SLD"],
    "sojuszu lewicy demokratycznej": ["SLD"],
    "sld": ["SLD"],
    "sld lewica razem": ["SLD"],
    # SdRP was the party at the heart of the 1990s SLD lists, which
    # `committee_to_party` files as SLD: 937 of its 940 backings in 1998 are on
    # them, and „Inne” beside SLD would only grey them out.
    "sdrp": ["SLD"],
    "socjaldemokracja rzeczypospolitej polskiej": ["SLD"],
    "nowa lewica": ["Nowa Lewica"],
    "nowej lewicy": ["Nowa Lewica"],
    "nową lewicę": ["Nowa Lewica"],
    "lewica": ["Nowa Lewica"],
    # Razem, which was registered as „Lewica Razem” in 2019-2023.
    "partia razem": ["Razem"],
    "partii razem": ["Razem"],
    "partię razem": ["Razem"],
    "lewica razem": ["Razem"],
    "razem": ["Razem"],
    # Polska 2050, the association it grew out of included.
    "polska 2050": ["Polska 2050"],
    "polska 2050 szymona hołowni": ["Polska 2050"],
    "polski 2050": ["Polska 2050"],
    "polski 2050 szymona hołowni": ["Polska 2050"],
    "polskę 2050": ["Polska 2050"],
    "pl2050": ["Polska 2050"],
    "pl2050 szymona hołowni": ["Polska 2050"],
    "stowarzyszenie polska 2050": ["Polska 2050"],
    # A coalition is both of its parties, as in `committee_to_party`.
    "trzecia droga": ["PSL", "Polska 2050"],
    # Nowoczesna; `statement_name` drops the leading dot of „.Nowoczesna”.
    "nowoczesna": ["Nowoczesna"],
    "nowoczesna ryszarda petru": ["Nowoczesna"],
    "nowoczesnej": ["Nowoczesna"],
    "nowoczesną": ["Nowoczesna"],
    # Konfederacja under its own name.
    "konfederacja": ["Konfederacja"],
    "konfederacja wolność i niepodległość": ["Konfederacja"],
    "konfederacji wolność i niepodległość": ["Konfederacja"],
    "konfederacja nowa nadzieja": ["Konfederacja"],
    # As its committee is in `committee_to_party`, until
    # decide-whether-konfederacja-s-predecessor-lists-korwin-ruch moves both.
    "nowa prawica - janusza korwin-mikke": ["Konfederacja"],
    # Bezpartyjni Samorządowcy
    "bezpartyjni samorządowcy": ["Bezpartyjni Samorządowcy"],
    "bezpartyjni samorządowcy-łączy nas polska": ["Bezpartyjni Samorządowcy"],
    "bezpartyjnych samorządowców": ["Bezpartyjni Samorządowcy"],
    "stowarzyszenie bezpartyjni samorządowcy": ["Bezpartyjni Samorządowcy"],
    # National parties the site does not name.
    "samoobrona": [OTHER_PARTY],
    "samoobrona rp": [OTHER_PARTY],
    "samoobrona rzeczpospolitej polskiej": [OTHER_PARTY],
    "samoobrona rzeczypospolitej polskiej": [OTHER_PARTY],
    "samoobrony": [OTHER_PARTY],
    "samoobrony rp": [OTHER_PARTY],
    "samoobrony rzeczpospolitej polskiej": [OTHER_PARTY],
    "samoobrony rzeczypospolitej polskiej": [OTHER_PARTY],
    "ndp - samoobrona andrzeja leppera": [OTHER_PARTY],
    "liga polskich rodzin": [OTHER_PARTY],
    "ligi polskich rodzin": [OTHER_PARTY],
    "ligę polskich rodzin": [OTHER_PARTY],
    "lpr": [OTHER_PARTY],
    "unia polityki realnej": [OTHER_PARTY],
    "unii polityki realnej": [OTHER_PARTY],
    "upr": [OTHER_PARTY],
    "kongres nowej prawicy": [OTHER_PARTY],
    "kongresu nowej prawicy": [OTHER_PARTY],
    "prawica rzeczypospolitej": [OTHER_PARTY],
    "prawicy rzeczypospolitej": [OTHER_PARTY],
    "prawicę rzeczypospolitej": [OTHER_PARTY],
    "prawica marka jurka": [OTHER_PARTY],
    "prawicę marka jurka": [OTHER_PARTY],
    "unia pracy": [OTHER_PARTY],
    "unii pracy": [OTHER_PARTY],
    "up": [OTHER_PARTY],
    "socjaldemokracja polska": [OTHER_PARTY],
    "socjaldemokracji polskiej": [OTHER_PARTY],
    "sdpl": [OTHER_PARTY],
    "partia demokratyczna": [OTHER_PARTY],
    "partia demokratyczna-demokraci.pl": [OTHER_PARTY],
    "partia demokratyczna - demokraci.pl": [OTHER_PARTY],
    "partii demokratycznej": [OTHER_PARTY],
    "pd": [OTHER_PARTY],
    "polska partia pracy": [OTHER_PARTY],
    "polskiej partii pracy": [OTHER_PARTY],
    "polska partia pracy - sierpień 80": [OTHER_PARTY],
    "ppp": [OTHER_PARTY],
    "stronnictwo demokratyczne": [OTHER_PARTY],
    "stronnictwa demokratycznego": [OTHER_PARTY],
    "sd": [OTHER_PARTY],
    "partia kobiet": [OTHER_PARTY],
    "partii kobiet": [OTHER_PARTY],
    "partię kobiet": [OTHER_PARTY],
    "polska partia socjalistyczna": [OTHER_PARTY],
    "polskiej partii socjalistycznej": [OTHER_PARTY],
    "pps": [OTHER_PARTY],
    "racja polskiej lewicy": [OTHER_PARTY],
    "ruch palikota": [OTHER_PARTY],
    "twój ruch": [OTHER_PARTY],
    "polska jest najważniejsza": [OTHER_PARTY],
    "pjn": [OTHER_PARTY],
    "solidarna polska": [OTHER_PARTY],
    "solidarna polska zbigniewa ziobro": [OTHER_PARTY],
    "suwerenna polska": [OTHER_PARTY],
    "porozumienie jarosława gowina": [OTHER_PARTY],
    "polska razem": [OTHER_PARTY],
    "polska razem jarosława gowina": [OTHER_PARTY],
    "polska razem zjednoczona prawica": [OTHER_PARTY],
    "kukiz15": [OTHER_PARTY],
    "wiosna": [OTHER_PARTY],
    "wiosna roberta biedronia": [OTHER_PARTY],
    "ruch narodowy": [OTHER_PARTY],
    "ruch narodowy rp": [OTHER_PARTY],
    "korwin": [OTHER_PARTY],
    "korwin: koalicja odnowy rzeczypospolitej wolność i nadzieja": [OTHER_PARTY],
    "nowa nadzieja": [OTHER_PARTY],
    "konfederacja korony polskiej": [OTHER_PARTY],
    "aws": [OTHER_PARTY],
    "rs aws": [OTHER_PARTY],
    "rsaws": [OTHER_PARTY],
    "ruch społeczny aws": [OTHER_PARTY],
    "ruchu społecznego aws": [OTHER_PARTY],
    "ruch społeczny akcja wyborcza solidarność": [OTHER_PARTY],
    "unia demokratyczna": [OTHER_PARTY],
    "ruch dla rzeczypospolitej": [OTHER_PARTY],
    "ruchu katolicko-narodowego": [OTHER_PARTY],
    "polska partia narodowa": [OTHER_PARTY],
    "unii lewicy iii rp": [OTHER_PARTY],
    "partia x": [OTHER_PARTY],
    "wolni i solidarni": [OTHER_PARTY],
    "ślonzoki razem": [OTHER_PARTY],
    # Polskie Stronnictwo Ludowe - Porozumienie Ludowe, which stood against PSL
    # in 1993, as `committee_to_party` notes.
    "psl-pl": [OTHER_PARTY],
    "uw": [OTHER_PARTY],
    "kpn": [OTHER_PARTY],
    "kpn-ojczyzna": [OTHER_PARTY],
    "zjednoczenie chrześcijańsko-narodowe": [OTHER_PARTY],
    "zchn": [OTHER_PARTY],
    "partia chrześcijańskich demokratów": [OTHER_PARTY],
    "ppchd": [OTHER_PARTY],
    "przymierze prawicy": [OTHER_PARTY],
    "przymierza prawicy": [OTHER_PARTY],
    "alternatywa ruch społeczny": [OTHER_PARTY],
    "alternatywy ruchu społecznego": [OTHER_PARTY],
    "stronnictwo ludowo-chrześcijańskie": [OTHER_PARTY],
    "zieloni": [OTHER_PARTY],
    "partia zieloni": [OTHER_PARTY],
    "zieloni 2004": [OTHER_PARTY],
    "zielonych 2004": [OTHER_PARTY],
    "zielonych": [OTHER_PARTY],
    "polska partia ekologiczna zieloni": [OTHER_PARTY],
    "partia konserwatywna": [OTHER_PARTY],
    "polska jest jedna": [OTHER_PARTY],
    "skl": [OTHER_PARTY],
    "stronnictwo konserwatywno-ludowe": [OTHER_PARTY],
    "stronnictwa konserwatywno-ludowego": [OTHER_PARTY],
    "stronnictwa konserwatywno - ludowego": [OTHER_PARTY],
    "inicjatywa dla polski": [OTHER_PARTY],
    "krajowa partia emerytów i rencistów": [OTHER_PARTY],
    "kpeir": [OTHER_PARTY],
    "stronnictwo narodowe": [OTHER_PARTY],
    "stronnictwa narodowego": [OTHER_PARTY],
    "polska wspólnota narodowa": [OTHER_PARTY],
    "polska wspólnota narodowa - psn": [OTHER_PARTY],
    "polskiej wspólnoty narodowej": [OTHER_PARTY],
    "polska unia gospodarcza": [OTHER_PARTY],
    "polskiej unii gospodarczej": [OTHER_PARTY],
    "pug": [OTHER_PARTY],
    "porozumienie centrum": [OTHER_PARTY],
    "pc": [OTHER_PARTY],
    "rop": [OTHER_PARTY],
    "partia ludowo-demokratyczna": [OTHER_PARTY],
    "pld": [OTHER_PARTY],
    "stronnictwo piast": [OTHER_PARTY],
    "narodowe odrodzenie polski": [OTHER_PARTY],
    "ruch obrony bezrobotnych": [OTHER_PARTY],
    "unia europejskich demokratów": [OTHER_PARTY],
    "demokracja bezpośrednia": [OTHER_PARTY],
}

#: What a statement says when it names no party. Not reported as unclassified.
NO_PARTY = {
    "nie należy do partii politycznej",
    "nie należy do partii",
    "nie należy",
    "nie zgłoszono przynależności do partii",
    "brak oznaczenia",
    "brak",
    "bezpartyjny",
    "bezpartyjna",
    "-",
}

#: The verb a statement opens with, and the „przez” after a backing one.
_VERB = re.compile(
    r"^(?:członek|członkini"
    r"|(?:popierany|popierana|popierane|popierani|pop\.)(?:\s+przez)?)\s*:?\s*",
    re.IGNORECASE,
)
#: What kind of body the name is, which the newer files write after the verb.
_KIND = re.compile(
    r"^(?:partii politycznej|partię polityczną|partie polityczne"
    r"|organizację|organizacje|partii|partię)\s*:?\s*",
    re.IGNORECASE,
)
_QUOTES = re.compile(r"[\"'„”“«»]")


def statement_name(text: str) -> str:
    """A name as `party_names` keys it: lowercased, quotes dropped, spacing
    settled, and no stray punctuation at either end („.Nowoczesna”)."""
    return normalise_committee(_QUOTES.sub("", text)).strip(" .,:;-")


def _readings(part: str) -> list[str]:
    """The names a part of a statement may be, most likely first.

    The kind word is dropped first, as in „członek partii Platforma
    Obywatelska RP”. Where that word is part of the name instead - „członek
    Partii Kobiet” - the reading that keeps it comes second.
    """
    after_verb = _VERB.sub("", part.strip(), count=1)
    readings = [_KIND.sub("", after_verb, count=1), after_verb]
    return list(dict.fromkeys(statement_name(r) for r in readings if r.strip()))


def _parts(text: str) -> list[str]:
    """The statement's parts: „nie należy do partii politycznej, pop. SLD”
    is a membership and a backing in one cell."""
    return [part for part in re.split(r"\s*[,;]\s*", text) if part.strip()]


def _party_of_part(part: str) -> list[str]:
    for reading in _readings(part):
        parties = party_names.get(reading) or parties_of_committee(reading)
        if parties:
            return parties
    return []


def parties_of_statement(text: str | None) -> list[str]:
    """The site's parties a membership or backing statement names, in the order
    the site stores them, or nothing."""
    if not text:
        return []
    parties: set[str] = set()
    for part in _parts(text):
        parties.update(_party_of_part(part))
    return sorted(parties, key=party_sort_key)


def unclassified_names(text: str | None) -> list[str]:
    """The names in a statement that give no party and do not say "no party"
    either - what `party_names` might be missing. A number is the 1997 Sejm
    file's party code and is left out: there is no name to classify."""
    if not text:
        return []
    names = []
    for part in _parts(text):
        readings = _readings(part)
        if not readings or _party_of_part(part):
            continue
        name = readings[0]
        if name and name not in NO_PARTY and not name.isdigit():
            names.append(name)
    return names
