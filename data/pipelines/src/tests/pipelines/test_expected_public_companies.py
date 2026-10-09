"""Companies whose ownership somebody has looked at, and whether they are public.

`expected_public_companies.csv` holds one row per company: the status it should
have (`public`, `not_public` or `formerly_public`), the basis for that, who owns
it and where that is written. Szymon asked for it on 2026-10-09 ("it should be
treated like a test file. I'll verify it later if it's as I expect it"), and
fills `checked` as he goes: `yes`, or the status it should have instead.

The basis says how settled a row is.

- A rule Szymon set: `rule_any_public_stake` (2026-10-07: any public owner, at
  any stake, makes a company public, and its subsidiaries with it),
  `rule_struck_off_owner` (the owner a company had when it was struck off),
  `researched_owner` (`RESEARCHED_OWNERS`), `regon_code` (REGON's ownership
  code), `wikipedia_owner` (an owner only the company's article names), and
  `evidence_not_public` for a company nobody public owns, founded or joins.
  These are checked against `companies_merged` every time.
- A proposal waiting on his decision: `proposed_public_founder`,
  `proposed_public_members` (decide-public-foundations-and-associations) and
  `proposed_formerly_public` (decide-formerly-public-companies). They are
  skipped until `checked` is filled.

Where the pipeline gets a row wrong today, `known_gap` names the task that will
fix it, and the row is an expected failure. It is strict: when the fix lands
the row passes, the run goes red, and the fix removes `known_gap` in the same
change. So the night's tests step sees a new failure only when an expectation
breaks or a gap closes, never from rows that were already wrong.

Filling `checked` on a proposal the pipeline does not yet agree with makes the
row fail; give it a `known_gap` in the same edit. `formerly_public` rows stay
skipped even when checked: nothing records a "public until" date yet.
"""

import csv
import dataclasses
import re
from pathlib import Path

import pytest

from analysis.interesting import Companies
from conductor import setup_context
from scrapers.krs.columns import is_public
from scrapers.krs.odpis_people import fold

EXPECTED_FILE = Path(__file__).with_name("expected_public_companies.csv")

STATUSES = ("public", "not_public", "formerly_public")
RULES = (
    "rule_any_public_stake",
    "rule_struck_off_owner",
    "researched_owner",
    "regon_code",
    "wikipedia_owner",
    "evidence_not_public",
)
PROPOSALS = (
    "proposed_public_founder",
    "proposed_public_members",
    "proposed_formerly_public",
)
KRS = re.compile(r"\d{10}")
#: A Firestore id, for a page with no KRS number (Ministerstwo Obrony Narodowej).
NODE_ID = re.compile(r"[A-Za-z0-9]{20}")
#: An ISO date, or as much of one as the source gives.
PARTIAL_DATE = re.compile(r"\d{4}(-\d{2}(-\d{2})?)?")


@dataclasses.dataclass(frozen=True)
class Expected:
    krs: str
    name: str
    expected: str
    public_until: str
    basis: str
    owners: str
    source: str
    confidence: str
    known_gap: str
    found_by: str
    note: str
    checked: str

    @property
    def status(self) -> str:
        """`expected`, unless Szymon wrote another status into `checked`."""
        return self.checked if self.checked in STATUSES else self.expected

    @property
    def why_skipped(self) -> str | None:
        """Why the pipeline cannot be held to this row yet, or None if it can."""
        if self.basis in PROPOSALS and not self.checked:
            return f"awaiting Szymon's check: {self.basis}"
        if self.checked and self.checked != "yes" and self.checked not in STATUSES:
            return f"Szymon's correction, not applied to the row yet: {self.checked}"
        if self.status == "formerly_public":
            return "nothing records a 'public until' date yet"
        if not KRS.fullmatch(self.krs):
            gap = f" ({self.known_gap})" if self.known_gap else ""
            return f"no KRS number, so no pipeline reaches it{gap}"
        return None


def read_expected() -> list[Expected]:
    with EXPECTED_FILE.open(encoding="utf-8", newline="") as f:
        return [
            Expected(**{key: (value or "").strip() for key, value in row.items()})
            for row in csv.DictReader(f)
        ]


EXPECTED = read_expected()


def as_param(row: Expected):
    marks = []
    if row.known_gap and row.why_skipped is None:
        marks.append(
            pytest.mark.xfail(
                strict=True,
                reason=f"known gap, task {row.known_gap}: "
                f"https://koryta.pl/admin/zadania#t-{row.known_gap}",
            )
        )
    slug = "-".join(re.sub(r"[^a-z0-9]+", " ", fold(row.name)).split()[:4])
    return pytest.param(row, id=f"{row.krs}-{slug}", marks=marks)


def test_the_file_is_well_formed():
    """Typos in a hand-edited file, caught without any pipeline output."""
    problems: list[str] = []
    seen: set[str] = set()
    for row in EXPECTED:
        where = f"{row.krs} {row.name}"
        if not (KRS.fullmatch(row.krs) or NODE_ID.fullmatch(row.krs)):
            problems.append(f"{where}: krs is neither 10 digits nor a node id")
        if row.krs in seen:
            problems.append(f"{where}: listed twice")
        seen.add(row.krs)
        if row.expected not in STATUSES:
            problems.append(f"{where}: expected {row.expected!r}")
        if row.basis not in RULES + PROPOSALS:
            problems.append(f"{where}: basis {row.basis!r}")
        if not row.owners:
            problems.append(f"{where}: says nothing of who owns it")
        if not row.source:
            problems.append(f"{where}: no source")
        if (row.expected == "formerly_public") != bool(row.public_until):
            problems.append(f"{where}: public_until goes with formerly_public only")
        if row.public_until and not PARTIAL_DATE.fullmatch(row.public_until):
            problems.append(f"{where}: public_until {row.public_until!r} is not a date")
        if (row.basis == "evidence_not_public") != (row.expected == "not_public"):
            problems.append(f"{where}: {row.expected} on {row.basis}")
        if row.checked and row.checked != "yes" and row.checked not in STATUSES:
            # Not a problem, only a correction waiting to be applied: say so.
            print(f"{where}: checked says {row.checked!r}")
    assert not problems, "\n".join(problems)


@pytest.fixture(scope="module")
def public_by_krs() -> dict[str, bool]:
    ctx = setup_context()[0]
    companies = Companies().read_or_process(ctx)
    return dict(zip(companies["krs"], is_public(companies["is_public"])))


@pytest.mark.parametrize("row", [as_param(row) for row in EXPECTED])
def test_company_has_the_expected_public_status(public_by_krs, row: Expected):
    if row.why_skipped is not None:
        pytest.skip(row.why_skipped)
    if row.krs not in public_by_krs:
        pytest.skip("not in companies_merged: no crawl has reached it yet")
    actual = public_by_krs[row.krs]
    assert actual == (row.status == "public"), (
        f"{row.krs} {row.name} should be {row.status} ({row.basis}: {row.owners}; "
        f"{row.source}), and companies_merged has is_public={actual}. If the "
        "pipeline cannot know it yet, name the task that will fix it in known_gap."
    )
