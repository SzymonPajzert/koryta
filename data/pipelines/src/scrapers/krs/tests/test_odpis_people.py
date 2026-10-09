"""Odpis seats folded into rejestr.io's people: which rows stand, under which name.

The people here are invented; the spellings are the kinds measured on the 585
companies both sources cover -- a hyphen against a space, a maiden name, an
early entry without its Polish letters.
"""

import io
from types import SimpleNamespace

import duckdb
import pandas as pd
import pytest

from analysis.people_krs_merged import people_krs_merged
from scrapers.krs import odpis_people
from scrapers.krs.odpis_history import PeselKeyMissing
from scrapers.krs.odpis_people import (
    SOURCE_ODPIS,
    SOURCE_REJESTRIO,
    PeopleKRSCombined,
    combine,
    match_rejestrio,
    posts_from_seats,
    with_identities,
)
from stores.file import FromBytesIO

A, B, C, D = "0000000029", "0000000031", "0000000041", "0000000043"
BORN = "1970-02-08"


def seat(krs=A, surname="NOWAK", given="JAN", role="reprezentacja", **kwargs):
    row = {
        "krs": krs,
        "register": "P",
        "stated_on": "2026-09-14",
        "role": role,
        "surname": surname,
        "given_names": given,
        "birth_date": BORN,
        "sex": "M",
        "pesel_fingerprint": "f" * 32,
        "is_company": False,
        "date_added": "2020-01-10",
        "date_removed": None,
    }
    row.update(kwargs)
    return row


def person(krs=A, first="Jan", last="Nowak", id="7", **kwargs):
    row = {
        "id": id,
        "first_name": first,
        "last_name": last,
        "full_name": f"{first} {last}",
        "employed_krs": krs,
        "employed_start": "2020-01-10",
        "employed_end": None,
        "employed_for": "6.72",
        "employed_role": "Zarząd",
        "birth_date": BORN,
        "second_names": "",
        "sex": "M",
        "rejestrio_type": "osoba",
        "crawled_on": "2026-09-01",
    }
    row.update(kwargs)
    return row


def seats(*rows):
    return pd.DataFrame(list(rows))


def people(*rows):
    return pd.DataFrame(list(rows))


# --------------------------------------------------------------- the rows
def test_a_seat_becomes_the_row_rejestrio_would_give():
    [row] = posts_from_seats(
        seats(seat(surname="KOWALSKA-NOWAK", given="ANNA MARIA", sex="F"))
    ).to_dict("records")
    assert {k: row[k] for k in ("first_name", "last_name", "second_names")} == {
        "first_name": "Anna",
        "last_name": "Kowalska-Nowak",
        "second_names": "Maria",
    }
    assert row["full_name"] == "Anna Kowalska-Nowak"
    assert (row["employed_role"], row["employed_start"], row["employed_end"]) == (
        "Zarząd",
        "2020-01-10",
        None,
    )
    assert (row["crawled_on"], row["source"], row["id"]) == (
        "2026-09-14",
        SOURCE_ODPIS,
        None,
    )


def test_only_posts_held_by_people_are_rows():
    rows = posts_from_seats(
        seats(
            seat(role="nadzor"),
            seat(role="prokurent"),
            seat(role="pelnomocnik"),
            seat(role="wspolnik"),
            seat(role="likwidator"),
            seat(role="reprezentacja", is_company=True),
        )
    )
    assert list(rows["employed_role"]) == ["Rada Nadzorcza", "Prokurent", "Pełnomocnik"]


# ---------------------------------------------------------- who is who
def test_one_person_spelled_two_ways_is_matched_at_the_same_company():
    posts = posts_from_seats(
        seats(
            seat(surname="SKOWRONSKI", given="DARIUSZ", pesel_fingerprint="a" * 32),
            seat(surname="MAKOWIECKA", given="JOANNA", pesel_fingerprint="b" * 32),
            seat(
                surname="KRZYCZKOWSKI-JESIEŃ",
                given="RYSZARD",
                pesel_fingerprint="c" * 32,
            ),
        )
    )
    rejestrio = people(
        person(first="Dariusz", last="Skowroński", id="1"),
        person(first="Joanna", last="Makowiecka Gatza", id="2"),
        person(first="Ryszard", last="Krzyczkowski Jesień", id="3"),
    )
    matches = match_rejestrio(rejestrio, posts)
    assert dict(zip(matches["pesel_fingerprint"], matches["id"])) == {
        "a" * 32: "1",
        "b" * 32: "2",
        "c" * 32: "3",
    }


def test_two_people_the_names_cannot_tell_apart_are_no_match():
    posts = posts_from_seats(seats(seat(surname="KOWALSKA", given="ANNA")))
    rejestrio = people(
        person(first="Anna", last="Nowak", id="1"),
        person(first="Anna", last="Zielińska", id="2"),
    )
    assert match_rejestrio(rejestrio, posts).empty


def test_the_exact_spelling_wins_over_a_looser_one():
    posts = posts_from_seats(seats(seat(surname="NOWAK", given="ANNA")))
    rejestrio = people(
        person(first="Anna", last="Nowak", id="1"),
        person(first="Anna", last="Kowalska", id="2"),
    )
    assert list(match_rejestrio(rejestrio, posts)["id"]) == ["1"]


def test_a_rejestrio_person_two_odpis_people_would_claim_is_neither():
    posts = posts_from_seats(
        seats(
            seat(surname="NOWAK", given="JAN", pesel_fingerprint="a" * 32),
            seat(surname="NOWAK", given="PIOTR", pesel_fingerprint="b" * 32),
        )
    )
    rejestrio = people(person(first="Jan", last="Nowak-Kowalski", id="1"))
    assert match_rejestrio(rejestrio, posts).empty


def test_names_entered_the_wrong_way_round_still_match():
    posts = posts_from_seats(seats(seat(surname="KRZEMIŃSKA", given="MIRELLA")))
    rejestrio = people(person(first="Krzemińska", last="Mirella", id="5"))
    assert list(match_rejestrio(rejestrio, posts)["id"]) == ["5"]


def test_a_different_birth_date_is_a_different_person():
    posts = posts_from_seats(seats(seat()))
    rejestrio = people(person(birth_date="1971-02-08"))
    assert match_rejestrio(rejestrio, posts).empty


def test_the_fingerprint_carries_a_rejestrio_identity_to_other_companies():
    posts = posts_from_seats(
        seats(
            seat(krs=A, surname="GRAJEK", given="EWA"),
            seat(krs=B, surname="GRAJEK", given="EWA"),
        )
    )
    rejestrio = people(person(krs=A, first="Ewa", last="Kostkiewicz", id="9"))
    named = with_identities(posts, match_rejestrio(rejestrio, posts))
    assert set(zip(named["employed_krs"], named["full_name"], named["id"])) == {
        (A, "Ewa Kostkiewicz", "9"),
        (B, "Ewa Kostkiewicz", "9"),
    }


def test_a_person_rejestrio_never_saw_goes_by_their_newest_spelling():
    posts = posts_from_seats(
        seats(
            seat(krs=A, surname="SKOWRONSKI", given="DARIUSZ", date_added="2004-05-01"),
            seat(krs=B, surname="SKOWROŃSKI", given="DARIUSZ", date_added="2019-03-01"),
        )
    )
    named = with_identities(posts, match_rejestrio(people(), posts))
    assert set(named["last_name"]) == {"Skowroński"}
    assert named["id"].isna().all()


# ------------------------------------------------------ whose word stands
def test_the_newer_source_speaks_for_each_company_and_only_the_graph_counts():
    rejestrio = people(
        person(krs=A, crawled_on="2026-09-20", id="1"),  # newer than the odpis
        person(krs=B, crawled_on="2026-09-01", id="2", last="Kowalski"),
        person(krs=C, crawled_on="2026-09-14", id="3", last="Wiśniewski"),  # same day
    )
    odpisy = seats(
        seat(krs=A, pesel_fingerprint="a" * 32),
        seat(krs=B, surname="KOWALSKI", pesel_fingerprint="b" * 32),
        seat(krs=B, surname="ZIELIŃSKI", given="ADAM", pesel_fingerprint="d" * 32),
        seat(krs=C, surname="WIŚNIEWSKI", pesel_fingerprint="c" * 32),
        # D is not in the graph.
        seat(krs=D, surname="LEWANDOWSKI", pesel_fingerprint="e" * 32),
    )
    combined = combine(rejestrio, odpisy, graph={A, B, C})
    sources = combined.groupby("employed_krs")["source"].agg(set).to_dict()
    assert sources == {A: {SOURCE_REJESTRIO}, B: {SOURCE_ODPIS}, C: {SOURCE_ODPIS}}
    at_b = combined[combined["employed_krs"] == B].set_index("last_name")["id"]
    assert at_b["Kowalski"] == "2" and pd.isna(at_b["Zieliński"])
    assert "pesel_fingerprint" not in combined.columns


def test_somebody_the_newer_odpis_does_not_name_keeps_rejestrios_rows():
    """The parser's miss is not a resignation."""
    rejestrio = people(
        person(krs=A, id="1"),
        person(
            krs=A, first="Ewa", last="Eckert", id="2", employed_role="Rada Nadzorcza"
        ),
    )
    combined = combine(rejestrio, seats(seat(krs=A)), graph={A})
    assert sorted(zip(combined["full_name"], combined["source"])) == [
        ("Ewa Eckert", SOURCE_REJESTRIO),
        ("Jan Nowak", SOURCE_ODPIS),
    ]


def test_an_odpis_of_a_company_struck_off_one_register_stands_in_for_nobody():
    rejestrio = people(person(krs=A, id="1"))
    odpisy = seats(seat(krs=A, date_removed="2019-12-11"), seat(krs=B))
    combined = combine(rejestrio, odpisy, graph={A, B}, struck={A, B})
    assert list(zip(combined["employed_krs"], combined["source"])) == [
        (A, SOURCE_REJESTRIO)
    ]


def test_leaving_one_register_is_told_apart_from_leaving_the_krs():
    entries = pd.DataFrame(
        {
            "krs": [A, B, C],
            "description": [
                "WYKREŚLENIE Z REJESTRU PRZEDSIĘBIORCÓW",
                "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO",
                "ZMIANA DANYCH W REJESTRZE",
            ],
        }
    )
    assert odpis_people.struck_off_one_register(entries) == {A}


def test_rows_written_before_the_crawl_day_was_recorded_lose_to_the_odpis():
    rejestrio = people(person(krs=A)).drop(columns=["crawled_on"])
    combined = combine(rejestrio, seats(seat(krs=A)), graph={A})
    assert list(combined["source"]) == [SOURCE_ODPIS]
    assert list(combined["id"]) == ["7"]


def test_without_the_key_the_people_are_rejestrios_alone(capsys):
    pipeline = PeopleKRSCombined()
    pipeline.people_krs.read_or_process = lambda ctx: people(person())

    def no_key(ctx):
        raise PeselKeyMissing("No PESEL key.")

    pipeline.seats.read_or_process = no_key
    pipeline.entries.read_or_process = lambda ctx: pytest.fail("read every PDF")
    df = pipeline.process(ctx=None)
    assert list(df["source"]) == [SOURCE_REJESTRIO]
    assert list(df.columns) == list(odpis_people.COLUMNS)
    assert "rejestr.io's alone" in capsys.readouterr().out


# ------------------------------------------------------ what reads them
def restored(df: pd.DataFrame) -> pd.DataFrame:
    """The frame as a restore from the shared cache gives it back."""
    buffer = io.BytesIO()
    df.to_json(buffer, orient="records", lines=True)
    buffer.seek(0)
    return FromBytesIO(buffer, PeopleKRSCombined.filename).read_dataframe(
        "jsonl", dtype=PeopleKRSCombined.dtype
    )


@pytest.fixture
def ctx():
    con = duckdb.connect()
    yield SimpleNamespace(con=con)
    con.close()


def test_the_odpis_days_are_where_the_people_come_from_an_odpis():
    """What the paid job leaves to the odpis is read off this, so it must agree."""
    rejestrio = people(person(krs=A), person(krs=C, first="Ewa", last="Eckert"))
    odpisy = seats(
        seat(krs=A),  # newer than rejestr.io's crawl
        seat(krs=B, stated_on="2026-09-20"),  # a company rejestr.io never saw
        seat(krs=C, stated_on="2026-08-01"),  # older than rejestr.io's crawl
        seat(krs=D),  # struck off one register
    )
    combined = restored(combine(rejestrio, odpisy, graph={A, B, C, D}, struck={D}))
    assert odpis_people.odpis_days(combined) == {A: "2026-09-14", B: "2026-09-20"}


def test_no_odpis_days_without_the_key():
    alone = people(person()).assign(source=SOURCE_REJESTRIO)
    assert odpis_people.odpis_days(alone) == {}
    assert odpis_people.odpis_days(pd.DataFrame()) == {}


def test_people_krs_merged_takes_one_person_from_both_sources(ctx):
    rejestrio = people(person(krs=A, id="7"))
    odpisy = seats(
        seat(krs=B),  # the same person at a company rejestr.io never saw
        seat(krs=B, surname="NOWY", given="ADAM", pesel_fingerprint="d" * 32),
    )
    combined = restored(combine(rejestrio, odpisy, graph={A, B}))
    merged = people_krs_merged(ctx, combined).set_index("last_name")

    jan = merged.loc["nowak"]
    assert sorted(e["employed_krs"] for e in jan["employment"]) == [A, B]
    assert list(jan["rejestrio_id"]) == ["7"]
    # A person only an odpis names has no register id - not the string "nan".
    assert list(merged.loc["nowy"]["rejestrio_id"]) == []


def posts_by_row(merged: pd.DataFrame) -> list[tuple[list[str], str, list[str]]]:
    """Each merged person as (register ids, birth date, companies), in a fixed order."""
    return sorted(
        (
            sorted(str(i) for i in row["rejestrio_id"]),
            str(row["birth_date"]),
            sorted(e["employed_krs"] for e in row["employment"]),
        )
        for _, row in merged.iterrows()
    )


def test_an_odpis_namesake_born_on_another_day_is_another_person(ctx):
    """The same name and year, another day: two people, each with their own posts.

    Grouped by the year, the odpis person's post at B landed on rejestr.io's Jan
    Nowak and went out in his payload, filed under his register id.
    """
    rejestrio = people(person(krs=A, id="7"))
    odpisy = seats(seat(krs=B, birth_date="1970-11-30", pesel_fingerprint="e" * 32))
    combined = restored(combine(rejestrio, odpisy, graph={A, B}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [
        ([], "1970-11-30", [B]),
        (["7"], BORN, [A]),
    ]


def test_an_odpis_namesake_born_on_the_same_day_stays_one_person(ctx):
    """Name and date agree, so they stay one row: a probable duplicate.

    The fingerprints differ only because rejestr.io's Jan Nowak has none yet: no
    odpis of A is on file. Fetching it gives the evidence - his fingerprint at A
    - but nothing here reads fingerprints, so the row stays one either way until
    a later step acts on them.
    """
    rejestrio = people(person(krs=A, id="7"))
    odpisy = seats(seat(krs=B, pesel_fingerprint="e" * 32))
    combined = restored(combine(rejestrio, odpisy, graph={A, B}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [(["7"], BORN, [A, B])]


def test_two_register_entries_born_the_same_year_are_two_people(ctx):
    """No rejestr.io id carries two birth dates, so two dates are two people."""
    rejestrio = people(
        person(krs=A, id="7"),
        person(krs=B, id="8", birth_date="1970-09-01"),
    )
    combined = restored(rejestrio.assign(source=SOURCE_REJESTRIO))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [
        (["7"], BORN, [A]),
        (["8"], "1970-09-01", [B]),
    ]


def test_an_entry_without_a_middle_name_joins_no_other_entry(ctx):
    """It used to join every namesake born that year, posts and register id
    with it. Not even the namesake born that same day: two register entries
    are two people."""
    rejestrio = people(
        person(krs=A, id="7", second_names="Adam"),
        person(krs=B, id="8", second_names="Piotr", birth_date="1970-05-05"),
        person(krs=C, id="9", birth_date="1970-05-05"),
    )
    combined = restored(rejestrio.assign(source=SOURCE_REJESTRIO))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [
        (["7"], BORN, [A]),
        (["8"], "1970-05-05", [B]),
        (["9"], "1970-05-05", [C]),
    ]


def test_each_person_keeps_their_own_birth_year(ctx):
    """Not moved to a namesake's a year later, as the year grouping smoothed it.

    The year feeds the PKW and Wikipedia joins and the score, so a moved one
    would quietly change which candidacies a person is given.
    """
    rejestrio = people(
        person(krs=A, id="7"),
        person(krs=B, id="8", birth_date="1971-03-03"),
    )
    merged = people_krs_merged(ctx, restored(rejestrio.assign(source=SOURCE_REJESTRIO)))

    assert sorted(zip(merged["birth_date"], merged["birth_year"])) == [
        (BORN, 1970),
        ("1971-03-03", 1971),
    ]


# ------------------------------------------------- somebody without a PESEL
#: The day an odpis prints in place of a PESEL (`odpis_pdf.printed_birth_date`).
PRINTED = "1967-11-05"


def unprinted(krs=A, surname="DEMETER BUBALO", given="ZDRAVKA", **kwargs):
    """A seat whose identifier field prints a birth date in place of a PESEL."""
    fields = {"birth_date": PRINTED, "sex": None, "pesel_fingerprint": None}
    return seat(krs=krs, surname=surname, given=given, **{**fields, **kwargs})


def undated(krs=A, first="Zdravka", last="Demeter Bubalo", id="70", **kwargs):
    """A rejestr.io entry it holds no PESEL for: a name and nothing else."""
    fields = {"birth_date": None, "sex": None, "rejestrio_type": "osoba-bez-pesel"}
    return person(krs=krs, first=first, last=last, id=id, **{**fields, **kwargs})


def test_somebody_without_a_pesel_comes_in_on_the_day_the_odpis_prints(ctx):
    """As somebody only the odpis names. rejestr.io's entry for them has no
    birth date to come in with, and its id is no ``/osoby/`` id."""
    combined = restored(combine(people(undated()), seats(unprinted()), graph={A}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [([], PRINTED, [A])]


def test_somebody_with_neither_a_pesel_nor_a_printed_day_is_still_left_out(ctx):
    odpisy = seats(unprinted(birth_date=None))
    combined = restored(combine(people(undated()), odpisy, graph={A}))

    assert people_krs_merged(ctx, combined).empty


def test_one_name_on_two_printed_days_is_two_people(ctx):
    rejestrio = people(undated(krs=A, id="70"), undated(krs=B, id="71"))
    odpisy = seats(unprinted(krs=A), unprinted(krs=B, birth_date="1971-01-01"))
    combined = restored(combine(rejestrio, odpisy, graph={A, B}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [
        ([], PRINTED, [A]),
        ([], "1971-01-01", [B]),
    ]


def test_one_name_on_one_printed_day_at_two_companies_is_one_person(ctx):
    """rejestr.io gives somebody without a PESEL an entry per company: on the
    2026-10-09 night no ``osoba-bez-pesel`` id sat at two companies, while 511
    names sat under two ids or more. The name and the day tie the seats."""
    rejestrio = people(undated(krs=A, id="70"), undated(krs=B, id="71"))
    odpisy = seats(unprinted(krs=A), unprinted(krs=B))
    combined = restored(combine(rejestrio, odpisy, graph={A, B}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [([], PRINTED, [A, B])]


def test_an_osoba_bez_pesel_id_is_not_the_osoba_with_that_number(ctx):
    """rejestr.io numbers the two shapes apart. On the 2026-10-09 night 96
    numbers were both, never under one name, and ``/osoby/<n>`` was the
    ``osoba``'s. Neither lends the other a birth date or a post."""
    rejestrio = people(person(krs=A, id="7"), undated(krs=B, id="7"))
    combined = restored(combine(rejestrio, seats(unprinted(krs=B)), graph={A, B}))

    assert posts_by_row(people_krs_merged(ctx, combined)) == [
        ([], PRINTED, [B]),
        (["7"], BORN, [A]),
    ]


def test_the_printed_day_joins_the_entry_the_register_later_gave_a_pesel(ctx):
    """A board member the register later wrote down with a PESEL holds a second
    seat, which rejestr.io lists as an ``osoba`` with the date the PESEL
    decodes to. The first seat prints that same day, so its post joins them;
    5 entries took posts this way on the 2026-10-09 night."""
    later = {"birth_date": PRINTED, "sex": "F", "date_added": "2024-01-01"}
    rejestrio = people(
        undated(id="70"),
        person(
            id="7",
            first="Zdravka",
            last="Demeter Bubalo",
            employed_start="2024-01-01",
            **{k: v for k, v in later.items() if k != "date_added"},
        ),
    )
    odpisy = seats(
        unprinted(date_removed="2024-01-01"),
        seat(surname="DEMETER BUBALO", given="ZDRAVKA", **later),
    )
    combined = restored(combine(rejestrio, odpisy, graph={A}))
    [row] = people_krs_merged(ctx, combined).to_dict("records")

    assert list(row["rejestrio_id"]) == ["7"]
    assert sorted(
        (e["employed_start"], e["employed_end"]) for e in row["employment"]
    ) == [("2020-01-10", "2024-01-01"), ("2024-01-01", None)]
