"""Data classes for article-grounded extracted facts.

Serialization contract
----------------------
ArticleFact subclasses are stored in JSONL via dataclasses.asdict(), which
recursively converts them to plain dicts.  The ``fact_type`` discriminator
field is NOT a dataclass field — it is injected by ``fact_to_dict()`` on
write and consumed by ``dict_to_fact()`` on read.

Write path:  ArticleFact  →  fact_to_dict()  →  dict with "fact_type" key
Read path:   dict          →  dict_to_fact()  →  ArticleFact subclass
"""

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
    """Serialize an ArticleFact to a plain dict, adding the fact_type discriminator."""
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
