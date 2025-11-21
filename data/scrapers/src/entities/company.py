"""Data classes for representing companies and KRS entities."""
from dataclasses import dataclass, field


@dataclass
class KRS:
    """Represents a company entry from a KRS (National Court Register) search."""

    krs: str
    name: str
    city: str | None = None


@dataclass
class ManualKRS:
    """
    Represents a manually curated KRS entry, often from multiple sources.
    Provides methods for merging and handling different representations.
    """

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

    def __hash__(self) -> int:
        """Computes the hash based on the KRS ID."""
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        """Checks equality based on the KRS ID."""
        return isinstance(other, ManualKRS) and self.id == other.id
