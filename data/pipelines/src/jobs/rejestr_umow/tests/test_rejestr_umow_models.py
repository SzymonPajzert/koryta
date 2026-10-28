"""Testy parsowania modeli na realnych odpowiedziach API (round-trip)."""

from jobs.rejestr_umow.scraper.models import (
    AgreementDetails,
    AgreementSearchResult,
    SearchPage,
)


def test_search_result_roundtrip(search_response):
    item = search_response["content"][0]
    result = AgreementSearchResult.from_dict(item)
    assert result.id_umowy == "00008114-9087-4c3e-adbd-68183eb30998"
    assert result.wartosc_przedmiotu_umowy == 3048.78
    assert result.to_dict() == item


def test_search_page(search_response):
    page = SearchPage.from_dict(search_response)
    assert page.total_elements == 61223
    assert len(page.content) == 1
    assert page.content[0].status_umowy == "Aktywna"


def test_details_roundtrip(details_response):
    details = AgreementDetails.from_dict(details_response)
    assert details.id_umowy == "00008114-9087-4c3e-adbd-68183eb30998"
    assert details.podstawowe_dane.numer_umowy == "GMT-5637/26"
    assert details.strony_umowy[0].dane_adresowe.kod_pocztowy == "26-600"
    assert details.to_dict() == details_response
