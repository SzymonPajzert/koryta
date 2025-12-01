# TODO move to entities?
import typing
from dataclasses import dataclass
from entities.company import ManualKRS as KRS


# If relation is passive and one of this type, it's a child.
PARENT_RELATION = {
    "KRS_ONLY_SHAREHOLDER",
    "KRS_SHAREHOLDER",
    "KRS_SUPERVISION",
    "KRS_FOUNDER",
}

# If relation is passive and one of this type, it's not a child.
IGNORED_PARENT = {
    "KRS_BOARD",  # The company itself is the board member
    "KRS_MEMBER",  # The company is a member of a group, not interesting
    "KRS_COMMISSIONER",  # The company is probably liquidated
    "KRS_RECEIVER",  # The company is probably liquidated
    "KRS_GENERAL_PARTNER",  # The company is probably liquidated
    "KRS_RESTRUCTURIZATOR",  # The company is probably liquidated
}


@dataclass(frozen=True)
class QueryRelation:
    """Query relation represents a relation between two companies."""

    relation: str
    direction: str

    @staticmethod
    def from_rejestrio(dict):
        return QueryRelation(
            relation=dict["typ"],
            direction=dict["kierunek"],
        )

    def is_child(self):
        if self.direction == "AKTYWNY":
            return False

        if self.relation in IGNORED_PARENT:
            return False

        if self.relation not in PARENT_RELATION:
            raise ValueError(f"Unknown type: {self.relation} {self.direction}")

        return self.direction == "PASYWNY" and self.relation in PARENT_RELATION


class CompanyGraph:
    def __init__(self) -> None:
        self.children: dict[str, list[str]] = dict()

    def add_parent(
        self,
        parent: str,
        child: str,
    ):
        self.children[parent] = self.children.get(parent, []) + [child]

    def all_descendants(self, krss: typing.Iterable[str]):
        descendants: set[str] = set()
        todo = set(krss)
        while todo:
            krs = todo.pop()
            descendants.add(krs)
            if krs in self.children:
                todo.update(set(self.children[krs]) - descendants)
        return descendants
