from typing import Any


def get_election_type(election_type: str) -> str:
    # TODO this should be well typed
    match election_type.lower():
        case "sejmu":
            return "Sejm"
        case "senatu":
            return "Senat"
        case "prezydenckie":
            return "Prezydent"
        case "samorządu":
            return "Samorząd"
        case "europarlamentu":
            return "Parlament Europejski"

    raise ValueError(f"Unknown election type: {election_type}")


COMMITTEE_MAP = {
    "Komitet Wyborczy Liga Polskich Rodzin": "LPR",
    "Komitet Wyborczy Polskie Stronnictwo Ludowe": "PSL",
    "Komitet Wyborczy Prawo I Sprawiedliwość": "PiS",
    "Koalicyjny Komitet Wyborczy Trzecia Droga Polska 2050 \
Szymona Hołowni - Polskie Stronnictwo Ludowe": [
        "PSL",
        "PL2050",
    ],
    "Komitet Wyborczy Platforma Obywatelska RP": "PO",
    "Komitet Wyborczy Sojusz Lewicy Demokratycznej": "SLD",
    "Komitet Wyborczy Polskie Stronnictwo Ludowe - Porozumienie Ludowe": "PSL",
    "Komitet Wyborczy Polskie Stronnictwo Ludowe - Ruch Ludowy": "PSL",
    "Komitet Wyborczy Polskie Stronnictwo Ludowe - Samoobrona": "PSL",
    "Komitet Wyborczy Polskie Stronnictwo Ludowe - Unia Pracy": "PSL",
    "Komitet Wyborczy Nowa Lewica": "Nowa Lewica",
    "Komitet Wyborczy Polska Jest Najważniejsza": "PiS",
}

# TODO we need a better logic than this
IGNORE_COMMITTEES = {
    "Kww Romuald Antosik",
    "Komitet Wyborczy Wyborców Razem Dla Gminy Opatówek",
    "Komitet Wyborczy Wyborców Wspólny Kalisz",
    "Komitet Wyborczy Wyborców Spoza Sitwy",
    # TODO - should we care about them?
    "Komitet Wyborczy Wyborców „Kukiz'15”",
    "Komitet Wyborczy Twój Ruch",
    "Kw Samoobrona",
}


def get_party_from_elections(elections: list[dict[str, Any]]) -> list[str]:
    party = set()
    for e in elections:
        if "committee" in e:
            if e["committee"].title() in IGNORE_COMMITTEES:
                continue

            party_new = COMMITTEE_MAP.get(e["committee"].title(), "")
            if isinstance(party_new, list):
                party |= set(party_new)
            else:
                party.add(party_new)
        else:
            if e["election_type"] == "Parlament Europejski":
                continue
            if int(e["election_year"]) < 2006:
                # TODO support it at one point
                continue

    return list(party)
