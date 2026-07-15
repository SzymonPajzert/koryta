"""Data classes for article-grounded extracted facts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ArticleFact:
    url: str
    justification: str
    justification_in_text: str | None


@dataclass(frozen=True)
class EmploymentFact(ArticleFact):
    person: str
    organization: str
    role: str | None = None


@dataclass(frozen=True)
class PartyMembershipFact(ArticleFact):
    person: str
    party: str


@dataclass(frozen=True)
class PersonalRelationFact(ArticleFact):
    subject: str
    object: str
    relation: str | None = None


def fact_to_dict(fact: ArticleFact) -> dict[str, Any]:
    data = asdict(fact)
    if isinstance(fact, EmploymentFact):
        data["fact_type"] = "employment"
    elif isinstance(fact, PartyMembershipFact):
        data["fact_type"] = "party_membership"
    elif isinstance(fact, PersonalRelationFact):
        data["fact_type"] = "personal_relation"
    else:
        raise TypeError(f"Unsupported fact type: {type(fact)!r}")
    return data
