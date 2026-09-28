"""What `KRSRegisterOwners` keeps of an odpis, and in which order it reads."""

import pandas as pd

from scrapers.krs import register
from scrapers.krs.register import (
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    KRSRegisterOwners,
    RegisterEntry,
    due_for_a_read,
    fetch_entry,
    iso_date,
    owner_share,
    summarise_odpis,
)

WOJEWODZTWO_POMORSKIE = {
    "nazwa": "WOJEWÓDZTWO POMORSKIE",
    "identyfikator": {"regon": "19167483600000"},
    "krs": {"krs": "0000000000"},
    "posiadaneUdzialy": "23.086 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 23.247.602,00 ZŁ.",
    "czyPosiadaCaloscUdzialow": False,
}
A_PERSON = {
    "nazwisko": {"nazwiskoICzlon": "U********"},
    "imiona": {"imie": "A********"},
    "identyfikator": {"pesel": "7**********"},
    "posiadaneUdzialy": "250 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 12.500,00 ZŁ",
}
PKP = {
    "nazwa": "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA",
    "identyfikator": {"regon": "00012680100000"},
    "krs": {"krs": "0000019193"},
}


def odpis(krs="0000225512", **dzial1) -> dict:
    """An OdpisAktualny with Pomorski Fundusz Pożyczkowy's header and seat."""
    return {
        "odpis": {
            "naglowekA": {
                "rejestr": "RejP",
                "numerKRS": krs,
                "dataOstatniegoWpisu": "13.08.2026",
            },
            "dane": {
                "dzial1": {
                    "danePodmiotu": {
                        "formaPrawna": "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
                        "identyfikatory": {
                            "regon": "19311336100000",
                            "nip": "5832878483",
                        },
                        "nazwa": "POMORSKI FUNDUSZ POŻYCZKOWY SPÓŁKA Z "
                        "OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
                    },
                    "siedzibaIAdres": {
                        "siedziba": {
                            "kraj": "POLSKA",
                            "wojewodztwo": "POMORSKIE",
                            "powiat": "M. GDAŃSK",
                            "gmina": "M. GDAŃSK",
                            "miejscowosc": "GDAŃSK",
                        }
                    },
                    "kapital": {
                        "wysokoscKapitaluZakladowego": {
                            "wartosc": "25673465,00",
                            "waluta": "PLN",
                        }
                    },
                    **dzial1,
                }
            },
        }
    }


def test_a_voivodeship_owner_is_kept_by_name():
    """Pomorski Fundusz Pożyczkowy: the owner the crawl never followed.

    The register writes a government owner with KRS 0000000000, which is kept
    as no KRS number at all - there is nothing there to follow.
    """
    entry = summarise_odpis(
        "0000225512", "P", odpis(wspolnicySpzoo=[WOJEWODZTWO_POMORSKIE]), "2026-09-28"
    )

    assert entry.status == STATUS_OK
    assert entry.owners == [
        {
            "name": "WOJEWÓDZTWO POMORSKIE",
            "krs": None,
            "regon": "19167483600000",
            "shares": "23.086 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 23.247.602,00 ZŁ.",
            "whole": False,
        }
    ]
    assert entry.capital == 25673465.0
    assert entry.wojewodztwo == "POMORSKIE"
    assert entry.nip == "5832878483"
    assert entry.last_entry == "2026-08-13"


def test_a_person_is_counted_and_not_kept():
    entry = summarise_odpis(
        "0000225512", "P", odpis(wspolnicySpzoo=[A_PERSON]), "2026-09-28"
    )

    assert entry.owners == []
    assert entry.person_owners == 1


def test_a_sole_shareholder_keeps_its_krs_number():
    entry = summarise_odpis(
        "0000076705", "P", odpis(jedynyAkcjonariusz=[PKP]), "2026-09-28"
    )

    assert [owner["krs"] for owner in entry.owners] == ["0000019193"]


def test_a_founding_organ_is_recorded():
    # SPZOZ Miejska Przychodnia Zdrowia w Ząbkach, founded by the town council
    entry = summarise_odpis(
        "0000043516",
        "S",
        odpis(
            "0000043516",
            organPodmiotZalozycielskiMinisterNadzorujacy={
                "nazwa": "RADA MIEJSKA W ZĄBKACH"
            },
        ),
        "2026-09-28",
    )

    assert entry.founding_organ
    assert entry.rejestr == "S"


def test_an_owners_share_is_its_value_over_the_capital():
    entry = summarise_odpis(
        "0000225512", "P", odpis(wspolnicySpzoo=[WOJEWODZTWO_POMORSKIE]), "2026-09-28"
    )

    assert owner_share(entry.owners[0], entry.capital) == 0.9055


def test_a_share_given_as_one_shares_value_is_not_taken_for_the_total():
    """GPEC: the city is 0.171, Stadtwerke Leipzig the other 0.829."""
    leipzig = {
        "shares": "171.003 (STO SIEDEMDZIESIĄT JEDEN TYSIĘCY TRZY) UDZIAŁY O "
        "ŁĄCZNEJ WARTOŚCI 171.003.000,00 ZŁ (STO SIEDEMDZIESIĄT JEDEN MILIONÓW "
        "TRZY TYSIĄCE ZŁ)"
    }
    gdansk = {"shares": "35.370 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 35.370.000,00 ZŁ"}

    assert owner_share(leipzig, 206373000.0) == 0.8286
    assert owner_share(gdansk, 206373000.0) == 0.1714


def test_a_sole_owner_is_the_whole_company_whatever_the_text():
    assert owner_share({"shares": None, "whole": True}, None) == 1.0
    assert owner_share({"shares": "100 UDZIAŁÓW"}, 5000.0) is None


def test_the_registers_date_is_read_day_first():
    assert iso_date("13.08.2026") == "2026-08-13"
    assert iso_date(None) is None


class Response:
    def __init__(self, status_code: int, body: dict | None = None):
        self.status_code = status_code
        self.body = body

    def json(self):
        return self.body


class Session:
    """Answers each register from a script, one response per request."""

    def __init__(self, **by_register: list[Response]):
        self.by_register = by_register
        self.asked: list[str] = []

    def get(self, url: str, timeout: float) -> Response:
        rejestr = url.split("rejestr=")[1][0]
        self.asked.append(rejestr)
        return self.by_register[rejestr].pop(0)


def fetch(session: Session, monkeypatch) -> RegisterEntry:
    monkeypatch.setattr(register.time, "sleep", lambda seconds: None)
    return fetch_entry(session, "0000225512", "2026-09-28", interval=0)  # type: ignore[arg-type]


NOT_FOUND = {"title": "Not Found", "status": 404}


def test_a_204_is_an_entry_that_was_struck_off(monkeypatch):
    # 0000758251 answers 204 in P and 404 in S; S is never needed.
    session = Session(P=[Response(204)])

    entry = fetch(session, monkeypatch)

    assert (entry.status, entry.rejestr) == (STATUS_STRUCK_OFF, "P")
    assert session.asked == ["P"]


def test_the_other_register_is_asked_when_the_first_has_nothing(monkeypatch):
    session = Session(
        P=[Response(404, NOT_FOUND)],
        S=[Response(200, odpis(wspolnicySpzoo=[WOJEWODZTWO_POMORSKIE]))],
    )

    entry = fetch(session, monkeypatch)

    assert (entry.status, entry.rejestr) == (STATUS_OK, "S")


def test_a_not_found_body_on_a_200_is_a_miss_too(monkeypatch):
    session = Session(P=[Response(200, NOT_FOUND)], S=[Response(404, NOT_FOUND)])

    assert fetch(session, monkeypatch).status == STATUS_NOT_FOUND


def test_a_server_error_is_a_failure_to_ask_again(monkeypatch):
    session = Session(P=[Response(503), Response(503), Response(503)])

    entry = fetch(session, monkeypatch)

    assert entry.status == STATUS_FAILED
    assert session.asked == ["P", "P", "P"]


def bulletin(*rows: tuple[str, str]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["krs", "date"])


def ledger(*rows: tuple[str, str, str]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"krs": krs, "swept": swept, "status": status} for krs, swept, status in rows]
    )


def test_a_first_sweep_reads_the_oldest_numbers_first():
    due = due_for_a_read(
        ledger(),
        bulletin(("0000900000", "2026-09-01"), ("225512", "2026-08-13")),
    )

    assert due == ["0000225512", "0000900000"]


def test_failures_then_moved_entries_then_new_ones():
    due = due_for_a_read(
        ledger(
            ("0000000500", "2026-09-10", STATUS_OK),  # up to date
            ("0000000400", "2026-07-01", STATUS_OK),  # moved on 2026-08-13
            ("0000900000", "2026-09-10", STATUS_FAILED),
        ),
        bulletin(
            ("0000000500", "2026-08-13"),
            ("0000000400", "2026-08-13"),
            ("0000900000", "2026-08-13"),
            ("0000000300", "2026-08-13"),
            ("0000000200", "2026-08-13"),
        ),
    )

    assert due == ["0000900000", "0000000400", "0000000200", "0000000300"]


def test_nothing_is_fetched_without_a_limit(monkeypatch):
    """A refresh reached through a dependency must not start a 700k sweep."""

    class Ctx:
        pass

    carried = ledger(("0000225512", "2026-09-28", STATUS_OK))
    pipeline = KRSRegisterOwners()
    monkeypatch.setattr(pipeline, "ledger", lambda ctx: carried)
    monkeypatch.setattr(
        register.requests,
        "Session",
        lambda: (_ for _ in ()).throw(AssertionError("fetched")),
    )

    assert pipeline.process(Ctx()) is carried  # type: ignore[arg-type]
