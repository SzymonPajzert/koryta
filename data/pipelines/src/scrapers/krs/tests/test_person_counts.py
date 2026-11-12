"""rejestr.io's own count of each person's connections, off the company feeds."""

import io
import json

import pandas as pd

from scrapers.krs.person_counts import (
    COLUMNS,
    PersonCount,
    RejestrIOPersonCounts,
    counts_in,
    newest_counts,
    parse_company_connections_url,
    read_counts,
)
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

BUCKET = "gs://koryta-pl-crawled"
KRS = "0000000110"
OTHER = "0000000111"


def osoba(id: int, aktualne: int, przeszle: int, organizacje: int = 1) -> dict:
    """A person as a company feed lists them, trimmed to what is read."""
    return {
        "id": id,
        "typ": "osoba",
        "krs_powiazania_liczby": {
            "aktualne": aktualne,
            "aktualne_organizacje": organizacje,
            "przeszle": przeszle,
        },
        "tozsamosc": {"imiona_i_nazwisko": "Jan Kowalski"},
    }


def feed(krs: str, day: str, kind: str = "aktualne") -> str:
    return (
        f"hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania"
        f"/aktualnosc_{kind}/date={day}"
    )


def count(id: str, aktualne: int, przeszle: int, day: str, krs: str = KRS):
    return PersonCount(id, aktualne, 1, przeszle, counted_on=day, krs=krs)


# ─── which objects are company feeds ──────────────────────


def test_both_feeds_of_a_company_are_read_in_either_layout():
    assert parse_company_connections_url(
        f"{BUCKET}/{feed('110', '2026-07-19', 'historyczne')}"
    ) == (KRS, "2026-07-19")
    assert parse_company_connections_url(
        f"{BUCKET}/hostname=rejestr.io/date=2025-09-29/api/v2/org/{KRS}"
        "/krs-powiazania/aktualnosc_aktualne"
    ) == (KRS, "2025-09-29")


def test_a_person_feed_and_a_company_record_are_not_company_feeds():
    assert (
        parse_company_connections_url(
            f"{BUCKET}/hostname=rejestr.io/api/v2/osoby/2145029"
            "/krs-powiazania/aktualnosc_aktualne/date=2026-10-06"
        )
        is None
    )
    assert (
        parse_company_connections_url(
            f"{BUCKET}/hostname=rejestr.io/api/v2/org/{KRS}/date=2026-10-06"
        )
        is None
    )


# ─── what one feed says ───────────────────────────────────


def test_every_osoba_of_a_feed_is_counted_and_nothing_else_is():
    data = [
        osoba(7, aktualne=2, przeszle=5, organizacje=2),
        # rejestr.io numbers the entries without a PESEL apart, and gives
        # them no count: /osoby/8 would be somebody else.
        {"id": 8, "typ": "osoba-bez-pesel", "tozsamosc": {}},
        {"id": 9, "typ": "organizacja", "numery": {"krs": "0000000009"}},
        {"id": 10, "typ": "osoba"},
        {"id": 11, "typ": "osoba", "krs_powiazania_liczby": {"aktualne": 1}},
        {"id": 12, "typ": "osoba", "krs_powiazania_liczby": {"aktualne": True}},
    ]

    assert list(counts_in(data, KRS, "2026-07-19")) == [
        PersonCount("7", 2, 2, 5, counted_on="2026-07-19", krs=KRS)
    ]
    assert list(counts_in({"detail": "Not Found"}, KRS, "2026-07-19")) == []


def test_stated_is_every_connection_current_and_past():
    assert count("7", aktualne=2, przeszle=5, day="2026-07-19").stated == 7


# ─── the fold ─────────────────────────────────────────────


def test_the_newest_crawl_naming_a_person_says_how_many_they_have():
    older = count("7", aktualne=1, przeszle=0, day="2026-03-18", krs=OTHER)
    newer = count("7", aktualne=1, przeszle=4, day="2026-08-20")

    assert newest_counts([newer, older]) == {"7": newer}
    assert newest_counts([older, newer]) == {"7": newer}


def test_two_feeds_of_one_day_settle_the_same_whatever_their_order():
    low = count("7", aktualne=1, przeszle=0, day="2026-08-20", krs=OTHER)
    high = count("7", aktualne=0, przeszle=2, day="2026-08-20")
    other = count("7", aktualne=1, przeszle=1, day="2026-08-20", krs=OTHER)

    assert newest_counts([low, high]) == newest_counts([high, low]) == {"7": high}
    assert newest_counts([high, other]) == newest_counts([other, high])


# ─── the pipeline over a fake bucket ──────────────────────


class FakeFile:
    def __init__(self, content: str):
        self.content = content

    def read_string(self) -> str:
        return self.content


class BucketIO(MockIO):
    def __init__(self, blobs: dict[str, list | str]):
        self.blobs = blobs

    def read_many(self, path):
        for name, body in self.blobs.items():
            content = body if isinstance(body, str) else json.dumps(body)
            yield f"{BUCKET}/{name}", FakeFile(content)


def process(blobs: dict[str, list | str]) -> pd.DataFrame:
    ctx = Context(
        io=BucketIO(blobs),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    return RejestrIOPersonCounts().process(ctx)


def test_one_row_a_person_from_the_company_feeds_alone(capsys):
    df = process(
        {
            feed(KRS, "2026-03-18"): [osoba(7, aktualne=1, przeszle=0)],
            feed(OTHER, "2026-08-20", "historyczne"): [
                osoba(7, aktualne=1, przeszle=4),
                osoba(31, aktualne=0, przeszle=3),
            ],
            # A person's own feed lists organisations, and is not read.
            "hostname=rejestr.io/api/v2/osoby/7/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-10-06": [
                {"id": 1, "typ": "organizacja", "numery": {"krs": KRS}}
            ],
            # A failed fetch is stored empty, and an older crawl's word stands.
            feed(KRS, "2026-10-01"): "",
            feed(OTHER, "2026-10-02"): "<html>Przerwa techniczna</html>",
        }
    )

    assert list(df.columns) == COLUMNS
    assert df.to_dict("records") == [
        {
            "id": "31",
            "aktualne": 0,
            "aktualne_organizacje": 1,
            "przeszle": 3,
            "counted_on": "2026-08-20",
            "krs": OTHER,
        },
        {
            "id": "7",
            "aktualne": 1,
            "aktualne_organizacje": 1,
            "przeszle": 4,
            "counted_on": "2026-08-20",
            "krs": OTHER,
        },
    ]
    assert "2 people, from 2 company feeds" in capsys.readouterr().out


def test_nothing_counted_is_an_empty_frame_with_the_columns():
    df = process({})

    assert df.empty and list(df.columns) == COLUMNS
    assert read_counts(df) == {}


def test_the_counts_read_back_off_the_stored_jsonl():
    # As the paid job reads them: written as the pipeline writes its output,
    # read back with the pipeline's dtype, digits-only ids and all.
    df = process({feed(KRS, "2026-08-20"): [osoba(7, aktualne=1, przeszle=4)]})
    stored = df.to_json(orient="records", lines=True)
    back = pd.read_json(
        io.StringIO(stored), lines=True, dtype=RejestrIOPersonCounts.dtype
    )

    assert read_counts(back) == {
        "7": PersonCount("7", 1, 1, 4, counted_on="2026-08-20", krs=KRS)
    }
