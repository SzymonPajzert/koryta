"""The role chips of posts read off BIP asset declarations, and the families a
role's name folds into, as `frontend/shared/declarationEmploymentRoles.json`
has them.

The site reads the same file (`roleFamilyOf` in
`frontend/shared/declarationEmployment.ts`), and a family is what a declared
post is matched to a person's stored posts by. So whatever in the pipeline
asks which posts are one post - the night's invariants, the job's suggestions
- folds a name here, the way the site does, rather than by a list of its own.

The file is read when first asked for, not on import: it is the repository's,
beside the site, and an image that carries only the pipelines never asks.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from util.polish import normalize_person_name

#: The chips and their families, beside the site module that reads them.
ROLES_FILE = (
    Path(__file__).resolve().parents[4]
    / "frontend"
    / "shared"
    / "declarationEmploymentRoles.json"
)


@dataclass(frozen=True)
class RoleChip:
    """A role a reader can pick."""

    #: Never changes: answers and declared entries (`roleId`) keep it.
    id: str
    label: str
    #: elected, executive, managerial or staff; None for „Inne”.
    kind: str | None
    #: What a declared post is matched by; None for „Inne”.
    family: str | None


@dataclass(frozen=True)
class Roles:
    """The chips and the families names fold into."""

    chips: tuple[RoleChip, ...]
    #: Cut off a folded name, each once, in this order: „p.o.”, then an
    #: ordinal („I Zastępca”).
    prefixes: tuple[re.Pattern[str], ...]
    #: Each family with its patterns, in the order a name is tried.
    families: tuple[tuple[str, tuple[re.Pattern[str], ...]], ...]
    #: The kinds of institution each chip is offered at.
    offered_at: Mapping[str, frozenset[str]]

    def chip(self, chip_id: object) -> RoleChip | None:
        """The chip with this id, if there is one."""
        return next((chip for chip in self.chips if chip.id == chip_id), None)

    def fold(self, name: str | None) -> str:
        """A name as the families' patterns read it: lower-case ASCII words
        (`normalize_person_name`), its prefixes cut off."""
        folded = normalize_person_name(name)
        for prefix in self.prefixes:
            folded = prefix.sub("", folded, count=1)
        return folded

    def family(self, name: str | None) -> str | None:
        """`roleFamilyOf`: the first family with a pattern the folded name
        matches; None for a mandate („radny”), a contract or a bare
        „członek”."""
        folded = self.fold(name)
        if not folded:
            return None
        return next(
            (
                family
                for family, patterns in self.families
                if any(pattern.search(folded) for pattern in patterns)
            ),
            None,
        )


@cache
def read_roles(path: Path = ROLES_FILE) -> Roles:
    """The roles file. The site checks its shape as it loads it."""
    data = json.loads(path.read_text(encoding="utf-8"))
    offered: dict[str, set[str]] = defaultdict(set)
    for institution, ids in data["institutions"].items():
        for chip_id in ids:
            offered[chip_id].add(institution)
    return Roles(
        chips=tuple(
            RoleChip(role["id"], role["label"], role["kind"], role["family"])
            for role in data["roles"]
        ),
        prefixes=tuple(re.compile(prefix) for prefix in data["prefixes"]),
        families=tuple(
            (family["id"], tuple(re.compile(p) for p in family["patterns"]))
            for family in data["families"]
        ),
        offered_at={chip: frozenset(kinds) for chip, kinds in offered.items()},
    )
