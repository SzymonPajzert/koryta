from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RegistryEntry:
    """One row of the official gov.pl BIP registry."""

    entry_id: str
    name: str
    url: str
    host: str
    teryt: str
    place: str
    email: str
