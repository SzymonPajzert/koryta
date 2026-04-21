import pytest

from conductor import setup_context
from koryta import Pipeline
from scrapers.kmgp.kmgp import PeopleKMGP


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
