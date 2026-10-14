from entities.person import PKW as Person
from scrapers.pkw.headers import CSV_HEADERS
from scrapers.pkw.process import read_source, with_runoff
from scrapers.pkw.sources import sources
from scrapers.tests.mocks import get_test_context, setup_test_context

FIRST_ROUND = [
    "Urząd",
    "Nazwisko i imiona",
    "Wiek",
    "TERYT",
    "Czy uzyskał mandat",
    "Czy uzyskał prawo kandydowania w drugiej turze",
]
#: The second round's file has every column the first round's has but the last.
SECOND_ROUND = FIRST_ROUND[:-1]


def csv(*rows: list[str]) -> str:
    return "\n".join(";".join(f'"{value}"' for value in row) for row in rows)


def test_the_2024_run_off_says_who_won_the_first_rounds_candidacy():
    """kandydaci_wbp_utf8.csv is the first round alone: „Nie” for everybody
    it did not elect, those it sent to a run-off included, and that is how
    `person_pkw` had them - 60 of the 107 prezydenci, Jacek Jaśkowiak among
    them, as beaten."""
    ctx = setup_test_context(
        get_test_context(),
        {
            "kandydaci_wbp_csv.zip": {
                "kandydaci_wbp_utf8.csv": csv(
                    FIRST_ROUND,
                    ["Prezydent Miasta Poznania", "CZERWIŃSKI Zbigniew"]
                    + ["64", "306401", "Nie", "Tak"],
                    ["Prezydent Miasta Poznania", "GARCZEWSKI Łukasz"]
                    + ["40", "306401", "Nie", "Nie"],
                    ["Prezydent Miasta Poznania", "JAŚKOWIAK Jacek"]
                    + ["61", "306401", "Nie", "Tak"],
                    ["Prezydent Miasta Bolesławiec", "ROMAN Piotr"]
                    + ["62", "020101", "Tak", "Nie"],
                    # Staniszewski went through and withdrew, so the run-off
                    # was a vote for or against Dorobek alone.
                    ["Burmistrz Miasta i Gminy Bodzanów", "DOROBEK Jarosław"]
                    + ["57", "141902", "Nie", "Tak"],
                    ["Burmistrz Miasta i Gminy Bodzanów", "STANISZEWSKI Jerzy Maciej"]
                    + ["70", "141902", "Nie", "Tak"],
                )
            },
            "kandydaci_wbp2_csv.zip": {
                "kandydaci_wbp2_utf8.csv": csv(
                    SECOND_ROUND,
                    ["Burmistrz Miasta i Gminy Bodzanów", "DOROBEK Jarosław"]
                    + ["57", "141902", "Tak"],
                    ["Prezydent Miasta Poznania", "CZERWIŃSKI Zbigniew"]
                    + ["64", "306401", "Nie"],
                    ["Prezydent Miasta Poznania", "JAŚKOWIAK Jacek"]
                    + ["61", "306401", "Tak"],
                )
            },
        },
    )
    (mayors,) = [s for s in sources if s.source.filename == "kandydaci_wbp_csv.zip"]

    people = read_source(ctx, mayors, CSV_HEADERS, None)

    # One row a candidacy, the run-off's on the first round's.
    assert [(p.last_name, p.candidacy_success) for p in people] == [
        ("CZERWIŃSKI", "FALSE"),
        ("GARCZEWSKI", "FALSE"),
        ("JAŚKOWIAK", "TRUE"),
        ("ROMAN", "TRUE"),
        ("DOROBEK", "TRUE"),
        ("STANISZEWSKI", "FALSE"),
    ]


def mayor(name: str, teryt: str | int, won: bool) -> Person:
    return Person(
        election_year="2024",
        election_type="samorządu",
        position="Wójt Gminy Czarna",
        pkw_name=name,
        teryt_candidacy=teryt,  # type: ignore[arg-type]
        candidacy_success="TRUE" if won else "FALSE",
    )


def test_a_run_off_row_is_tied_by_office_name_and_place():
    """A TERYT pandas read as a number is the same place: a 2024 list arrives
    with its codes as ints wherever a chunk of the file was all digits."""
    people = with_runoff(
        [mayor("NOWAK Jan", 180303, False), mayor("NOWAK Jan", "180304", False)],
        [mayor("NOWAK Jan", "180303", True)],
        "2024 samorządu",
    )

    assert [p.candidacy_success for p in people] == ["TRUE", "FALSE"]


def test_a_run_off_row_that_ties_to_no_candidacy_is_kept_and_counted(capsys):
    """Neither a name the first round spells otherwise nor two namesakes in one
    race say whose run-off it was. The result is kept, a candidacy of its own,
    rather than lost without a word."""
    people = with_runoff(
        [
            mayor("NOWAK Jan", "180303", False),
            mayor("KOWALSKI Jan", "180303", False),
            mayor("KOWALSKI Jan", "180303", False),
        ],
        [
            mayor("NOWAK Jan Maria", "180303", True),
            mayor("KOWALSKI Jan", "180303", True),
        ],
        "2024 samorządu",
    )

    assert [(p.pkw_name, p.candidacy_success) for p in people] == [
        ("NOWAK Jan", "FALSE"),
        ("KOWALSKI Jan", "FALSE"),
        ("KOWALSKI Jan", "FALSE"),
        ("NOWAK Jan Maria", "TRUE"),
        ("KOWALSKI Jan", "TRUE"),
    ]
    assert "2 tied to none" in capsys.readouterr().out
