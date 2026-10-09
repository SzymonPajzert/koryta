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


#: A tie to a national party the site does not name: AWS, Samoobrona, UW, LPR
#: and the rest of the parties that have since dissolved or stayed small. The
#: site stores and filters it like any party and draws it greyed out
#: (`OTHER_PARTY` in `frontend/shared/misc.ts`), so it says that somebody stood
#: for a party without putting them beside PiS or PO.
OTHER_PARTY = "Inne"


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
    #
    # The national parties the site does not name, as `OTHER_PARTY`.
    #
    # Every spelling person_pkw holds is here, down to a single candidate. PKW
    # took the 1998 lists from each gmina's own commission, which typed the
    # national committee as it saw fit - in quotes or out, with "(AWS)" after
    # it or before, with a garbled first word ('womitet', 'rygielt wyborczy').
    # Each of those is the national committee misread, not a local one.
    #
    # A joint list of these parties, or of one of them with a party the site
    # does not name, is „Inne” too, on the rule the SLD lists above follow. A
    # joint list with a party the site does name keeps that party: Przymierze
    # Społeczne above is PSL, though KPEiR stood on it. A list that joined a
    # party's town branch with a group of the town's own ('Ziemia Kamieńska
    # AWS-UPR-UW-RPN', 'Kielce Nasze Miasto', 'Lubelskie Forum Samorządowe - Unia
    # Wolności') is a local list and gets nothing, like the KWWs in 2024 that
    # borrow Trzecia Droga's name.
    #
    # Akcja Wyborcza Solidarność. AWS Prawicy was its list in 2001.
    "komitet wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarnosc": [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność"': [OTHER_PARTY],
    'komitet wyborczy"akcja wyborcza solidarność"': [OTHER_PARTY],
    'komitet wyborczy" akcja wyborcza solidarność "': [OTHER_PARTY],
    'komitet wyborczy akcja wyborcza solidarność"': [OTHER_PARTY],
    'komitet wyborczy akcja wyborcza "solidarność"': [OTHER_PARTY],
    'komitet wyborczy akcja "wyborcza solidarność"': [OTHER_PARTY],
    'komitet wyborczy akcja wyborcza "solidarność" h': [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność" (aws)': [OTHER_PARTY],
    'komitet wyborczy"akcja wyborcza solidarność(aws)"': [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność(aws)': [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność" - aws': [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność" aws': [OTHER_PARTY],
    'komitet wyborczy"akcja wyborcza solidarność"/aws/': [OTHER_PARTY],
    'komitet wyborczy "akcja wyborcza solidarność" /aws/': [OTHER_PARTY],
    'komitet wyborczy akcja wyborcza solidarność "aws"': [OTHER_PARTY],
    'komitet wyborczy akcja wyborcza "solidarność" (aws)': [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarność aws": [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarność (aws)": [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarność /aws/": [OTHER_PARTY],
    "komitet wyborczy aws": [OTHER_PARTY],
    "komitet wyborczy akcji wyborczej solidarność": [OTHER_PARTY],
    'komitet wyborczy akcji wyborczej "solidarność"': [OTHER_PARTY],
    'komitet wyborczy akcji wyborczej "solidarność" aws': [OTHER_PARTY],
    'komitet wyborczy akcji wyborczej"solidarność': [OTHER_PARTY],
    "komitet wyborczy akcji wyborczwj solidarność": [OTHER_PARTY],
    'komitet "akcji wyborczej solidarność"': [OTHER_PARTY],
    "komitet wyborczy-akcja wyborcza solidarność": [OTHER_PARTY],
    "komitet wyborczy - akcja wyborcza solidarność": [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarnoˇć": [OTHER_PARTY],
    'komitet wyborczy "akcja wyborzcza solidarność"': [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarność akcja wyborcza solidarność": [
        OTHER_PARTY
    ],
    "komitet wyborczy akcja wyborcza solidarność"
    " komitet wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "komitet wyborczy akcja wyborcza solidarność 00-154 warszawa ul. dzielna 7": [
        OTHER_PARTY
    ],
    "komitet wyborczy akcja wyborcza solidarność-skl": [OTHER_PARTY],
    "krajowy komitet wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    'krajowy komitet wyborczy akcja wyborcza solidarność "aws"': [OTHER_PARTY],
    "krajowy komitet akcja wyborcza solidarność": [OTHER_PARTY],
    "krajowy wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "akcja wyborcza solidarność": [OTHER_PARTY],
    '"akcja wyborcza solidarność"': [OTHER_PARTY],
    'akcja wyborcza "solidarność"': [OTHER_PARTY],
    "akcja wyborcza solidarność (aws)": [OTHER_PARTY],
    "akcja wyborcza solidarność /aws/": [OTHER_PARTY],
    "akcja wyborcza solidarność/aws/": [OTHER_PARTY],
    "akcja wyborcza solidarność/aws/ solidarność": [OTHER_PARTY],
    "akcja wyborcza solidarność - komitet wyborczy koalicyjny": [OTHER_PARTY],
    "akcja wyborcz solidarność - komitet wyborczy koalicyjny": [OTHER_PARTY],
    "[komitet wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    '"omitet wyborczy akcja wyborcza solidarność': [OTHER_PARTY],
    "womitet wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "rygielt wyborczy akcja wyborcza solidarność": [OTHER_PARTY],
    "mieczkowskiorczy akcja wyborcza solidarność": [OTHER_PARTY],
    "koalicyjny komitet wyborczy - akcja wyborcza solidarność prawicy": [OTHER_PARTY],
    # Samoobrona, under each name it stood by: Samoobrona - Leppera in 1993,
    # Przymierze Samoobrona in 1997, Nasz Dom Polska - Samoobrona Andrzeja
    # Leppera in 2010-11, and its splinters Samoobrona Patriotyczna and
    # Samoobrona Odrodzenie. From 2002, 'KW' or 'Komitet Wyborczy' without
    # 'Wyborców' is a party's own committee, wherever it ran. The 1998
    # 'Samoobrona' lists ran in five voivodeships, so they are the party's too.
    # Not 'Samoobrona Ekologiczna Rolników „Pronatura”', 'Samoobrona Tatrzańska'
    # or a KWW that only borrows the word.
    "kw samoobrona rzeczypospolitej polskiej": [OTHER_PARTY],
    "komitet wyborczy samoobrona rzeczypospolitej polskiej": [OTHER_PARTY],
    "komitet wyborczy samoobrona rzeczpospolitej polskiej": [OTHER_PARTY],
    "kw samoobrona rp": [OTHER_PARTY],
    "kw samoobrona": [OTHER_PARTY],
    "komitet wyborczy samoobrona": [OTHER_PARTY],
    'komitet wyborczy "samoobrona"': [OTHER_PARTY],
    "komitet wyborczy \"samoobrona'": [OTHER_PARTY],
    "samoobrona - leppera": [OTHER_PARTY],
    "krajowy komitet wyborczy samoobrona - leppera": [OTHER_PARTY],
    "rada krajowa przymierze samoobrona": [OTHER_PARTY],
    "komitet wyborczy nasz dom polska - samoobrona andrzeja leppera": [OTHER_PARTY],
    "komitet wyborczy nasz dom polska-samoobrona andrzeja leppera": [OTHER_PARTY],
    "komitet wyborczy samoobrona patriotyczna": [OTHER_PARTY],
    "komitet wyborczy samoobrona odrodzenie": [OTHER_PARTY],
    # Unia Wolności. In 1997 and 1998 its lists were registered by the party's
    # board, 'Zarząd Unii Wolności'. Unia Demokratyczna, which it grew out of in
    # 1994, is not here: nobody has decided it.
    "zarząd unii wolności": [OTHER_PARTY],
    "zarząd unii wolności.": [OTHER_PARTY],
    "zarzad unii wolnosci": [OTHER_PARTY],
    "zarząd unii wolnośc": [OTHER_PARTY],
    "zarząd unia wolności": [OTHER_PARTY],
    "unia wolności zarząd krajowy": [OTHER_PARTY],
    "komitet wyborczy zarządu unii wolności": [OTHER_PARTY],
    "komitet wyborczy unii wolności": [OTHER_PARTY],
    "komitet wyborczy unia wolności": [OTHER_PARTY],
    'komitet wyborczy "unia wolności"': [OTHER_PARTY],
    "komitet unii wolności": [OTHER_PARTY],
    "unia wolności": [OTHER_PARTY],
    "unii wolności": [OTHER_PARTY],
    # Joint 1998 lists of AWS, UW and UPR with each other, or with ROP and SKL.
    "komitet wyborczy rs aws-uw": [OTHER_PARTY],
    "komitet wyborczy koalicja unia wolności - upr": [OTHER_PARTY],
    'komitet wyborczy "koalicja unia wolności - upr"': [OTHER_PARTY],
    'komitet wyborczy "unia wolności i unia polityki realnej"': [OTHER_PARTY],
    "koalicja aws - chrześcijańskie forum rop": [OTHER_PARTY],
    "komitet wyborczy koalicja aws - chrześcijańskie forum rop": [OTHER_PARTY],
    # Liga Polskich Rodzin.
    "kw liga polskich rodzin": [OTHER_PARTY],
    "komitet wyborczy liga polskich rodzin": [OTHER_PARTY],
    # Kukiz'15: the Sejm list of 2015, the sejmik lists of 2018 in all sixteen
    # voivodeships, and its Senat committee of 2019. Not the town KWWs of 2018
    # that put the name beside their own.
    "komitet wyborczy wyborców „kukiz'15”": [OTHER_PARTY],
    "komitet wyborczy wyborców kukiz'15": [OTHER_PARTY],
    "komitet wyborczy wyborców kukiz15 do senatu": [OTHER_PARTY],
    # Ruch Patriotyczny „Ojczyzna”, which stood in all sixteen sejmiks in 1998.
    # Not 'Komitet Wyborczy Ruch Patriotyczny', another party's 2005 Sejm list,
    # nor 'Niezależny Ruch Patriotyczny Ojczyzna', one town's list.
    "komitet wyborczy ruch patriotyczny ojczyzna": [OTHER_PARTY],
    'komitet wyborczy ruch patriotyczny "ojczyzna"': [OTHER_PARTY],
    'komitet wyborczy "ruch patriotyczny ojczyzna"': [OTHER_PARTY],
    'komitet wyborczy"ruch patriotyczny ojczyzna"': [OTHER_PARTY],
    'komitet wyborczy "ruchu patriotycznego ojczyzna"': [OTHER_PARTY],
    '"komitet wyborczy ruch patriotyczny ojczyzna"': [OTHER_PARTY],
    "ruch patriotyczny ojczyzna": [OTHER_PARTY],
    'ruch patriotyczny "ojczyzna"': [OTHER_PARTY],
    '"ruch patriotyczny ojczyzna"': [OTHER_PARTY],
    "ruch patriotyczny-ojczyzna": [OTHER_PARTY],
    "patriet wyborczy ruch patriotyczny ojczyzna": [OTHER_PARTY],
    "pomitet wyborczy ruch patriotyczny ojczyzna": [OTHER_PARTY],
    "patriotyvyborczy ruch patriotyczny ojczyzna": [OTHER_PARTY],
    # Konfederacja Polski Niepodległej, and the KPN - Obóz Patriotyczny that
    # split from it.
    "konfederacja polski niepodległej": [OTHER_PARTY],
    'komitet wyborczy "konfederacja polski niepodległej"': [OTHER_PARTY],
    "kw konfederacji polski niepodległej": [OTHER_PARTY],
    "rada polityczna konfederacji polski niepodległej": [OTHER_PARTY],
    "ogólnopolski komitet wyborczy konfederacji polski niepodległej": [OTHER_PARTY],
    "komitet wyborczy konfederacja polski niepodległej - obóz patriotyczny": [
        OTHER_PARTY
    ],
    # Unia Polityki Realnej, also under its long name, Konserwatywno-Liberalna
    # Partia UPR, and its 2010 joint list with Prawica Rzeczypospolitej.
    # 'Platforma Janusza Korwin-Mikke' (2005) is left to the decision on
    # Konfederacja's predecessors.
    "unia polityki realnej": [OTHER_PARTY],
    "komitet wyborczy unia polityki realnej": [OTHER_PARTY],
    "komitet wyborczy unii polityki realnej": [OTHER_PARTY],
    "k-lp unia polityki realnej": [OTHER_PARTY],
    "konserwatywno-liberalna partia unia polityki realnej": [OTHER_PARTY],
    "kw konserwatywno-liberalna partia unia polityki realnej": [OTHER_PARTY],
    "kw konserwatywno-liberalnej partii unia polityki realnej": [OTHER_PARTY],
    "rada główna konserwatywno-liberalnej partii unia polityki realnej": [OTHER_PARTY],
    "rada główna konserwatywno - liberalnej partii unia polityki realnej": [
        OTHER_PARTY
    ],
    "rada główna konserwatywno-liberanlnej partii unia polityki realnej": [OTHER_PARTY],
    "rada główna konserwatywno-liberalna partii unii polityki realnej": [OTHER_PARTY],
    "rada glowna konserwatywno-liberalnej partii unia polityki realnej": [OTHER_PARTY],
    "prezydium rady głównej konserwatywno-liberalnej partii unia polityki realnej": [
        OTHER_PARTY
    ],
    "prezydium rady głównej konserwatywno-liberalnej partii unii polityki realnej": [
        OTHER_PARTY
    ],
    "prezydium rady głównej konserwatywno liberalnej partii unii polityki realnej": [
        OTHER_PARTY
    ],
    "prezydium rady głównej konserwatywno-liberalnej partii polityki"
    " realnej-warszawa": [OTHER_PARTY],
    "koalicyjny komitet wyborczy prawica rzeczypospolitej - upr": [OTHER_PARTY],
    # Polska Partia Pracy, and the longer name it stood under from 2010.
    "komitet wyborczy polska partia pracy": [OTHER_PARTY],
    "komitet wyborczy polska partia pracy - sierpień 80": [OTHER_PARTY],
    # Ruch Palikota, renamed Twój Ruch in 2013, and its 2014 European list with
    # Europa Plus.
    "komitet wyborczy ruch palikota": [OTHER_PARTY],
    "komitet wyborczy twój ruch": [OTHER_PARTY],
    "koalicyjny komitet wyborczy europa plus twój ruch": [OTHER_PARTY],
    # Polska Jest Najważniejsza. Not PiS: it split from PiS in 2010 and stood
    # against it in 2011.
    "komitet wyborczy polska jest najważniejsza": [OTHER_PARTY],
    # KPEiR: two parties share the abbreviation - Krajowa Partia Emerytów i
    # Rencistów and Krajowe Porozumienie Emerytów i Rencistów RP - and both are
    # here, with the Partia's 2004 European list with PLD.
    "kw krajowej partii emerytów i rencistów": [OTHER_PARTY],
    "komitet wyborczy krajowa partia emerytów i rencistów": [OTHER_PARTY],
    "komitet wyborczy krajowej partii emerytów i rencistów": [OTHER_PARTY],
    "rada naczelna krajowej partii emerytów i rencistów": [OTHER_PARTY],
    "rada naczelna krajowej partii emerytow i rencistow": [OTHER_PARTY],
    "krajowa partia emerytów i rencistów-rada oddziału miejskiego": [OTHER_PARTY],
    "koalicyjny komitet wyborczy kpeir-pld": [OTHER_PARTY],
    "prezydium rady naczelnej krajowego porozumienia emerytów i rencistów"
    " rzeczypospolitej polskiej": [OTHER_PARTY],
    "prezydium rady naczelnej krajowego porozumienia emerytow i rencistow"
    " rzeczypospolitej polskiej": [OTHER_PARTY],
    "kw krajowego porozumienia emerytów i rencistów rzeczypospolitej polskiej": [
        OTHER_PARTY
    ],
    "kw krajowego porozumienia emerytów i rencistów rp": [OTHER_PARTY],
    # Solidarna Polska and Porozumienie, on the lists they ran under their own
    # names. Most of the time both stood on PiS's lists, which say PiS. Polska
    # Razem is what Porozumienie was called until 2017.
    "komitet wyborczy solidarna polska zbigniewa ziobro": [OTHER_PARTY],
    "komitet wyborczy polska razem jarosława gowina": [OTHER_PARTY],
    "komitet wyborczy porozumienie jarosława gowina": [OTHER_PARTY],
}


def parties_of_committee(committee: str | None) -> list[str]:
    """The parties a committee stands for, or nothing if it is not known."""
    if not committee:
        return []
    return committee_to_party.get(normalise_committee(committee), [])
