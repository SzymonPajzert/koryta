import os
import warnings
from collections.abc import Callable

import pytest

from conductor import setup_context
from scrapers.koryta.snapshot import Snapshot, load_snapshot

#: How far past its known count a budgeted invariant may go and still pass.
#:
#: A budget is a count measured on one export, and the site moves every day.
#: A test that fails tonight and passed last night holds the night's upload
#: (`jobs.nightly`), so a budget measured to the document was one page away
#: from doing it: a reviewer publishing one page with a namesake's candidacy
#: on it took `test_nobody_stands_in_two_places_at_once` from 24 to 25 on the
#: 2026-10-15 export, which was enough to hold that night's upload. Inside the
#: buffer a test passes and warns, and the night reports the warning; past it,
#: it fails as before. A warning is the time to repair the data or measure the
#: budget again, before the buffer runs out.
BUDGET_BUFFER = 10


class BudgetWarning(UserWarning):
    """A budgeted invariant counted more than it is known to, inside the buffer."""


@pytest.fixture
def within_budget(request: pytest.FixtureRequest) -> Callable[[int, int], bool]:
    """Whether a count keeps to its test's budget: the `known` count the test
    carries, plus `BUDGET_BUFFER`.

    A count past the known one and inside the buffer passes with a
    `BudgetWarning`, and its numbers go on the test as junit properties -
    `budget_count`, `budget_known` and `budget_limit` - which is where the night
    reads them (`budget_warnings` in jobs/nightly). Straight onto the item
    rather than through `record_property`, which warns on every test that it
    does not suit the default junit family.
    """
    item = request.node
    assert isinstance(item, pytest.Item)

    def check(count: int, known: int) -> bool:
        limit = known + BUDGET_BUFFER
        if known < count <= limit:
            item.user_properties += [
                ("budget_count", count),
                ("budget_known", known),
                ("budget_limit", limit),
            ]
            warnings.warn(
                BudgetWarning(
                    f"{count}, up from the {known} known; fails past {limit}"
                ),
                stacklevel=2,
            )
        return count <= limit

    return check


@pytest.fixture(scope="session")
def snapshot() -> Snapshot:
    """The most recent complete Firestore export, shared by the whole session.

    Session-scoped for two reasons: the export is tens of megabytes and parsing
    it is the slow part of these tests, and every test has to see the *same*
    export. Checking that an edge's target exists is meaningless if the edges
    come from one snapshot and the nodes from another taken twelve hours later.

    Set ``KORYTA_EXPORT`` to a timestamp from the bucket
    (``2026-07-28T14:25:08.897Z``) to pin the tests to one export - to reproduce
    a failure against the data that produced it, or to tell a regression apart
    from a difference between two days.
    """
    return load_snapshot(setup_context()[0], os.environ.get("KORYTA_EXPORT"))
