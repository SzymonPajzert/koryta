import pytest
from pytest_check.context_manager import check

from conductor import setup_context
from pipelines import PeoplePKW


@pytest.fixture(scope="module")
def ctx():
    return setup_context()[0]


@pytest.fixture(scope="module")
def df(ctx):
    pipeline = PeoplePKW()
    return pipeline.read_or_process(ctx)


@pytest.mark.parametrize(
    "column",
    [
        "party",
        "election_year",
        "teryt_candidacy",
        "sex",
        "birth_year",
    ],
)
def test_check_no_nulls(column, df):
    # Known data gaps that we accept for now.
    # TODO resolve them
    known_failures = {
        ("1994", "samorząd", "party"),
        ("1993", "senat", "teryt_candidacy"),
        ("1997", "sejm", "teryt_candidacy"),
        ("1997", "senat", "teryt_candidacy"),
        ("2001", "sejm", "teryt_candidacy"),
        ("2001", "senat", "teryt_candidacy"),
        ("2005", "senat", "teryt_candidacy"),
        ("2010", "samorząd", "sex"),
        ("2001", "sejm", "birth_year"),
        ("2001", "senat", "birth_year"),
        ("2004", "europarlament", "birth_year"),
        ("2005", "sejm", "birth_year"),
        ("2005", "senat", "birth_year"),
        ("2007", "sejm", "birth_year"),
        ("2007", "senat", "birth_year"),
        ("2009", "europarlament", "birth_year"),
        ("2011", "sejm", "birth_year"),
        ("2011", "senat", "birth_year"),
        ("2014", "europarlament", "birth_year"),
        ("2015", "sejm", "birth_year"),
        ("2015", "senat", "birth_year"),
        ("2019", "europarlament", "birth_year"),
        ("2019", "sejm", "birth_year"),
        ("2019", "senat", "birth_year"),
        ("2023", "sejm", "birth_year"),
        ("2023", "senat", "birth_year"),
        ("2024", "europarlament", "birth_year"),
    }
    grouped = df.groupby(["election_year", "election_type"])[column].apply(
        lambda x: x.notnull().all()
    )
    for (year, election), passing in grouped.items():
        if passing:
            continue

        if (str(year), election.rstrip("u"), column) in known_failures:
            continue

        with check:
            assert False, f"missing data in {column} for {year} {election.rstrip('u')}"


@pytest.mark.parametrize(
    "column",
    [
        "pkw_name",
        "first_name",
        "middle_name",
        "last_name",
        "party",
        "party_member",
        "teryt_candidacy",
    ],
)
def test_check_no_whitespaces(column, df):
    for row in df.to_dict(orient="records"):
        value = row[column]
        if value is None:
            continue
        if not isinstance(value, str):
            value = str(value)
        assert value.strip() == value, f"whitespaces in {row}"


#: The województwo of each European district's seat - see `european_districts`.
EUROPEAN_SEATS = {
    "02",
    "04",
    "06",
    "08",
    "10",
    "12",
    "14",
    "18",
    "22",
    "24",
    "28",
    "30",
}


def test_every_european_candidacy_is_placed_in_its_district(df):
    """`test_check_no_nulls` lets an empty code through, and an empty code is
    what the 2014 and 2024 lists carried until 2026-10 (2009's was null): the
    ingest dropped every one of those candidacies for want of a place."""
    european = df[df["election_type"] == "europarlamentu"]

    assert set(european["election_year"].astype(str)) == {
        "2004",
        "2009",
        "2014",
        "2019",
        "2024",
    }
    unplaced = european[~european["teryt_candidacy"].isin(EUROPEAN_SEATS)]
    assert unplaced.empty, unplaced[["election_year", "pkw_name", "teryt_candidacy"]]


def test_a_european_home_is_not_read_as_the_district(df):
    """The 2019 and 2024 lists say where each candidate lives, and that is where
    the 2019 runs were filed before the district was read."""
    european = df[
        (df["election_type"] == "europarlamentu")
        & df["election_year"].astype(str).isin(["2019", "2024"])
    ]

    assert european["teryt_living"].str.fullmatch(r"\d{6}").all()


#: How many candidates each national election elected: the Sejm's 460 and the
#: Senate's 100 are fixed by the constitution, and Poland's share of the
#: European Parliament is set for each term. PKW marks 52 in 2019, the seat
#: Brexit added among them.
NATIONAL_SEATS = {"sejmu": 460, "senatu": 100}
EUROPEAN_SEATS_BY_YEAR = {"2004": 54, "2009": 50, "2014": 51, "2019": 52, "2024": 53}


def test_every_election_marks_its_winners(df):
    """Since 2026-10-27 the site stores PKW's losses as well as its wins, so a
    file read without its result column no longer just leaves its winners
    unmarked. `parse_yes_no` and `parse_mandate` read a blank cell as a loss,
    which in a column that is there is what it means, and every candidate the
    file lists would go up as beaten. So every office of every election has
    winners and losers, and a national election as many winners as it had
    seats. On the 2026-10-24 build every block passes, Sejm and Senate to the
    seat."""
    result = df["candidacy_success"].astype(str).str.upper()
    blocks = (
        df.assign(
            won=result == "TRUE",
            lost=result == "FALSE",
            year=df["election_year"].astype(str),
            office=df["office"].fillna(""),
        )
        .groupby(["election_type", "year", "office"])[["won", "lost"]]
        .sum()
    )
    for (kind, year, office), row in blocks.iterrows():
        name = " ".join(part for part in (kind, year, office) if part)
        with check:
            assert row["won"] > 0, f"nobody won {name}"
        with check:
            assert row["lost"] > 0, f"nobody lost {name}"

    winners = blocks["won"].groupby(level=["election_type", "year"]).sum()
    for (kind, year), count in winners.items():
        seats = NATIONAL_SEATS.get(kind)
        if kind == "europarlamentu":
            seats = EUROPEAN_SEATS_BY_YEAR.get(year)
        if seats is None:
            continue
        with check:
            assert count == seats, f"{kind} {year}: {count} marked won of {seats} seats"


def test_every_2024_mayor_reads_as_elected(df):
    """PKW's list of who was elected in 2024 (wybrani_wojt_burmistrz_prezydent)
    names 1,457 wójtowie, 912 burmistrzowie and 107 prezydenci, and one more
    seat nobody won: Wilkowice's one candidate lost the vote for or against him.
    748 of them won a run-off, and until the second round's file was read too
    they were all beaten here - 47 prezydenci of 107."""
    mayors = df[
        (df["election_year"].astype(str) == "2024")
        & df["office"].isin(["Wójt", "Burmistrz", "Prezydent"])
    ]
    elected = mayors[mayors["candidacy_success"].astype(str).str.upper() == "TRUE"]

    assert elected.groupby("office").size().to_dict() == {
        "Burmistrz": 912,
        "Prezydent": 107,
        "Wójt": 1457,
    }
    # Each of them once: a run-off is the first round's candidacy, not another.
    assert not elected.duplicated(["position", "teryt_candidacy"]).any()
