"""Data classes representing individuals from various data sources."""

from dataclasses import dataclass


@dataclass
class Koryta:
    """Represents a person from the main 'koryta.pl' dataset."""

    id: str
    full_name: str
    party: str


@dataclass
class KRS:
    """Represents a person associated with a KRS (National Court Register) entry."""

    id: str
    first_name: str
    last_name: str
    full_name: str
    employed_krs: str
    employed_start: str | None
    employed_end: str | None
    employed_for: str | None
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        """Ensures the person's ID is a string."""
        self.id = str(self.id)


@dataclass
class PKW:
    """Represents a person from a PKW (National Electoral Commission) dataset."""

    election_year: str
    election_type: str
    sex: str | None = None
    birth_year: int | None = None
    age: str | None = None
    teryt_candidacy: str | None = None
    teryt_living: str | None = None
    candidacy_success: str | None = None
    party: str | None = None
    position: str | None = None
    pkw_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    party_member: str | None = None


@dataclass
class Wikipedia:
    """Represents a person from a Wikipedia article."""

    source: str
    full_name: str
    party: str | None
    birth_iso8601: str | None
    birth_year: int | None
    infoboxes: list[str]
    content_score: int
    links: list[str]
