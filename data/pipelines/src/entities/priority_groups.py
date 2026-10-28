"""Priority groups: a category's companies, whose people a capped upload sends
ahead of the rest.

Szymon, 2026-10-27: a new way to choose whom the night uploads - priority
categories of companies, defined in flags, the first of them the companies the
Treasury holds a stake in ("Skarb Państwa"), each with a budget of its own, so
that a person sent for a group takes nothing of the night's other caps. On
2026-10-28: the groups go after the noted pages, and Skarb Państwa becomes a
category on the site (`entities.company_categories.SKARB_PANSTWA`), so a group
is a category and nothing else.

    --priority-group skarb-panstwa:100:new=50

is `CATEGORY:BUDGET[:new=N]`, the category one of `CATEGORY_VALUES`. The flag
repeats, and the groups go in the order given. A group's companies are the
public ones the category files them under, by the rule the site's filter and
`--company-category` read (`analysis.extract.category_companies`).

A member is somebody in a post now - any post, with no end - at one of the
group's companies itself: not at a subsidiary, and not in one that ended.
`BUDGET` is how many of them a run sends for the group, and `new` how many of
those may be pages it creates - the budget unless given, never more. Which of
them a run sends, and what each counts against, is the job's
(`jobs.people_import.plan_priority`); who belongs to which group is
`analysis.payloads.priority.group_names`.
"""

import argparse
from dataclasses import dataclass

from entities.company_categories import CATEGORY_VALUES

USAGE = "CATEGORY:BUDGET[:new=N], e.g. skarb-panstwa:100:new=50"


@dataclass(frozen=True)
class Group:
    """One `--priority-group`."""

    #: The category's value: what names the group in the run's summary and in
    #: every line of what the run sent.
    name: str
    #: How many of its members a run sends for it.
    budget: int
    #: How many of those may be pages the run creates.
    new: int
    #: The flag's value as given: what the night hands on to its steps.
    text: str = ""

    def describe(self) -> str:
        return f"the public companies filed under {self.name}"


def parse_group(text: str) -> Group:
    """A `--priority-group` value, or the reason it is not one."""
    parts = text.split(":")
    if len(parts) < 2 or not all(parts[:2]):
        raise argparse.ArgumentTypeError(f"{text!r}: expected {USAGE}")
    name, budget, *options = parts
    if name not in CATEGORY_VALUES:
        raise argparse.ArgumentTypeError(
            f"{name!r}: a group is a category, one of {', '.join(CATEGORY_VALUES)}"
        )
    sends = count(budget, "the budget")
    new = sends
    for option in options:
        key, _, value = option.partition("=")
        if key != "new" or not value:
            raise argparse.ArgumentTypeError(
                f"{option!r}: the one option a group takes is new=N"
            )
        new = count(value, "new")
    if new > sends:
        raise argparse.ArgumentTypeError(
            f"{text!r}: new={new} is more pages than the {sends} people it sends"
        )
    return Group(name, sends, new, text=text)


def repeated(groups: "list[Group]") -> list[str]:
    """The names more than one of `groups` goes by."""
    names = [group.name for group in groups]
    return sorted({name for name in names if names.count(name) > 1})


def count(text: str, what: str) -> int:
    if not text.isdigit():
        raise argparse.ArgumentTypeError(f"{text!r}: {what} is a whole number")
    return int(text)
