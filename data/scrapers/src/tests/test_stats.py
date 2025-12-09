import pytest

from analysis.stats import Statistics
from main import _setup_context
from scrapers.stores import ProcessPolicy


@pytest.fixture
def ctx():
    return _setup_context(False)[0]


@pytest.fixture
def stats(ctx):
    stats = Statistics()
    return stats.read_or_process(ctx, ProcessPolicy({"Statistics"}, set()))


def test_expected_people(stats):
    assert stats[stats["good"]]["count"].sum() > 7000
    assert stats[stats["good"] & stats["wiki_name"]]["count"].sum() > 450
