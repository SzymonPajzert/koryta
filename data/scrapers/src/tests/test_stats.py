import pytest

from analysis.stats import Statistics
from main import run_pipeline


@pytest.fixture(scope="module")
def stats():
    return run_pipeline(Statistics, refresh_target="Statistics")[1]


def test_expected_people(stats):
    assert stats[stats["good"]]["count"].sum() > 7000
