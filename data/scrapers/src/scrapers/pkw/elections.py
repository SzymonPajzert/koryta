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


committee_to_party = {
    "komitet wyborczy prawo i sprawiedliwość": "PiS",
    "komitet wyborczy platforma obywatelska rp": "PO",
    "komitet wyborczy akcja wyborcza solidarność": "AWS",
    "komitet wyborczy polskie stronnictwo ludowe": "PSL",
    "koalicyjny kw sojusz lewicy demokratycznej - unia pracy": "SLD",
    "kw samoobrona rzeczypospolitej polskiej": "Samoobrona",
    "krajowy komitet wyborczy przymierze społeczne: psl-up-kpeir": "PSL",
    "komitet wyborczy wyborców plus": "KWW Plus",
    "kw polskiego stronnictwa ludowego": "PSL",
    "komitet wyborczy sojusz lewicy demokratycznej": "SLD",
    "kw prawo i sprawiedliwość": "PiS",
    "krajowy komitet wyborczy sojuszu lewicy demokratycznej": "SLD",
    "zarząd unii wolności": "UW",
    "koalicyjny komitet wyborczy sld lewica razem": "SLD",
    "naczelny komitet wykonawczy polskiego stronnictwa ludowego": "PSL",
    "kww plus": "KWW Plus",
    "kkw koalicja obywatelska": "KO",
    "komitet wyborczy polskiego stronnictwa ludowego": "PSL",
    "koalicyjny kw platforma obywatelska - prawo i sprawiedliwość": "PO+PiS",
    "koalicyjny komitet wyborczy platforma.nowoczesna koalicja obywatelska": "KO",
    "kkw trzecia droga psl-pl2050 szymona hołowni": "PSL",
    "koalicyjny komitet wyborczy sld+sdpl+pd+up lewica i demokraci": "SLD",
    "komitet wyborczy nowa prawica — janusza korwin-mikke": "Konfederacja",
    "kkw lewica": "SLD",
    "kww konfederacja i bezpartyjni samorządowcy": "Konfederacja",
    "kw platforma obywatelska rzeczypospolitej polskiej": "PO",
}
