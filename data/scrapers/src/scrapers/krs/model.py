from dataclasses import dataclass, field


@dataclass
class KRS:
    id: str
    sources: set[str] = field(default_factory=set)
    teryts: set[str] = field(default_factory=set)
    ministry: str | None = None

    def __post_init__(self):
        self.id = str(self.id).zfill(10)

    def parse(self, id: int | str) -> "KRS":
        return KRS(str(id).zfill(10))

    @staticmethod
    def from_blob_name(blob_name: str) -> "KRS":
        return KRS(blob_name.split("org/")[1].split("/")[0])

    def merge(self, other: "KRS") -> "KRS":
        try:
            assert self.id == other.id
            assert (
                self.ministry == other.ministry
                or self.ministry is None
                or other.ministry is None
            )
        except AssertionError as e:
            raise ValueError(f"Failed to merge KRS: {self} {other}")
        return KRS(
            self.id,
            self.sources | other.sources,
            self.teryts | other.teryts,
            self.ministry,
        )

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, KRS) and self.id == other.id
