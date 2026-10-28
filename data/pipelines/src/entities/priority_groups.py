"""Priority groups: companies whose people a capped upload sends ahead of the rest.

Szymon, 2026-10-27: a new way to choose whom the night uploads - priority
categories of companies, defined in flags, the first of them the companies the
Treasury holds a stake in ("Skarb Państwa"), each with a budget of its own, so
that a person sent for a group takes nothing of the night's other caps. On
2026-10-28: the groups go after the noted pages.

    --priority-group skarb-panstwa:treasury:100:new=50

is `NAME:SOURCE:BUDGET[:new=N]`. The flag repeats, and the groups go in the
order given. The sources:

- `treasury`: the companies on Prokuratoria's list of the Treasury's stakes
  (`scrapers.krs.data.TREASURY_LIST`), by the NIP the register gives each -
  the list that already makes them public (`CompaniesKRS.compute_public_krss`),
  so the group and the flag cannot disagree. 317 companies on 2026-10-27.
- `krs=0000012345,0000067890`: companies named by hand, a batch asked for.
- `category=energetyka`: the public companies the site files under a category
  (`entities.company_categories`), by the rule `--company-category` uses.

A member is somebody in a post now - any post, with no end - at one of the
group's companies itself: not at a subsidiary, and not in one that ended.
`BUDGET` is how many of them a run sends for the group, and `new` how many of
those may be pages it creates - the budget unless given, never more. Which of
them a run sends, and what each counts against, is the job's
(`jobs.people_import.plan_priority`); who belongs to which group is
`analysis.payloads.priority.group_names`.
"""

import argparse
import re
from dataclasses import dataclass

from entities.company_categories import CATEGORY_VALUES

TREASURY = "treasury"
KRS = "krs"
CATEGORY = "category"

#: What a group may be called: it names the group in the run's summary and in
#: every line of what the run sent.
NAME = re.compile(r"[a-z0-9][a-z0-9-]*")

USAGE = "NAME:SOURCE:BUDGET[:new=N], e.g. skarb-panstwa:treasury:100:new=50"


@dataclass(frozen=True)
class Group:
    """One `--priority-group`."""

    name: str
    #: `TREASURY`, `KRS` or `CATEGORY`.
    source: str
    #: How many of its members a run sends for it.
    budget: int
    #: How many of those may be pages the run creates.
    new: int
    #: `krs=`: the companies, as ten-digit KRS numbers.
    krs: tuple[str, ...] = ()
    #: `category=`: the category's value.
    category: str = ""
    #: The flag's value as given: what the night hands on to its steps.
    text: str = ""

    def describe(self) -> str:
        if self.source == TREASURY:
            return "the companies on Prokuratoria's list of the Treasury's stakes"
        if self.source == CATEGORY:
            return f"the public companies filed under {self.category}"
        return f"{len(self.krs)} companies named by KRS number"


def parse_group(text: str) -> Group:
    """A `--priority-group` value, or the reason it is not one."""
    parts = text.split(":")
    if len(parts) < 3 or not all(parts[:3]):
        raise argparse.ArgumentTypeError(f"{text!r}: expected {USAGE}")
    name, source, budget, *options = parts
    if not NAME.fullmatch(name):
        raise argparse.ArgumentTypeError(
            f"{name!r}: a group's name is lowercase letters, digits and dashes"
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
    kind, _, value = source.partition("=")
    if kind == TREASURY and not value:
        return Group(name, TREASURY, sends, new, text=text)
    if kind == KRS and value:
        companies = tuple(krs_number(krs) for krs in value.split(","))
        return Group(name, KRS, sends, new, krs=companies, text=text)
    if kind == CATEGORY and value in CATEGORY_VALUES:
        return Group(name, CATEGORY, sends, new, category=value, text=text)
    raise argparse.ArgumentTypeError(
        f"{source!r}: the source is {TREASURY}, {KRS}=<KRS,KRS...> or "
        f"{CATEGORY}=<one of {', '.join(CATEGORY_VALUES)}>"
    )


def repeated(groups: "list[Group]") -> list[str]:
    """The names more than one of `groups` goes by."""
    names = [group.name for group in groups]
    return sorted({name for name in names if names.count(name) > 1})


def count(text: str, what: str) -> int:
    if not text.isdigit():
        raise argparse.ArgumentTypeError(f"{text!r}: {what} is a whole number")
    return int(text)


def krs_number(text: str) -> str:
    """A KRS number as the ten digits everything else uses."""
    if not text.isdigit() or len(text) > 10:
        raise argparse.ArgumentTypeError(f"{text!r}: not a KRS number")
    return text.zfill(10)
