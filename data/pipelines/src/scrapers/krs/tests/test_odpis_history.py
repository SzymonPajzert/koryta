"""That every stored odpis is read once, into dated seats and a list of entries.

The documents here are text standing in for PDFs: `extract_text` and
`extract_head_text` are swapped for a decode, so what is tested is everything
around the parser -- which odpis is read, what a row carries, what is refused.
The one PESEL is synthetic, built to pass its own check digit.
"""

import pandas as pd
import pytest

from scrapers.krs import odpis_files, odpis_history, odpis_pdf
from scrapers.stores.file import DownloadableFile
from util import pesel as pesel_util


def pesel(first_ten: str) -> str:
    weights = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    total = sum(int(d) * w for d, w in zip(first_ten, weights))
    return first_ten + str((10 - total % 10) % 10)


#: 1970-02-08, male.
PRESIDENT = pesel("7002082345")
SALT = "k" * 64

ODPIS = f"""
Stan na dzień 30.09.2026 godz. 10:00:00
Numer KRS: 0000000029
Nr wpisu
1
Data dokonania wpisu
17.02.2001
Opis
REJESTRACJA W KRAJOWYM REJESTRZE SĄDOWYM
Sygnatura akt
WA.XII NS-REJ.KRS/1/01/1
Oznaczenie sądu
SĄD REJONOWY DLA M. ST. WARSZAWY W WARSZAWIE
Nr wpisu
2
Data dokonania wpisu
30.04.2021
Opis
ZMIANA DANYCH W REJESTRZE
Sygnatura akt
------
Oznaczenie sądu
SYSTEM
Dział 2
Rubryka 1 ­ Organ uprawniony do reprezentacji podmiotu
1.Nazwa organu uprawnionego do
reprezentowania podmiotu
1
-
ZARZĄD
Podrubryka 1
Dane osób wchodzących w skład organu
1
1.Nazwisko / Nazwa lub Firma
1
2
KOWALSKI
2.Imiona
1
2
JAN
3.Numer PESEL/REGON lub data
urodzenia
1
2
{PRESIDENT}, ------
5.Funkcja w organie
reprezentującym
1
2
PREZES ZARZĄDU
"""


def as_text(content: bytes) -> str:
    if content == b"corrupt":
        raise ValueError("not a PDF")
    return content.decode()


@pytest.fixture(autouse=True)
def text_documents(monkeypatch, tmp_path):
    monkeypatch.setattr(odpis_pdf, "extract_text", as_text)
    monkeypatch.setattr(odpis_pdf, "extract_head_text", as_text)
    monkeypatch.setattr(odpis_history, "WORKERS", 1)
    monkeypatch.setattr(odpis_history, "PARSED_ROOT", str(tmp_path / "parsed"))


class Read:
    def __init__(self, content: bytes):
        self.content = content

    def read_bytes(self) -> bytes:
        return self.content


class FakeIO:
    def __init__(self, held: dict[str, bytes]):
        self.held = held
        self.listings = 0

    def list_files(self, ref):
        self.listings += 1
        for name in self.held:
            yield DownloadableFile(f"gs://koryta-pl-crawled/{name}")

    def read_data(self, ref):
        return Read(self.held[ref.url.split("gs://koryta-pl-crawled/", 1)[1]])


class FakeContext:
    def __init__(self, held):
        self.io = FakeIO(held)


def held(krs="29", register="P", day="2026-09-30", content=ODPIS.encode()):
    return {odpis_files.blob_name(krs, register, day): content}


def test_head_pages_stop_at_the_page_dzial_1_begins_on():
    pages = ["Stan na dzień\nNr wpisu\n1", "Data dokonania wpisu\nDział 1\nx", "late"]
    assert odpis_pdf.head_pages(iter(pages)) == "\n".join(pages[:2])


def test_entries_carry_their_company_register_and_day():
    ctx = FakeContext(held())
    df = odpis_history.KrsOdpisEntries().process(ctx)
    assert list(df.columns) == list(odpis_history.ENTRY_COLUMNS)
    columns = ["krs", "register", "stated_on", "number", "entry_date"]
    assert df[columns].values.tolist() == [
        ["0000000029", "P", "2026-09-30", "1", "2001-02-17"],
        ["0000000029", "P", "2026-09-30", "2", "2021-04-30"],
    ]
    assert df["court"].tolist()[1] == "SYSTEM"
    assert ctx.io.listings == 1


def test_only_the_newest_odpis_of_a_company_is_read():
    older = ODPIS.replace("ZMIANA DANYCH W REJESTRZE", "SPROSTOWANIE WPISU")
    ctx = FakeContext(
        held(day="2026-09-14", content=older.encode()) | held(day="2026-09-30")
    )
    df = odpis_history.KrsOdpisEntries().process(ctx)
    assert set(df["description"]) == {
        "REJESTRACJA W KRAJOWYM REJESTRZE SĄDOWYM",
        "ZMIANA DANYCH W REJESTRZE",
    }


def test_an_unreadable_document_is_reported_and_the_rest_are_read(capsys):
    ctx = FakeContext(held(krs="31", content=b"corrupt") | held())
    df = odpis_history.KrsOdpisEntries().process(ctx)
    assert set(df["krs"]) == {"0000000029"}
    assert "0000000031 (P): ValueError: not a PDF" in capsys.readouterr().out


def test_a_seat_is_dated_fingerprinted_and_carries_no_pesel(monkeypatch):
    monkeypatch.setattr(odpis_history, "pesel_salt", lambda: SALT)
    df = odpis_history.KrsOdpisSeats().process(FakeContext(held()))
    assert list(df.columns) == list(odpis_history.SEAT_COLUMNS)
    seat = df.iloc[0]
    assert (seat.krs, seat.register) == ("0000000029", "P")
    assert seat.stated_on == "2026-09-30"
    assert (seat.full_name, seat.funkcja) == ("JAN KOWALSKI", "PREZES ZARZĄDU")
    assert (seat.entry_added, seat.entry_removed) == ("1", "2")
    assert (seat.date_added, seat.date_removed) == ("2001-02-17", "2021-04-30")
    assert not seat.current
    assert seat.birth_date == "1970-02-08"
    assert seat.pesel_fingerprint == pesel_util.fingerprint(PRESIDENT, SALT)
    assert seat.salt_id == pesel_util.salt_id(SALT)
    assert PRESIDENT not in df.to_csv()


def test_no_key_fails_before_the_bucket_is_listed(monkeypatch):
    monkeypatch.setattr(odpis_history, "pesel_salt", lambda: None)
    ctx = FakeContext(held())
    with pytest.raises(odpis_history.PeselKeyMissing, match="KORYTA_PESEL_SALT"):
        odpis_history.KrsOdpisSeats().process(ctx)
    assert ctx.io.listings == 0


def test_an_eleven_digit_run_is_refused_and_a_digest_is_not():
    with pytest.raises(AssertionError, match="11-digit"):
        odpis_history.assert_no_pesel(pd.DataFrame({"funkcja": [f"Z {PRESIDENT}"]}))
    odpis_history.assert_no_pesel(
        pd.DataFrame(
            {
                "pesel_fingerprint": ["ab" + "1" * 12 + "c" * 18],
                "salt_id": ["0123456789ab"],
            }
        )
    )


def sized(doc: odpis_history.Document) -> odpis_history.Parsed:
    """A parser the pool's workers can import: they do not see a monkeypatch."""
    if doc.content == b"corrupt":
        return [], f"{doc.krs}: unreadable"
    return [{"krs": doc.krs, "size": len(doc.content)}], None


def test_the_pool_gives_what_one_process_gives():
    docs = [
        odpis_history.Document(
            krs=f"{n:010d}",
            register="P",
            content=b"corrupt" if n % 50 == 0 else b"x" * n,
        )
        for n in range(1, 140)
    ]
    one = odpis_history.parse_all(docs, sized, workers=1)
    pool = odpis_history.parse_all(docs, sized, workers=2)
    assert pool == one
    assert len(one[0]) == 137 and len(one[1]) == 2


def test_every_text_column_is_pinned_on_the_way_back():
    assert odpis_history.KrsOdpisSeats.dtype is not None
    for column in ("krs", "pesel_fingerprint", "salt_id", "entry_added", "birth_date"):
        assert odpis_history.KrsOdpisSeats.dtype[column] is str
    # Shared since 2026-10-02: PeopleKRSCombined reads the seats, and only the
    # machine holding the PESEL key can build them.
    assert odpis_history.KrsOdpisSeats.backup_to_shared_cache is True


def test_an_entry_day_survives_the_round_trip_as_text(tmp_path):
    """A jsonl column named exactly ``date`` comes back from pandas a datetime."""
    df = odpis_history.KrsOdpisEntries().process(FakeContext(held()))
    path = tmp_path / "entries.jsonl"
    df.to_json(path, orient="records", lines=True, force_ascii=False)
    back = pd.read_json(path, lines=True, dtype=odpis_history.KrsOdpisEntries.dtype)
    assert back["entry_date"].tolist() == ["2001-02-17", "2021-04-30"]


@pytest.fixture
def counted(monkeypatch):
    """How many documents the parser was handed."""
    seen: list[bytes] = []

    def head(content: bytes) -> str:
        seen.append(content)
        return as_text(content)

    monkeypatch.setattr(odpis_pdf, "extract_head_text", head)
    return seen


def test_a_refresh_parses_only_the_odpisy_it_has_not_parsed(counted):
    ctx = FakeContext(held())
    first = odpis_history.KrsOdpisEntries().process(ctx)

    ctx.io.held |= held(krs="31")
    second = odpis_history.KrsOdpisEntries().process(ctx)

    assert len(counted) == 2, "29 once, then only the new 31"
    pd.testing.assert_frame_equal(
        second[second["krs"] == "0000000029"].reset_index(drop=True), first
    )
    assert set(second["krs"]) == {"0000000029", "0000000031"}


def test_a_parser_that_changed_parses_everything_again(counted, monkeypatch):
    ctx = FakeContext(held())
    odpis_history.KrsOdpisEntries().process(ctx)

    monkeypatch.setattr(odpis_history, "parser_version", lambda: "another parser")
    odpis_history.KrsOdpisEntries().process(ctx)

    assert len(counted) == 2


def test_seats_under_another_key_are_parsed_again(monkeypatch):
    ctx = FakeContext(held())
    monkeypatch.setattr(odpis_history, "pesel_salt", lambda: SALT)
    odpis_history.KrsOdpisSeats().process(ctx)

    monkeypatch.setattr(odpis_history, "pesel_salt", lambda: "q" * 64)
    df = odpis_history.KrsOdpisSeats().process(ctx)

    assert df.iloc[0].pesel_fingerprint == pesel_util.fingerprint(PRESIDENT, "q" * 64)


def test_a_seat_holding_a_pesel_is_not_kept(tmp_path):
    cache = odpis_history.ParsedCache(
        "seats", ("krs", "funkcja"), keeps=odpis_history.carry_no_pesel
    )
    [odpis] = odpis_files.stored_odpisy(FakeContext(held())).values()

    cache.put(odpis, ([{"krs": "0000000029", "funkcja": f"Z {PRESIDENT}"}], None))

    assert cache.get(odpis) is None
