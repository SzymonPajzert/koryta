"""Data classes for representing companies and KRS entities."""

from dataclasses import dataclass, field
from typing import Literal, Optional


@dataclass
class Source:
    """Represents a source of information for a company."""

    # TODO make sure you're supporting all the sources.
    source: Literal["wiki", "rejestr-io", "hardcoded", "krs-api"]
    reason: str
    is_interesting: bool = False
    details: str | None = None


@dataclass(frozen=True)
class Owner:
    krs: Optional[str]
    teryt: Optional[str]


@dataclass
class Company:
    """Represents a company entry from a KRS (National Court Register) search.

    It is the standard model of the company in our pipeline."""

    krs: str
    name: str | None = None
    city: str | None = None
    teryt_code: str | None = None
    sources: set[Source] = field(default_factory=set)
    children: set[str] = field(default_factory=set)
    parents: set[Owner] = field(default_factory=set)

    def __post_init__(self):
        """Ensures the KRS ID is zero-padded to 10 digits."""
        self.krs = str(self.krs).zfill(10)


@dataclass
class Wikipedia:
    name: str
    content_score: int
    krs: str | None
    city: str | None = None
    owner_articles: list[str] = field(default_factory=list)
    owner_text: str | None = None


@dataclass
class ManualKRS:
    """
    Represents a manually curated KRS entry, often from multiple sources.
    Provides methods for merging and handling different representations.
    """

    # TODO migrate id to krs for consistency
    id: str
    sources: set[str] = field(default_factory=set)
    teryts: set[str] = field(default_factory=set)
    ministry: str | None = None

    def __post_init__(self):
        """Ensures the KRS ID is zero-padded to 10 digits."""
        self.id = str(self.id).zfill(10)

    def parse(self, id: int | str) -> "ManualKRS":
        """Creates a ManualKRS instance from an ID."""
        return ManualKRS(str(id).zfill(10))

    @staticmethod
    def from_blob_name(blob_name: str) -> "ManualKRS":
        """Creates a ManualKRS instance from a GCS blob name."""
        return ManualKRS(blob_name.split("org/")[1].split("/")[0])

    def merge(self, other: "ManualKRS") -> "ManualKRS":
        """
        Merges another ManualKRS instance into this one.

        Raises:
            ValueError: If the IDs or ministries are conflicting.
        """
        try:
            assert self.id == other.id
            assert (
                self.ministry == other.ministry
                or self.ministry is None
                or other.ministry is None
            )
        except AssertionError as e:
            raise ValueError(f"Failed to merge KRS: {self} {other}") from e
        return ManualKRS(
            self.id,
            self.sources | other.sources,
            self.teryts | other.teryts,
            self.ministry or other.ministry,
        )

    def __str__(self) -> str:
        return f"{self.id}"

    def __repr__(self) -> str:
        return self.__str__()

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ManualKRS) and self.id == other.id
