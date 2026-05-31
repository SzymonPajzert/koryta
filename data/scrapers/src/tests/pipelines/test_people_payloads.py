import sys
import typing
from dataclasses import dataclass
from unittest.mock import patch

import pytest

from entities.composite import Person
from koryta import setup_context
from pipelines import PeoplePayloads


@pytest.fixture
def ctx():
    return setup_context(False)[0]


@pytest.fixture
def outputs_df(ctx, request):
    # TODO the params should be handled by the pipeline migration
    if request.param == "":
        with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
            pipeline = PeoplePayloads()
            return pipeline.read_or_process(ctx)

    with patch.object(
        sys, "argv", ["koryta", "PeoplePayloads", "--region", request.param]
    ):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process(ctx)


@pytest.fixture
def outputs_list(ctx, request) -> typing.Iterable[Person]:
    with patch.object(
        sys, "argv", ["koryta", "PeoplePayloads", "--region", request.param]
    ):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process_list(ctx)


@pytest.mark.parametrize("outputs_df", [("3061"), ("3063"), ("3064")], indirect=True)
def test_non_empty_elections(outputs_df):
    elections_lengths = outputs_df["elections"].apply(
        lambda x: len(x) if isinstance(x, list) else 0
    )
    some_elections = len(elections_lengths[elections_lengths != 0])

    assert some_elections / len(elections_lengths) > 0.2


@pytest.mark.parametrize("outputs_df", [("3061"), ("3063"), ("3064")], indirect=True)
def test_non_empty_wikipedia(outputs_df):
    has_wiki_entries = outputs_df["wikipedia"].apply(
        lambda x: len(x) > 0 if isinstance(x, str) else False
    )
    some_wiki_entries = len(has_wiki_entries[has_wiki_entries])
    assert some_wiki_entries > 0


@pytest.mark.skip(reason="TODO mapping to list is failing")
@pytest.mark.parametrize("outputs_list", [("3061"), ("3063"), ("3064")], indirect=True)
def test_roles_non_empty(outputs_list):
    for person in outputs_list:
        for company in person.companies:
            assert company.role is not None, f"No role for {person.name}"


CONFIRMED_PUBLIC = {
    1281709,
    1496535,
}

EXPECTED_REJESTRIO_ENTRIES = [
    # People from Rada Miasta Kraków
    2585275,
    775848,
    3466426,
    1496535,  # Contains https://rejestr.io/krs/367964/malopolski-regionalny-fundusz-poreczeniowy
    2016431,
    483409,
    # 3396675, TODO - but she's in an interesting org, we should track it somewhere
    1335842,
    839619,
    374707,
    875769,
    1287087,
    2456438,
    1194906,
    # 56415,
    390304,
    90690,
    # 259496, no public employments
    # 3192722,
    1257087,
    1802484,
    # 57996,
    1205347,
    # 1490826, no public employments
    654570,
    752869,
    2769750,
    # People from Sejmik Województwa Małopolskiego
    1336689,
    147600,
    1336689,
    147600,
    1173777,
    2242764,
    4999,
    1281709,
    727228,
    1273316,
    1258289,
    921721,
    702144,
    738890,
    1244292,
    694315,
    1350410,
    1356875,
    1021650,
    1209075,
    72070,
    3076050,
    2301302,
    973977,
]


@pytest.mark.skip(reason="TODO too many failures for now")
@pytest.mark.parametrize("outputs_df", [("")], indirect=True)
def test_expected_output(outputs_df):
    rejestr_ids = outputs_df["rejestrIo"].apply(lambda x: x.split("/")[-1])
    extracted = set(rejestr_ids.to_list())
    expected = set(str(id) for id in EXPECTED_REJESTRIO_ENTRIES)

    missing = expected - extracted
    fail_rate = len(missing) / len(expected)
    assert fail_rate < 0.2, (
        f"Missing entries are {fail_rate:.2%} of total (https://rejestr.io/osoby/{list(missing)[0]}):{missing}"
    )


@dataclass
class Node:
    name: str
    id: str
    url: str


# Skopiuj dane z https://autopush.koryta.pl/api/notes?page=3
EXPECTED_WIKIPEDIA = [
    Node(
        "Stefan Wilkanowicz",
        "2JI82DDVlJw9a407q316",
        "https://pl.wikipedia.org/wiki/Stefan_Wilkanowicz",
    ),
    Node(
        "Jan Tadeusz Pamuła",
        "BC0DFzdDXh4j9uSLWFGS",
        "https://pl.wikipedia.org/wiki/Jan_Pamu%C5%82a_(ekonomista)",
    ),
    Node(
        "Wojciech Franciszek Wróblewski",
        "ElNMza6uZcOfDiA77PRz",
        "https://pl.wikipedia.org/wiki/Wojciech_Wr%C3%B3blewski_(socjolog)",
    ),
]


@pytest.mark.parametrize("outputs_df", [("")], indirect=True)
def test_expected_wikipedia(outputs_df):
    wiki_urls = outputs_df["wikipedia"].dropna().to_list()
    wiki_urls = [url for url in wiki_urls if isinstance(url, str)]

    missing = []
    for expected in EXPECTED_WIKIPEDIA:
        if not any(expected.url in url for url in wiki_urls):
            missing.append(expected.url)

    assert not missing, f"Missing Wikipedia pages: {missing}"
