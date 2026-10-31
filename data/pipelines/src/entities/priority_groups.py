"""Priority groups: whose people a capped upload sends ahead of the rest - a
category's companies, or the people whose oświadczenie majątkowe the BIP crawl
downloaded.

Szymon, 2026-10-27: a new way to choose whom the night uploads - priority
categories of companies, defined in flags, the first of them the companies the
Treasury holds a stake in ("Skarb Państwa"), each with a budget of its own, so
that a person sent for a group takes nothing of the night's other caps. On
2026-10-28: the groups go after the noted pages, and Skarb Państwa becomes a
category on the site (`entities.company_categories.SKARB_PANSTWA`).

    --priority-group skarb-panstwa:100:new=50

is `NAME:BUDGET[:new=N]`, the name one of `CATEGORY_VALUES` or of
`DECLARATION_GROUPS`. The flag repeats, and the groups go in the order given.
A category's companies are the public ones it files under, by the rule the
site's filter and `--company-category` read
(`analysis.extract.category_companies`), and a member is somebody in a post now
- any post, with no end - at one of them itself: not at a subsidiary, and not
in one that ended.

Szymon, 2026-10-31: two groups of the people the BIP crawler's people mode
found an oświadczenie majątkowe for (`stores.bip_found`), in the order of its
own priorities - a draft with no birth date (`DECLARATION_DRAFTS`, its 0), whose
page the night's payload dates, so that the readers of /oswiadczenia can settle
its crops against it; then somebody with no page (`DECLARATION_NO_PAGE`, its 2),
whom it makes one for even with no public post now, which nobody else gets
(`analysis.payloads.priority.DECLARED`). Where the page stands is tonight's
export's, not the crawl's.

`BUDGET` is how many of a group's members a run sends for it, and `new` how
many of those may be pages it creates - the budget unless given, never more.
Which of them a run sends, and what each counts against, is the job's
(`jobs.people_import.plan_priority`); who belongs to which group is
`analysis.payloads.priority`'s `group_names` and `declaration_groups`.
"""

import argparse
from dataclasses import dataclass

from entities.company_categories import CATEGORY_VALUES

#: A draft with no birth date of somebody whose declaration was downloaded.
DECLARATION_DRAFTS = "oswiadczenia-szkice"
#: Somebody with no page whose declaration was downloaded.
DECLARATION_NO_PAGE = "oswiadczenia-bez-strony"
DECLARATION_GROUPS = {
    DECLARATION_DRAFTS: "the unpublished pages with no birth date of the people "
    "whose oświadczenie majątkowe the BIP crawl downloaded",
    DECLARATION_NO_PAGE: "the people with no page whose oświadczenie majątkowe "
    "the BIP crawl downloaded, in a public post or not",
}

USAGE = (
    "NAME:BUDGET[:new=N], NAME a category or one of "
    f"{', '.join(DECLARATION_GROUPS)}, e.g. skarb-panstwa:100:new=50"
)


@dataclass(frozen=True)
class Group:
    """One `--priority-group`."""

    #: The category's value, or the declaration group's: what names the group
    #: in the run's summary and in every line of what the run sent.
    name: str
    #: How many of its members a run sends for it.
    budget: int
    #: How many of those may be pages the run creates.
    new: int
    #: The flag's value as given: what the night hands on to its steps.
    text: str = ""

    @property
    def of_declarations(self) -> bool:
        """Whether its members are people with a downloaded declaration rather
        than a category's companies' people."""
        return self.name in DECLARATION_GROUPS

    def describe(self) -> str:
        if self.of_declarations:
            return DECLARATION_GROUPS[self.name]
        return f"the public companies filed under {self.name}"


@dataclass(frozen=True)
class Declared:
    """The people whose oświadczenie majątkowe the BIP crawl downloaded, as the
    declaration groups find them: by their rejestr.io entries, and by the pages
    the crawl's list says carry them (`stores.bip_found`). No name and no birth
    date: an id is all the night needs, and the declarations are read to check
    the register's date against."""

    register_ids: frozenset[str] = frozenset()
    page_ids: frozenset[str] = frozenset()
    #: What it was read from: the part's gs:// path, or "" for none.
    source: str = ""

    def covers(self, register_id: str | None, page_id: str | None) -> bool:
        return (register_id is not None and register_id in self.register_ids) or (
            page_id is not None and page_id in self.page_ids
        )


def parse_group(text: str) -> Group:
    """A `--priority-group` value, or the reason it is not one."""
    parts = text.split(":")
    if len(parts) < 2 or not all(parts[:2]):
        raise argparse.ArgumentTypeError(f"{text!r}: expected {USAGE}")
    name, budget, *options = parts
    if name not in CATEGORY_VALUES and name not in DECLARATION_GROUPS:
        raise argparse.ArgumentTypeError(
            f"{name!r}: a group is a category, one of {', '.join(CATEGORY_VALUES)}, "
            f"or one of {', '.join(DECLARATION_GROUPS)}"
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
