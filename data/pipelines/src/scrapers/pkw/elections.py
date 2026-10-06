import enum


class ElectionType(enum.Enum):
    UNKNOWN = 0
    SEJM = 1
    SENAT = 2
    SAMORZADOWE = 3
    EUROPARLAMENT = 4

    def __str__(self) -> str:
        match self:
            case ElectionType.SEJM:
                return "sejmu"
            case ElectionType.SENAT:
                return "senatu"
            case ElectionType.SAMORZADOWE:
                return "samorządu"
            case ElectionType.EUROPARLAMENT:
                return "europarlamentu"
            case _:
                return "nieznany"


def normalise_committee(committee: str) -> str:
    """The form a committee name is looked up by.

    PKW writes the same committee differently from file to file - the full name
    in the 2023 Sejm data, the abbreviation in the 2010 council data, uppercase
    in some years and title case in others, and with whatever spacing the
    spreadsheet had. Both columns land in the same `party` field
    (`headers.py`), so both forms have to be recognised, and neither can be
    matched on unless the spacing and case are settled first.
    """
    return " ".join(committee.lower().split())


#: Which national party or parties a committee stands for.
#:
#: Exact names, not substrings. Local committees borrow national brands - 'KWW
#: POROZUMIENIE SŁUŻY LUDZIOM - TRZECIA DROGA' is not Trzecia Droga, 'KWW
#: KONFEDERACI BEZPARTYJNI POLSKA JEST JEDNA DLA POMORZA' is not Konfederacja -
#: so matching on a fragment would attribute a party to people who never stood
#: for it. A committee nobody has classified gets no party at all, and
#: `PeoplePayloads` reports the ones that cost the most coverage so this list
#: can grow on evidence.
#:
#: Both the full names and the abbreviations are here because PKW uses both;
#: `normalise_committee` settles case and spacing, nothing else.
committee_to_party: dict[str, list[str]] = {
    # "komitet wyborczy akcja wyborcza solidarność": ["AWS"],
    # "zarząd unii wolności": ["UW"],
    # "kw samoobrona rzeczypospolitej polskiej": ["Samoobrona"],
    "komitet wyborczy prawo i sprawiedliwość": ["PiS"],
    'komitet wyborczy "prawo i sprawiedliwość"': ["PiS"],
    "kw prawo i sprawiedliwość": ["PiS"],
    "komitet wyborczy platforma obywatelska rp": ["PO"],
    "komitet wyborczy platforma obywatelska rzeczypospolitej polskiej": ["PO"],
    "kw platforma obywatelska rp": ["PO"],
    "kw platforma obywatelska rzeczypospolitej polskiej": ["PO"],
    # PO was not a registered party yet in 2001, so its Sejm list was a voters'
    # committee. The name appears in no other election.
    "komitet wyborczy wyborców platforma obywatelska": ["PO"],
    "kkw koalicja obywatelska": ["PO"],
    "koalicyjny komitet wyborczy koalicja obywatelska": ["PO"],
    "koalicyjny komitet wyborczy koalicja obywatelska po .n ipl zieloni": ["PO"],
    "koalicyjny komitet wyborczy platforma.nowoczesna koalicja obywatelska": ["PO"],
    "komitet wyborczy polskie stronnictwo ludowe": ["PSL"],
    "komitet wyborczy polskiego stronnictwa ludowego": ["PSL"],
    "komitet wyborczy psl": ["PSL"],
    "kw polskiego stronnictwa ludowego": ["PSL"],
    "naczelny komitet wykonawczy polskiego stronnictwa ludowego": ["PSL"],
    # Until 1998 a list could be named after the party alone, or after the
    # party body that registered it. 'Polskie Stronnictwo Ludowe - Porozumienie
    # Ludowe' is not one of these: it was a separate party, which stood against
    # PSL in 1993.
    "polskie stronnictwo ludowe": ["PSL"],
    "psl": ["PSL"],
    "polskie stronnictwo ludowe sojusz programowy": ["PSL"],
    "krajowy komitet wyborczy polskie stronnictwo ludowe sojusz programowy": ["PSL"],
    "polskie stronnictwo ludowe naczelny komitet wykonawczy": ["PSL"],
    "naczelny komitet wykonawczy psl": ["PSL"],
    "komitet wykonawczy polskiego stronnictwa ludowego": ["PSL"],
    # The 1998 files spell Przymierze Społeczne a dozen ways. These are the
    # spellings with fifty or more candidates.
    "krajowy komitet wyborczy przymierze społeczne: psl-up-kpeir": ["PSL"],
    "krajowy komitet wyborczy przymierze społeczne psl-up-kpeir": ["PSL"],
    "krajowy komitet wyborczy przymierze społeczne:psl-up-kpeir": ["PSL"],
    'krajowy komitet wyborczy"przymierze społeczne: psl-up-kpeir"': ["PSL"],
    "komitet wyborczy przymierze społeczne: psl-up-kpeir": ["PSL"],
    "komitet wyborczy przymierze społeczne psl-up-kpeir": ["PSL"],
    "przymierze społeczne: psl-up-kpeir": ["PSL"],
    # A coalition is both of its parties, and saying so is the honest reading:
    # the candidate stood on a joint list and the list is what PKW recorded.
    "kkw trzecia droga psl-pl2050 szymona hołowni": ["PSL", "Polska 2050"],
    "koalicyjny komitet wyborczy trzecia droga polska 2050 szymona hołowni"
    " - polskie stronnictwo ludowe": ["PSL", "Polska 2050"],
    # The joint PO-PiS sejmik lists of 2002, in fourteen voivodeships.
    "koalicyjny kw platforma obywatelska - prawo i sprawiedliwość": ["PO", "PiS"],
    "sojusz lewicy demokratycznej": ["SLD"],
    "komitet wyborczy sojusz lewicy demokratycznej": ["SLD"],
    "komitet wyborczy sojuszu lewicy demokratycznej": ["SLD"],
    "krajowy komitet wyborczy sojuszu lewicy demokratycznej": ["SLD"],
    # SLD's joint lists, with partners the site does not name: Unia Pracy in
    # 2001-2014, Lewica i Demokraci in 2006-2007 and Zjednoczona Lewica in 2015.
    "koalicyjny kw sojusz lewicy demokratycznej - unia pracy": ["SLD"],
    "kkw sojusz lewicy demokratycznej - unia pracy": ["SLD"],
    "koalicyjny komitet wyborczy sojusz lewicy demokratycznej - unia pracy": ["SLD"],
    "koalicyjny komitet wyborczy sojusz lewicy demokratycznej-unia pracy": ["SLD"],
    "koalicyjny komitet wyborczy sld lewica razem": ["SLD"],
    "koalicyjny komitet wyborczy sld+sdpl+pd+up lewica i demokraci": ["SLD"],
    "kkw sld+sdpl+pd+up lewica i demokraci": ["SLD"],
    "koalicyjny komitet wyborczy lewica i demokraci sld+sdpl+pd+up": ["SLD"],
    "koalicyjny komitet wyborczy zjednoczona lewica sld+tr+pps+up+zieloni": ["SLD"],
    "kkw lewica": ["SLD"],
    # Nowa Lewica is SLD renamed, in 2021. Before that date the list said SLD
    # and this says SLD; after it, both say Nowa Lewica.
    "komitet wyborczy nowa lewica": ["Nowa Lewica"],
    "koalicyjny komitet wyborczy lewica": ["Nowa Lewica"],
    "komitet wyborczy partia razem": ["Razem"],
    "komitet wyborczy partii razem": ["Razem"],
    "komitet wyborczy nowoczesna ryszarda petru": ["Nowoczesna"],
    # The same committee name, written with a hyphen in 2011 and an en dash in
    # 2014 as well as with the em dash.
    "komitet wyborczy nowa prawica — janusza korwin-mikke": ["Konfederacja"],
    "komitet wyborczy nowa prawica – janusza korwin-mikke": ["Konfederacja"],
    "komitet wyborczy nowa prawica - janusza korwin-mikke": ["Konfederacja"],
    "komitet wyborczy konfederacja wolność i niepodległość": ["Konfederacja"],
    # The joint list both parties ran in every sejmik in 2024. PKW abbreviates
    # it, so only the short form matches anything.
    "kww konfederacja i bezpartyjni samorządowcy": [
        "Konfederacja",
        "Bezpartyjni Samorządowcy",
    ],
    "komitet wyborczy wyborców konfederacja i bezpartyjni samorządowcy": [
        "Konfederacja",
        "Bezpartyjni Samorządowcy",
    ],
    # Bezpartyjni Samorządowcy began as a Lower Silesian voters' committee and
    # registered as a party later. The name sounds generic, but the 2014 files
    # have it only in Lower Silesia. From 2018 it ran in every sejmik.
    "komitet wyborczy wyborców bezpartyjni samorządowcy": ["Bezpartyjni Samorządowcy"],
    "komitet wyborczy wyborców koalicja bezpartyjni i samorządowcy": [
        "Bezpartyjni Samorządowcy"
    ],
    "komitet wyborczy bezpartyjni samorządowcy": ["Bezpartyjni Samorządowcy"],
    "kw stowarzyszenie „bezpartyjni samorządowcy”": ["Bezpartyjni Samorządowcy"],
    "komitet wyborczy wyborców bezpartyjni samorządowcy-normalna polska"
    " w normalnej europie": ["Bezpartyjni Samorządowcy"],
}


def parties_of_committee(committee: str | None) -> list[str]:
    """The parties a committee stands for, or nothing if it is not known."""
    if not committee:
        return []
    return committee_to_party.get(normalise_committee(committee), [])
