import pytest

from conductor import setup_context
from koryta import Pipeline
from scrapers.kmgp.people import PeopleKMGP


@pytest.fixture(scope="module")
def output_list(ctx):
    p: PeopleKMGP = Pipeline.create(PeopleKMGP)
    return list(p.read_or_process_list(ctx))


@pytest.fixture(scope="module")
def output_df(ctx):
    p: PeopleKMGP = Pipeline.create(PeopleKMGP)
    return p.read_or_process(ctx)


@pytest.fixture(scope="module")
def ctx():
    c, _ = setup_context(False)
    return c


MISSING_NAMES = [
    # TODO why we can't find this data in the pkw datasets?
    "Dawid JABROCKI",
    "Edward Czesław CUDEK",
    "Izabela Barbara SKUPIEŃ",
]


def test_elections_set(output_list):
    total = len([p for p in output_list if p.name not in MISSING_NAMES])
    with_elections = len([p for p in output_list if len(p.elections) > 0])
    assert with_elections == total


def test_companies_set(output_list):
    total = len(output_list)
    with_companies = len([p for p in output_list if len(p.companies) > 0])

    success_rate = with_companies / total if total > 0 else 0
    print(
        f"\nTotal people: {total}, \
            With companies: {with_companies}, Success rate: {success_rate:.2%}"
    )

    # Asserting a high enough success rate based on our expectations
    assert success_rate > 0.8, f"Success rate is too low: {success_rate:.2%}"
