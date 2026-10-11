"""Which region a candidacy is filed under."""

import duckdb
import pandas as pd
import pytest

from analysis.people_pkw_merged import people_pkw_merged
from analysis.utils.elections import candidacy_teryt
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

# Kłobuck, where Mariusz Mandat stood, and Warszawa, where PKW recorded that he
# lived. The note on his page says the PKW match is right and the powiat wrong.
KLOBUCK = "2404"
WARSZAWA = "1465"


def test_the_region_is_where_they_stood():
    assert (
        candidacy_teryt(
            {
                "teryt_candidacy_powiat": KLOBUCK,
                "teryt_living_powiat": WARSZAWA,
                "teryt_powiat": [WARSZAWA, KLOBUCK],
            }
        )
        == KLOBUCK
    )


def test_a_candidacy_with_no_region_of_its_own_falls_back_to_the_old_list():
    """Rows written before the two were told apart still have to render."""
    assert candidacy_teryt({"teryt_powiat": [WARSZAWA]}) == WARSZAWA


def test_the_wojewodztwo_stands_in_when_the_powiat_is_missing():
    assert (
        candidacy_teryt(
            {"teryt_candidacy_powiat": None, "teryt_candidacy_wojewodztwo": "24"}
        )
        == "24"
    )


def test_a_candidacy_with_no_region_at_all_has_none():
    assert candidacy_teryt({"teryt_powiat": []}) is None


@pytest.fixture
def ctx():
    return Context(
        io=MockIO(),
        rejestr_io=MockRejestrIO(),
        con=duckdb.connect(),
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )


def candidacy(**overrides) -> pd.DataFrame:
    """One PKW candidacy row, as `PeoplePKW` leaves it."""
    row = {
        "first_name": "Mariusz",
        "last_name": "Mandat",
        "middle_name": None,
        "teryt_candidacy": f"{KLOBUCK}01",
        "teryt_living": f"{WARSZAWA}01",
        "birth_year": 1965,
        "pkw_name": "Mariusz Mandat",
        "party": "KW PSL",
        "election_year": 2024,
        "election_type": "samorządu",
        "candidacy_success": None,
    }
    return pd.DataFrame([row | overrides])


def test_the_merge_keeps_the_two_regions_apart(ctx):
    """The merged table has to carry both, or nothing downstream can choose.

    They used to arrive as `list_distinct([candidacy, living])`, which drops
    NULLs and does not preserve order - so where the two differ, either one
    could come out in front, and every consumer takes the first.
    """
    merged = people_pkw_merged(ctx, candidacy())
    [election] = merged.iloc[0]["elections"]

    assert election["teryt_candidacy_powiat"] == KLOBUCK
    assert election["teryt_living_powiat"] == WARSZAWA
    assert candidacy_teryt(election) == KLOBUCK


def test_the_combined_list_puts_the_candidacy_first(ctx):
    """`people.py` keys its surname-frequency lookup on element one of it."""
    merged = people_pkw_merged(ctx, candidacy())
    [election] = merged.iloc[0]["elections"]

    assert list(election["teryt_powiat"]) == [KLOBUCK, WARSZAWA]


def test_a_candidacy_with_no_recorded_residence_still_has_its_region(ctx):
    merged = people_pkw_merged(ctx, candidacy(teryt_living=None))
    [election] = merged.iloc[0]["elections"]

    assert candidacy_teryt(election) == KLOBUCK
    assert list(election["teryt_powiat"]) == [KLOBUCK]


# --------------------------------------------------------------------------- #
# records that merged two people                                               #
# --------------------------------------------------------------------------- #

SOKOLKA = "2010"
POWIAT_KLOBUCKI = "2404"
WOJ_SLASKIE = "24"
# Anna Paluch's okręg 14 and the Koprzywnica namesake's okręg 33: PKW files a
# Sejm candidacy under the województwo, małopolskie and świętokrzyskie.
MALOPOLSKIE = "12"
SWIETOKRZYSKIE = "26"
POWIAT_LIMANOWSKI = "1207"
# Andrzej Jankowski's two 2010 candidacies, both in wielkopolskie.
POWIAT_OSTROWSKI = "3017"
LESZNO = "3063"


def candidacies(*rows: dict) -> pd.DataFrame:
    """Several PKW rows for one name, differing only where a test says so."""
    base = {
        "first_name": "Tomasz",
        "last_name": "Krasowski",
        "middle_name": "wojciech",
        "teryt_candidacy": f"{WARSZAWA}01",
        "teryt_living": None,
        "birth_year": 1970,
        "pkw_name": "Tomasz Wojciech Krasowski",
        "party": "KW PiS",
        "election_year": 2024,
        "election_type": "samorządu",
        "candidacy_success": None,
    }
    return pd.DataFrame([base | row for row in rows])


def paluch(*rows: dict) -> pd.DataFrame:
    """Undated national runs of one name, as every Sejm list since 2001 is."""
    return candidacies(
        *(
            {
                "first_name": "Anna",
                "last_name": "Paluch",
                "middle_name": None,
                "pkw_name": "Anna PALUCH",
                "birth_year": None,
                "election_type": "sejmu",
            }
            | row
            for row in rows
        )
    )


def records(merged: pd.DataFrame) -> list[list[str]]:
    """Each record's candidacies as "year type place", records in a fixed order."""
    return sorted(
        sorted(
            f"{e['election_year']} {e['election_type']} {candidacy_teryt(e) or '-'}"
            for e in elections
        )
        for elections in merged["elections"]
    )


def test_standing_in_two_powiats_in_one_election_splits_the_record(ctx):
    """Two people, one record, and no way to tell which is the KRS person.

    Tomasz Wojciech Krasowski stands in Warszawa and in powiat sokólski in the
    same election, four elections running. One of the two careers belongs to
    somebody else and nothing here can say which, so each is a record of its
    own rather than neither being anybody's.
    """
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{WARSZAWA}01"},
            {"teryt_candidacy": f"{SOKOLKA}01"},
        ),
    )

    assert records(merged) == [
        [f"2024 samorządu {WARSZAWA}"],
        [f"2024 samorządu {SOKOLKA}"],
    ]
    assert merged["elections_ambiguous"].all()


def test_each_part_keeps_the_name_and_the_birth_year(ctx):
    """So it fits the people the whole record did, and attaches the same way."""
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{WARSZAWA}01"},
            {"teryt_candidacy": f"{SOKOLKA}01"},
        ),
    )

    assert [list(names) for names in merged["full_name"]] == [
        ["Tomasz Wojciech Krasowski"],
        ["Tomasz Wojciech Krasowski"],
    ]
    assert list(merged["birth_year"]) == [1970, 1970]
    assert list(merged["second_name"]) == ["wojciech", "wojciech"]


def test_a_namesakes_run_no_longer_takes_a_career_with_it(ctx):
    """Anna Paluch's Sejm wins in okręg 14 against a 2023 run in okręg 33.

    The two 2023 runs are two places in one election, which used to empty the
    whole undated record. Split by województwo, her career in małopolskie -
    the gmina council in powiat limanowski as well as the Sejm - is one record,
    and the namesake's run another.
    """
    merged = people_pkw_merged(
        ctx,
        paluch(
            {"teryt_candidacy": MALOPOLSKIE, "election_year": 2005},
            {"teryt_candidacy": MALOPOLSKIE, "election_year": 2019},
            {"teryt_candidacy": MALOPOLSKIE, "election_year": 2023},
            {"teryt_candidacy": SWIETOKRZYSKIE, "election_year": 2023},
            {
                "teryt_candidacy": f"{POWIAT_LIMANOWSKI}01",
                "election_year": 1998,
                "election_type": "samorządu",
            },
        ),
    )

    assert records(merged) == [
        [
            f"1998 samorządu {POWIAT_LIMANOWSKI}",
            f"2005 sejmu {MALOPOLSKIE}",
            f"2019 sejmu {MALOPOLSKIE}",
            f"2023 sejmu {MALOPOLSKIE}",
        ],
        [f"2023 sejmu {SWIETOKRZYSKIE}"],
    ]


def test_a_run_with_no_place_is_a_record_of_its_own(ctx):
    """The European lists of 2009, 2014 and 2024 carry no teryt.

    The run contradicts neither part and nothing says which it goes with.
    Copied into both it would be two candidacies for reviewers to judge.
    """
    merged = people_pkw_merged(
        ctx,
        paluch(
            {"teryt_candidacy": MALOPOLSKIE, "election_year": 2023},
            {"teryt_candidacy": SWIETOKRZYSKIE, "election_year": 2023},
            {
                "teryt_candidacy": "",
                "election_year": 2014,
                "election_type": "europarlamentu",
            },
        ),
    )

    assert records(merged) == [
        ["2014 europarlamentu -"],
        [f"2023 sejmu {MALOPOLSKIE}"],
        [f"2023 sejmu {SWIETOKRZYSKIE}"],
    ]


def test_two_powiats_of_one_wojewodztwo_split_by_powiat(ctx):
    """Andrzej Jankowski in Ostrów Wielkopolski and in Leszno in 2010.

    One record for wielkopolskie would still stand in two places, so the
    województwo is split by powiat, and the sejmik run, which is in both,
    goes in a record of its own. A run in another województwo is left whole.
    """
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{POWIAT_OSTROWSKI}01", "election_year": 2010},
            {"teryt_candidacy": f"{LESZNO}01", "election_year": 2010},
            {"teryt_candidacy": f"{POWIAT_OSTROWSKI}01", "election_year": 2018},
            {"teryt_candidacy": "300000", "election_year": 2014},
            {"teryt_candidacy": f"{WARSZAWA}01", "election_year": 2018},
        ),
    )

    assert records(merged) == [
        [f"2010 samorządu {POWIAT_OSTROWSKI}", f"2018 samorządu {POWIAT_OSTROWSKI}"],
        [f"2010 samorządu {LESZNO}"],
        # The sejmik's own code at powiat depth, as `candidacy_teryt` reads it.
        ["2014 samorządu 3000"],
        [f"2018 samorządu {WARSZAWA}"],
    ]


def test_a_part_lists_only_where_its_own_candidacies_were(ctx):
    """`people.py` counts a surname in the record's first województwo."""
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{WARSZAWA}01"},
            {"teryt_candidacy": f"{SOKOLKA}01", "teryt_living": f"{SOKOLKA}02"},
        ),
    )

    by_place = {
        candidacy_teryt(elections[0]): (list(woj), list(powiat))
        for elections, woj, powiat in zip(
            merged["elections"], merged["teryt_wojewodztwo"], merged["teryt_powiat"]
        )
    }
    assert by_place == {
        WARSZAWA: (["14"], [WARSZAWA]),
        SOKOLKA: (["20"], [SOKOLKA]),
    }


def test_standing_in_two_powiats_in_different_years_is_ordinary(ctx):
    """People move, and a career in two towns is not two people."""
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{WARSZAWA}01", "election_year": 2018},
            {"teryt_candidacy": f"{SOKOLKA}01", "election_year": 2024},
        ),
    )

    assert len(merged.iloc[0]["elections"]) == 2
    assert not bool(merged.iloc[0]["elections_ambiguous"])


def test_two_kinds_of_election_in_one_year_are_two_contests(ctx):
    """2024 held both the local elections and the european ones."""
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": f"{WARSZAWA}01", "election_type": "samorządu"},
            {"teryt_candidacy": f"{SOKOLKA}01", "election_type": "europarlamentu"},
        ),
    )

    assert len(merged.iloc[0]["elections"]) == 2
    assert not bool(merged.iloc[0]["elections_ambiguous"])


def test_a_sejmik_seat_does_not_contradict_a_council_seat_inside_it(ctx):
    """The two are recorded at different depths, not in different places."""
    merged = people_pkw_merged(
        ctx,
        candidacies(
            {"teryt_candidacy": WOJ_SLASKIE},
            {"teryt_candidacy": f"{POWIAT_KLOBUCKI}01"},
        ),
    )

    assert len(merged.iloc[0]["elections"]) == 2
    assert not bool(merged.iloc[0]["elections_ambiguous"])


def test_one_person_standing_once_keeps_their_candidacy(ctx):
    merged = people_pkw_merged(ctx, candidacies({}))

    assert len(merged.iloc[0]["elections"]) == 1
    assert not bool(merged.iloc[0]["elections_ambiguous"])
