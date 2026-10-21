"""Testy parsowania modeli na realnych odpowiedziach API (round-trip)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper.models import AgreementDetails, AgreementSearchResult, SearchPage

SEARCH_RESPONSE = {
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

DETAILS_RESPONSE = {
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


def test_search_result_roundtrip():
    result = AgreementSearchResult.from_dict(SEARCH_RESPONSE["content"][0])
    assert result.id_umowy == "00008114-9087-4c3e-adbd-68183eb30998"
    assert result.wartosc_przedmiotu_umowy == 3048.78
    assert result.to_dict() == SEARCH_RESPONSE["content"][0]


def test_search_page():
    page = SearchPage.from_dict(SEARCH_RESPONSE)
    assert page.total_elements == 61223
    assert len(page.content) == 1
    assert page.content[0].status_umowy == "Aktywna"


def test_details_roundtrip():
    details = AgreementDetails.from_dict(DETAILS_RESPONSE)
    assert details.id_umowy == "00008114-9087-4c3e-adbd-68183eb30998"
    assert details.podstawowe_dane.numer_umowy == "GMT-5637/26"
    assert details.strony_umowy[0].dane_adresowe.kod_pocztowy == "26-600"
    assert details.to_dict() == DETAILS_RESPONSE


if __name__ == "__main__":
    test_search_result_roundtrip()
    test_search_page()
    test_details_roundtrip()
    print("OK — wszystkie testy przeszły")
