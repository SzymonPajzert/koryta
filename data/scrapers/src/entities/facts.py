"""Data classes for article-grounded extracted facts.

Serialization contract
----------------------
ArticleFact subclasses are stored in JSONL via dataclasses.asdict(), which
recursively converts them to plain dicts.  The ``fact_type`` discriminator
is a dataclass field on each subclass (init=False, fixed default) so it is
included automatically by asdict() without any manual conversion.

Write path:  ArticleFact subclass  →  asdict()  →  dict with "fact_type" key
Read path:   dict                  →  dict_to_fact()  →  ArticleFact subclass

fact_to_dict() is kept as a convenience wrapper around asdict() for callers
that need an explicit conversion step.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
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
    fact_type: str = field(default="employment", init=False)


@dataclass(frozen=True)
class PartyMembershipFact(ArticleFact):
    person: str
    party: str
    fact_type: str = field(default="party_membership", init=False)


@dataclass(frozen=True)
class PersonalRelationFact(ArticleFact):
    subject: str
    object: str
    relation: str | None = None
    fact_type: str = field(default="personal_relation", init=False)


def fact_to_dict(fact: ArticleFact) -> dict[str, Any]:
    """Serialize an ArticleFact to a plain dict (fact_type included via asdict)."""
    return asdict(fact)


def dict_to_fact(data: dict[str, Any]) -> ArticleFact:
    """Deserialize a plain dict (from JSONL) back to an ArticleFact subclass."""
    fact_type = data.get("fact_type")
    url = str(data.get("url") or "")
    justification = str(data.get("justification") or "")
    justification_in_text = data.get("justification_in_text")
    if isinstance(justification_in_text, str):
        justification_in_text = justification_in_text or None

    if fact_type == "employment":
        return EmploymentFact(
            url=url,
            justification=justification,
            justification_in_text=justification_in_text,
            person=str(data.get("person") or ""),
            organization=str(data.get("organization") or ""),
            role=data.get("role") or None,
        )
    if fact_type == "party_membership":
        return PartyMembershipFact(
            url=url,
            justification=justification,
            justification_in_text=justification_in_text,
            person=str(data.get("person") or ""),
            party=str(data.get("party") or ""),
        )
    if fact_type == "personal_relation":
        return PersonalRelationFact(
            url=url,
            justification=justification,
            justification_in_text=justification_in_text,
            subject=str(data.get("subject") or ""),
            object=str(data.get("object") or ""),
            relation=data.get("relation") or None,
        )
    raise ValueError(f"Unknown fact_type: {fact_type!r}")
