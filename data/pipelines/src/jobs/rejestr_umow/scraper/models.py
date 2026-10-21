"""Modele danych dla wyników wyszukiwania i detali umowy.

Oparte o `dataclasses` z biblioteki standardowej (bez zależności zewnętrznych).
Każdy model ma:
- `from_dict()` — budowa z surowego JSON-a zwróconego przez API,
- `to_dict()`   — serializacja z powrotem do JSON-a (do zapisu w repozytorium).

Klucze w `to_dict()` celowo zachowują oryginalne (polskie) nazwy pól API,
dzięki czemu zapisany JSON jest wierny źródłu i łatwy do porównania.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# --- Wyniki wyszukiwania -----------------------------------------------------

@dataclass
class AgreementSearchResult:
    """Pojedyncza pozycja z listy wyszukiwania (`content[]`)."""

    id_umowy: str
    nazwa: Optional[str] = None
    regon: Optional[str] = None
    data_zawarcia_umowy: Optional[str] = None
    data_zakonczenia_umowy: Optional[str] = None
    wartosc_przedmiotu_umowy: Optional[float] = None
    przedmiot_umowy: Optional[str] = None
    status_umowy: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgreementSearchResult":
        return cls(
            id_umowy=data["idUmowy"],
            nazwa=data.get("nazwa"),
            regon=data.get("regon"),
            data_zawarcia_umowy=data.get("dataZawarciaUmowy"),
            data_zakonczenia_umowy=data.get("dataZakonczeniaUmowy"),
            wartosc_przedmiotu_umowy=data.get("wartoscPrzedmiotuUmowy"),
            przedmiot_umowy=data.get("przedmiotUmowy"),
            status_umowy=data.get("statusUmowy"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "idUmowy": self.id_umowy,
            "nazwa": self.nazwa,
            "regon": self.regon,
            "dataZawarciaUmowy": self.data_zawarcia_umowy,
            "dataZakonczeniaUmowy": self.data_zakonczenia_umowy,
            "wartoscPrzedmiotuUmowy": self.wartosc_przedmiotu_umowy,
            "przedmiotUmowy": self.przedmiot_umowy,
            "statusUmowy": self.status_umowy,
        }


@dataclass
class SearchPage:
    """Opakowanie odpowiedzi endpointu wyszukiwania."""

    content: list[AgreementSearchResult]
    total_elements: int
    total_matching_elements: int
    offset: int
    limit: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SearchPage":
        return cls(
            content=[
                AgreementSearchResult.from_dict(item)
                for item in data.get("content", [])
            ],
            total_elements=data.get("totalElements", 0),
            total_matching_elements=data.get("totalMatchingElements", 0),
            offset=data.get("offset", 0),
            limit=data.get("limit", 0),
        )


# --- Detale umowy ------------------------------------------------------------

@dataclass
class PodstawoweDane:
    status_umowy: Optional[str] = None
    numer_umowy: Optional[str] = None
    brak_numeru_umowy: Optional[bool] = None
    data_zawarcia_umowy: Optional[str] = None
    data_zakonczenia_umowy: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> "PodstawoweDane":
        data = data or {}
        return cls(
            status_umowy=data.get("statusUmowy"),
            numer_umowy=data.get("numerUmowy"),
            brak_numeru_umowy=data.get("brakNumeruUmowy"),
            data_zawarcia_umowy=data.get("dataZawarciaUmowy"),
            data_zakonczenia_umowy=data.get("dataZakonczeniaUmowy"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "statusUmowy": self.status_umowy,
            "numerUmowy": self.numer_umowy,
            "brakNumeruUmowy": self.brak_numeru_umowy,
            "dataZawarciaUmowy": self.data_zawarcia_umowy,
            "dataZakonczeniaUmowy": self.data_zakonczenia_umowy,
        }


@dataclass
class OkresObowiazywania:
    umowa_na_czas_nieoznaczony: Optional[bool] = None
    okres: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> "OkresObowiazywania":
        data = data or {}
        return cls(
            umowa_na_czas_nieoznaczony=data.get("umowaNaCzasNieoznaczony"),
            okres=data.get("okres"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "umowaNaCzasNieoznaczony": self.umowa_na_czas_nieoznaczony,
            "okres": self.okres,
        }


@dataclass
class SzczegolyUmowy:
    przedmiot_umowy: Optional[str] = None
    niejawnosc_przedmiotu: Optional[Any] = None
    wartosc_przedmiotu: Optional[float] = None
    niejawnosc_wartosci_przedmiotu: Optional[Any] = None
    opis_wartosci_przedmiotu: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> "SzczegolyUmowy":
        data = data or {}
        return cls(
            przedmiot_umowy=data.get("przedmiotUmowy"),
            niejawnosc_przedmiotu=data.get("niejawnoscPrzedmiotu"),
            wartosc_przedmiotu=data.get("wartoscPrzedmiotu"),
            niejawnosc_wartosci_przedmiotu=data.get("niejawnoscWartosciPrzedmiotu"),
            opis_wartosci_przedmiotu=data.get("opisWartosciPrzedmiotu"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "przedmiotUmowy": self.przedmiot_umowy,
            "niejawnoscPrzedmiotu": self.niejawnosc_przedmiotu,
            "wartoscPrzedmiotu": self.wartosc_przedmiotu,
            "niejawnoscWartosciPrzedmiotu": self.niejawnosc_wartosci_przedmiotu,
            "opisWartosciPrzedmiotu": self.opis_wartosci_przedmiotu,
        }


@dataclass
class DaneAdresowe:
    ulica: Optional[str] = None
    numer_nieruchomosci: Optional[str] = None
    numer_lokalu: Optional[str] = None
    wojewodztwo: Optional[str] = None
    powiat: Optional[str] = None
    gmina_miasto_dzielnica: Optional[str] = None
    miejscowosc: Optional[str] = None
    kod_pocztowy: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> "DaneAdresowe":
        data = data or {}
        return cls(
            ulica=data.get("ulica"),
            numer_nieruchomosci=data.get("numerNieruchomosci"),
            numer_lokalu=data.get("numerLokalu"),
            wojewodztwo=data.get("wojewodztwo"),
            powiat=data.get("powiat"),
            gmina_miasto_dzielnica=data.get("gminaMiastoDzielnica"),
            miejscowosc=data.get("miejscowosc"),
            kod_pocztowy=data.get("kodPocztowy"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "ulica": self.ulica,
            "numerNieruchomosci": self.numer_nieruchomosci,
            "numerLokalu": self.numer_lokalu,
            "wojewodztwo": self.wojewodztwo,
            "powiat": self.powiat,
            "gminaMiastoDzielnica": self.gmina_miasto_dzielnica,
            "miejscowosc": self.miejscowosc,
            "kodPocztowy": self.kod_pocztowy,
        }


@dataclass
class StronaUmowy:
    kraj: Optional[str] = None
    rodzaj: Optional[str] = None
    nazwa: Optional[str] = None
    nip: Optional[str] = None
    regon: Optional[str] = None
    imie: Optional[str] = None
    nazwisko: Optional[str] = None
    czy_konsorcjum: Optional[bool] = None
    niejawnosc_strony: Optional[Any] = None
    dane_adresowe: Optional[DaneAdresowe] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StronaUmowy":
        return cls(
            kraj=data.get("kraj"),
            rodzaj=data.get("rodzaj"),
            nazwa=data.get("nazwa"),
            nip=data.get("nip"),
            regon=data.get("regon"),
            imie=data.get("imie"),
            nazwisko=data.get("nazwisko"),
            czy_konsorcjum=data.get("czyKonsorcjum"),
            niejawnosc_strony=data.get("niejawnoscStrony"),
            dane_adresowe=DaneAdresowe.from_dict(data.get("daneAdresowe")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kraj": self.kraj,
            "rodzaj": self.rodzaj,
            "nazwa": self.nazwa,
            "nip": self.nip,
            "regon": self.regon,
            "imie": self.imie,
            "nazwisko": self.nazwisko,
            "czyKonsorcjum": self.czy_konsorcjum,
            "niejawnoscStrony": self.niejawnosc_strony,
            "daneAdresowe": (
                self.dane_adresowe.to_dict() if self.dane_adresowe else None
            ),
        }


@dataclass
class AgreementDetails:
    """Pełne detale umowy z endpointu `/api-dp/v1/agreement/{id}`."""

    id_umowy: str
    podstawowe_dane: PodstawoweDane = field(default_factory=PodstawoweDane)
    okres_obowiazywania: OkresObowiazywania = field(
        default_factory=OkresObowiazywania
    )
    szczegoly_umowy: SzczegolyUmowy = field(default_factory=SzczegolyUmowy)
    strony_umowy: list[StronaUmowy] = field(default_factory=list)
    finansowana_ze_srodkow: Optional[bool] = None
    zmiany_umowy: list[Any] = field(default_factory=list)
    data_publikacji: Optional[str] = None
    data_modyfikacji: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgreementDetails":
        return cls(
            id_umowy=data["idUmowy"],
            podstawowe_dane=PodstawoweDane.from_dict(data.get("podstawoweDane")),
            okres_obowiazywania=OkresObowiazywania.from_dict(
                data.get("okresObowiazywania")
            ),
            szczegoly_umowy=SzczegolyUmowy.from_dict(data.get("szczegolyUmowy")),
            strony_umowy=[
                StronaUmowy.from_dict(s) for s in data.get("stronyUmowy", [])
            ],
            finansowana_ze_srodkow=data.get("finansowanaZeSrodkow"),
            zmiany_umowy=data.get("zmianyUmowy", []),
            data_publikacji=data.get("dataPublikacji"),
            data_modyfikacji=data.get("dataModyfikacji"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "idUmowy": self.id_umowy,
            "podstawoweDane": self.podstawowe_dane.to_dict(),
            "okresObowiazywania": self.okres_obowiazywania.to_dict(),
            "szczegolyUmowy": self.szczegoly_umowy.to_dict(),
            "stronyUmowy": [s.to_dict() for s in self.strony_umowy],
            "finansowanaZeSrodkow": self.finansowana_ze_srodkow,
            "zmianyUmowy": self.zmiany_umowy,
            "dataPublikacji": self.data_publikacji,
            "dataModyfikacji": self.data_modyfikacji,
        }
