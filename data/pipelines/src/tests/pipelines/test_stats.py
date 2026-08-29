import pytest

from analysis.stats import Statistics
from conductor import setup_context

#: Runs a real pipeline through ``read_or_process``, so it needs the
#: ``versioned/`` output of a completed run - which is what ``e2e`` marks.
#: ``person_wikipedia`` is named because it is the one output whose absence
#: reaches ``ProcessWiki``, and rebuilding that resumes a ~2.9 GB Wikipedia
#: dump download and a forty-minute parse from inside what looks like a
#: test run.
pytestmark = [pytest.mark.e2e, pytest.mark.needs_versioned("person_wikipedia")]


@pytest.fixture
def ctx():
    return setup_context()[0]


@pytest.fixture
def stats(ctx):
    stats = Statistics()
    return stats.read_or_process(ctx)


def test_expected_people(stats):
    assert stats[stats["good"]]["count"].sum() > 7000
    assert stats[stats["good"] & stats["wiki_name"]]["count"].sum() > 450
