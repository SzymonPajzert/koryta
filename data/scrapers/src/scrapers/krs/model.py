class KRS:
    id: str
    teryt: str | None = None
    ministry: str | None = None

    def __init__(self, id: int | str) -> None:
        self.id = str(id).zfill(10)

    @staticmethod
    def from_blob_name(blob_name: str) -> "KRS":
        return KRS(blob_name.split("org/")[1].split("/")[0])

    def merge(self, other: "KRS") -> "KRS":
        assert self.id == other.id
        return KRS(self.id)

    def __str__(self) -> str:
        return self.id

    def __repr__(self) -> str:
        return self.id

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, KRS) and self.id == other.id
