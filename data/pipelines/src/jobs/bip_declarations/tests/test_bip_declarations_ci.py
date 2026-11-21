"""The files the site's tests and the declarations job's tests both read.

Each side checks the contract between them against the other's files: the
job's upload against the site's schema and limits, the site's ingest against
the job's upload, both foldings of a role's name against one table. CI runs
each suite only on changes to its own side, so a file on that list has to
run both, or the contract is checked on one side only.
"""

import re
from pathlib import Path

import pytest
import yaml

REPOSITORY = Path(__file__).resolve().parents[6]
WORKFLOWS = REPOSITORY / ".github" / "workflows"

#: Each file, and why the other side's tests read it.
SHARED = {
    # The role chips and their families, which util.declaration_roles reads.
    "frontend/shared/declarationEmploymentRoles.json": "python",
    # Names with their families, checked by both foldings.
    "frontend/tests/shared/declarationEmploymentRoleFamilies.json": "python",
    # The employment ingest's schema and limits, which the upload keeps to.
    "frontend/shared/declarationEmployment.ts": "python",
    # The date ingest's limits, which the upload keeps to as well.
    "frontend/shared/declarations.ts": "python",
    # What the upload sends, which the site's tests parse and store.
    "data/pipelines/src/jobs/bip_declarations/tests/employment_upload.json": "vitest",
}

#: The workflow that runs each suite, and the events it filters by path.
SUITES = {
    "python": ("python.yml", ("pull_request",)),
    "vitest": ("vitest.yml", ("push", "pull_request")),
}


def _glob(pattern: str) -> re.Pattern[str]:
    """A path filter as GitHub reads it: `**` spans folders, `*` one name."""
    regex = re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
    return re.compile(rf"{regex}\Z")


def _runs_on(workflow: str, event: str, path: str) -> bool:
    data = yaml.safe_load((WORKFLOWS / workflow).read_text(encoding="utf-8"))
    # YAML 1.1 reads the key `on` as True.
    trigger = (data.get("on") or data.get(True) or {})[event]
    patterns = (trigger or {}).get("paths")
    if patterns is None:
        return True
    taken = False
    for pattern in patterns:
        if _glob(pattern.removeprefix("!")).match(path):
            taken = not pattern.startswith("!")
    return taken


@pytest.mark.parametrize(("path", "suite"), SHARED.items())
def test_a_shared_file_runs_the_other_sides_tests(path, suite):
    workflow, events = SUITES[suite]
    for event in events:
        assert _runs_on(workflow, event, path), (workflow, event)


@pytest.mark.parametrize(
    ("workflow", "event", "path", "runs"),
    [
        ("python.yml", "pull_request", "data/pipelines/src/util/polish.py", True),
        ("python.yml", "pull_request", "frontend/app/pages/index.vue", False),
        ("vitest.yml", "push", "frontend/shared/declarationEmployment.ts", True),
        ("vitest.yml", "pull_request", "data/pipelines/src/util/polish.py", False),
    ],
)
def test_the_filters_read_as_github_reads_them(workflow, event, path, runs):
    assert _runs_on(workflow, event, path) is runs
