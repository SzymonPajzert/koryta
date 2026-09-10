# TODO move to entities?
import typing
from dataclasses import dataclass

if typing.TYPE_CHECKING:
    import pandas as pd


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
    # "Sposob powstania" - the entity this company arose from, or that arose
    # from it. A predecessor does not own its successor, and the one KRS_CREATED
    # edge in the crawl says so: EXATEL S.A. -> TELBANK S.A., dated 2004-11-09,
    # the merger EXATEL came out of. TELBANK has not existed since.
    "KRS_CREATED",
    "KRS_CREATOR",
    "KRS_ACQUIRED",  # Never seen in a crawl; kept in case rejestr.io writes it.
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

    def is_child(self, unknown: "typing.Counter[str] | None" = None) -> bool:
        """Whether the queried company owns the one this relation points at.

        ``kierunek`` is the *other* company's role, not the queried one's: PKP
        PLK's feed lists the rail-freight EZIG it belongs to as PASYWNY, and the
        EZIG's feed lists PKP PLK as AKTYWNY. So a PASYWNY shareholding is one
        where the queried company is the shareholder, and the other company is
        its child.

        A relation nobody has classified is not a child. It used to raise, and
        `process_rejestrio_blob` does not catch it, so a single word rejestr.io
        had not used before ended the whole company run - which is how
        KRS_CREATED came to be listed above. `posts_held` makes the same choice
        for the same reason: count it, drop it, and let the run finish.
        """
        if self.direction == "AKTYWNY":
            return False

        if self.relation in IGNORED_PARENT:
            return False

        if self.relation not in PARENT_RELATION:
            if unknown is not None:
                unknown[str(self.relation)] += 1
            return False

        return self.direction == "PASYWNY"


class CompanyGraph:
    def __init__(self) -> None:
        self.children: dict[str, list[str]] = dict()

    def add_parent(
        self,
        parent: str,
        child: str,
    ):
        self.children[parent] = self.children.get(parent, []) + [child]

    @staticmethod
    def from_dataframe(companies_df: "pd.DataFrame") -> "CompanyGraph":
        graph = CompanyGraph()
        for record in companies_df.to_dict("records"):
            parent = record["krs"]
            for child in record.get("children", []) or []:
                graph.add_parent(parent, child)
        return graph

    def all_descendants(self, krss: typing.Iterable[str]):
        descendants: set[str] = set()
        todo = set(krss)
        while todo:
            krs = todo.pop()
            descendants.add(krs)
            if krs in self.children:
                todo.update(set(self.children[krs]) - descendants)
        return descendants
