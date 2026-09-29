"""What the ledger keeps of an odpis, how the log folds into it, and read order."""

import gzip

import pandas as pd

from scrapers.krs.register import (
    REASON_FAILED,
    REASON_MOVED,
    REASON_NEVER,
    RESPONSE_LOG,
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    KRSRegisterEntries,
    RegisterRead,
    due_for_a_read,
    fold,
    iso_date,
    owner_share,
    queue_for_a_read,
    summarise_odpis,
)
from scrapers.tests.mocks import MockIO

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


def test_a_total_is_read_however_the_register_words_it():
    """Zabrzańska Agencja Realizacji Inwestycji, PAZIM and three more ways."""
    zabrze = {"shares": "293.479 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 14.673.950,00 ZŁ"}
    pzm = {
        "shares": "34338 (TRZYDZIEŚCI CZTERY TYSIĄCE TRZYSTA TRZYDZIEŚCI OSIEM) "
        "UDZIAŁÓW O ŁĄCZNEJ WYSOKOŚCI 70135365,00 (SIEDEMDZIESIĄT MILIONÓW) ZŁ"
    }
    joined = {"shares": "40701 UDZIAŁÓW OŁĄCZNEJ WYSOKOŚCI 83131792,50ZŁ"}
    kwota = {"shares": "95 UDZIAŁÓW NA ŁACZNĄ KWOTĘ 95.000 ZŁ"}
    wysokosc = {"shares": "100 UDZIAŁÓW, ŁĄCZNA WYSOKOŚĆ 50.000,00 ZŁ."}
    kwocie = {"shares": "500 UDZIAŁÓW W ŁĄCZNEJ KWOCIE 750.000,00 ZŁ"}

    assert owner_share(zabrze, 14678950.0) == 0.9997
    assert owner_share(pzm, 153267157.5) == 0.4576
    assert owner_share(joined, 153267157.5) == 0.5424
    assert owner_share(kwota, 880000.0) == 0.108
    assert owner_share(wysokosc, 100000.0) == 0.5
    assert owner_share(kwocie, 2295000.0) == 0.3268


def test_a_sole_owner_is_the_whole_company_whatever_the_text():
    assert owner_share({"shares": None, "whole": True}, None) == 1.0
    assert owner_share({"shares": "100 UDZIAŁÓW"}, 5000.0) is None


def test_the_registers_date_is_read_day_first():
    assert iso_date("13.08.2026") == "2026-08-13"
    assert iso_date(None) is None


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


def test_the_reasons_follow_the_order():
    queue = queue_for_a_read(
        ledger(
            ("0000000400", "2026-07-01", STATUS_OK),
            ("0000900000", "2026-09-10", STATUS_FAILED),
        ),
        bulletin(
            ("0000000400", "2026-08-13"),
            ("0000900000", "2026-08-13"),
            ("0000000200", "2026-08-13"),
        ),
    )

    assert [(q.krs, q.reason) for q in queue] == [
        ("0000900000", REASON_FAILED),
        ("0000000400", REASON_MOVED),
        ("0000000200", REASON_NEVER),
    ]


def read(krs="0000225512", read_at="2026-09-28T16:41:18+02:00", status=STATUS_OK, **kw):
    if status == STATUS_OK:
        kw.setdefault("rejestr", "P")
        kw.setdefault("body", odpis(krs, wspolnicySpzoo=[WOJEWODZTWO_POMORSKIE]))
    return RegisterRead(krs=krs, read_at=read_at, status=status, **kw)


def test_a_read_survives_a_line_of_the_log():
    original = read(run="0192-run")

    assert RegisterRead.from_line(original.to_line()) == original


def test_a_line_from_a_newer_writer_still_reads():
    line = read().to_line()[:-1] + ', "added_later": 1}'

    assert RegisterRead.from_line(line).krs == "0000225512"


def test_an_odpis_folds_into_the_entry_it_summarises():
    [entry] = fold([read()])

    assert entry == summarise_odpis(
        "0000225512", "P", odpis(wspolnicySpzoo=[WOJEWODZTWO_POMORSKIE]), "2026-09-28"
    )


def test_a_failure_never_overwrites_an_answer():
    """A read that did not come back says nothing about the company."""
    [entry] = fold(
        [read(), read(read_at="2026-10-02T09:00:00+02:00", status=STATUS_FAILED)]
    )

    assert (entry.status, entry.swept, entry.name) == (
        STATUS_OK,
        "2026-09-28",
        "POMORSKI FUNDUSZ POŻYCZKOWY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    )


def test_the_newest_answer_wins():
    later = read(
        read_at="2026-10-02T09:00:00+02:00", status=STATUS_STRUCK_OFF, rejestr="P"
    )

    [entry] = fold([later, read()])

    assert (entry.status, entry.swept) == (STATUS_STRUCK_OFF, "2026-10-02")


def test_at_the_same_moment_an_odpis_beats_a_miss():
    same = "2026-09-28T00:00:00+02:00"

    [entry] = fold([read(read_at=same, status=STATUS_NOT_FOUND), read(read_at=same)])

    assert entry.status == STATUS_OK


def test_only_failures_leave_a_failure_to_ask_again():
    [entry] = fold([read(status=STATUS_FAILED, rejestr="P", error="HTTP 503")])

    assert (entry.status, entry.rejestr) == (STATUS_FAILED, "P")


def test_the_clocks_are_compared_as_moments_not_text():
    """Across a DST change the offsets differ, and text order would lie."""
    summer = read(
        read_at="2026-10-25T02:30:00+02:00", status=STATUS_STRUCK_OFF, rejestr="P"
    )
    winter = read(read_at="2026-10-25T02:15:00+01:00")  # 45 minutes later

    [entry] = fold([summer, winter])

    assert entry.status == STATUS_OK


class LogIO(MockIO):
    """A MockIO whose bucket holds `RESPONSE_LOG` parts."""

    def __init__(self, *parts: list[RegisterRead]):
        super().__init__()
        self.parts = {
            f"part-{i}": gzip.compress(
                "".join(r.to_line() + "\n" for r in reads).encode()
            )
            for i, reads in enumerate(parts)
        }
        self.asked: list = []

    def list_files(self, path):
        self.asked.append(path)
        yield from self.parts

    def read_data(self, fs):
        data = self.parts[fs]

        class Part:
            def read_bytes(self):
                return data

        return Part()


def test_the_ledger_is_a_fold_of_every_part_in_the_log():
    io = LogIO(
        [read(), read("0000000001", status=STATUS_FAILED, rejestr="P")],
        [
            read(
                "0000000001",
                read_at="2026-09-29T10:00:00+02:00",
                status=STATUS_NOT_FOUND,
            )
        ],
    )

    class Ctx:
        pass

    ctx = Ctx()
    ctx.io = io  # type: ignore[attr-defined]

    df = KRSRegisterEntries().process(ctx)  # type: ignore[arg-type]

    assert io.asked == [RESPONSE_LOG]
    assert list(df["krs"]) == ["0000000001", "0000225512"]
    assert list(df["status"]) == [STATUS_NOT_FOUND, STATUS_OK]
