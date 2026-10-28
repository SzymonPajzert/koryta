"""Prawdziwe odpowiedzi API rejestrumow.gov.pl, wspólne dla testów scrapera."""

import copy
from typing import Any

import pytest

SEARCH_RESPONSE: dict[str, Any] = {
    "content": [
        {
            "idUmowy": "00008114-9087-4c3e-adbd-68183eb30998",
            "nazwa": "KOMENDA WOJEWÓDZKA POLICJI Z SIEDZIBĄ W RADOMIU",
            "regon": "670897379",
            "dataZawarciaUmowy": "22.07.2026",
            "dataZakonczeniaUmowy": None,
            "wartoscPrzedmiotuUmowy": 3048.78,
            "przedmiotUmowy": "Światło chemiczne typu lightstick",
            "statusUmowy": "Aktywna",
        }
    ],
    "totalElements": 61223,
    "totalMatchingElements": 61223,
    "offset": 0,
    "limit": 2,
}

DETAILS_RESPONSE: dict[str, Any] = {
    "idUmowy": "00008114-9087-4c3e-adbd-68183eb30998",
    "podstawoweDane": {
        "statusUmowy": "Aktywna",
        "numerUmowy": "GMT-5637/26",
        "brakNumeruUmowy": False,
        "dataZawarciaUmowy": "22.07.2026",
        "dataZakonczeniaUmowy": None,
    },
    "okresObowiazywania": {"umowaNaCzasNieoznaczony": False, "okres": "1 miesiąc"},
    "szczegolyUmowy": {
        "przedmiotUmowy": "Światło chemiczne typu lightstick",
        "niejawnoscPrzedmiotu": None,
        "wartoscPrzedmiotu": 3048.78,
        "niejawnoscWartosciPrzedmiotu": None,
        "opisWartosciPrzedmiotu": None,
    },
    "stronyUmowy": [
        {
            "kraj": "Polska",
            "rodzaj": "JSFP",
            "nazwa": "KOMENDA WOJEWÓDZKA POLICJI Z SIEDZIBĄ W RADOMIU",
            "nip": "7962234609",
            "regon": "670897379",
            "imie": None,
            "nazwisko": None,
            "czyKonsorcjum": None,
            "daneAdresowe": {
                "ulica": "ul. 11 Listopada",
                "numerNieruchomosci": "37/59",
                "numerLokalu": None,
                "wojewodztwo": "MAZOWIECKIE",
                "powiat": "Radom",
                "gminaMiastoDzielnica": "Radom",
                "miejscowosc": "Radom",
                "kodPocztowy": "26-600",
            },
            "niejawnoscStrony": None,
        }
    ],
    "finansowanaZeSrodkow": True,
    "zmianyUmowy": [],
    "dataPublikacji": "22.07.2026",
    "dataModyfikacji": "22.07.2026",
}


@pytest.fixture
def search_response() -> dict[str, Any]:
    """Strona wyników wyszukiwania (`POST /api-dp/v1/agreements/search`)."""
    return copy.deepcopy(SEARCH_RESPONSE)


@pytest.fixture
def details_response() -> dict[str, Any]:
    """Detale umowy z tej strony (`GET /api-dp/v1/agreement/{idUmowy}`)."""
    return copy.deepcopy(DETAILS_RESPONSE)
