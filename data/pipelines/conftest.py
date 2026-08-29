"""Session-wide guards that apply to every test in this package.

Both of these exist because a test here can reach the outside world by
accident. A pipeline test calls ``read_or_process``, which is the same entry
point a real run uses, so anything the runner would do on a cache miss - fetch,
rebuild, upload - a test will do too unless something stops it.
"""

import os

import pytest

from stores.config import VERSIONED_DIR

#: Set by :func:`pytest_runtest_setup` and undone by the teardown hook.
_PREVIOUS_DISABLE_BACKUP: list[str | None] = []


def _block_shared_cache_writes(item: pytest.Item) -> None:
    """Stop a test from writing into the shared GCS cache.

    ``backup_to_shared_cache`` defaults to True, and ``.env`` here sets only
    ``USERNAME``, so any pipeline a test happened to rebuild uploaded its output
    to ``gs://koryta-pl-sharedcache`` under the owner's name. That bucket is
    shared with his own runs and the service account on this box can create
    objects but not delete them, so a stray upload is permanent and looks
    exactly like a real run of the pipeline. One went up at 2026-08-28T23:26:14
    from a test run, which is why this hook exists.

    ``DISABLE_BACKUP`` is the switch ``koryta --no-backup`` already sets
    (``src/koryta.py:153``); ``backup_disabled()`` re-reads it on every call and
    ``load_dotenv()`` will not override a variable that is already set. It
    disables the restore path too, which is the point: a test should not be
    reaching the network at all.

    Set per test rather than once per session so that a test *about* the backup
    code can opt out with ``@pytest.mark.exercises_backup`` - those fake the
    storage layer and assert on the calls, so the short circuit would leave them
    asserting against a code path that never ran.
    """
    if item.get_closest_marker("exercises_backup"):
        _PREVIOUS_DISABLE_BACKUP.append(None)
        return
    _PREVIOUS_DISABLE_BACKUP.append(os.environ.get("DISABLE_BACKUP"))
    os.environ["DISABLE_BACKUP"] = "1"


def pytest_runtest_teardown(item: pytest.Item) -> None:
    """Put ``DISABLE_BACKUP`` back the way the test found it."""
    if not _PREVIOUS_DISABLE_BACKUP:
        return
    previous = _PREVIOUS_DISABLE_BACKUP.pop()
    if item.get_closest_marker("exercises_backup"):
        return
    if previous is None:
        os.environ.pop("DISABLE_BACKUP", None)
    else:
        os.environ["DISABLE_BACKUP"] = previous


def pytest_runtest_setup(item: pytest.Item) -> None:
    """Skip an ``e2e`` test whose ``versioned/`` inputs are not on this machine.

    ``e2e`` says a test needs state the repository does not carry; it does not
    say what to do when that state is absent, and the answer used to be "find
    out the hard way". Without the output it needs, ``read_or_process`` falls
    through to running the pipeline for real - for the people DAG that means
    resuming a ~2.9 GB Wikipedia dump download and a forty-minute parse, from
    what the reader believes is a test run.

    So a module names what it reads and gets a skip that says which file is
    missing. The check is deliberately a plain file test rather than anything
    that consults the pipeline graph: it has to be cheap enough to run before
    every test, and wrong only in the safe direction - a present-but-stale
    output still runs the test, which is what produced the diagnosis this
    fixture came out of.
    """
    _block_shared_cache_writes(item)

    for mark in item.iter_markers(name="needs_versioned"):
        missing = [
            name
            for name in mark.args
            if not os.path.exists(os.path.join(VERSIONED_DIR, name, f"{name}.jsonl"))
        ]
        if missing:
            pytest.skip(
                "needs output from a completed pipeline run; "
                f"versioned/ has no {', '.join(missing)}"
            )
