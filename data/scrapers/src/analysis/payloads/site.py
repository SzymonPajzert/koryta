"""What koryta.pl already holds, and whether a payload would tell it anything.

`PeoplePayloads` emits a payload per person the scrapers know about - about 4000
of them - and the uploader posts every one, sleeping 0.3s between requests. Most
of them write nothing. The ingest looks a person up by name and writes a
revision only for a field it does not already have (`updatedPerson`), and it
matches every employment and candidacy against the edges already stored
(`findEdgeOrCreate`), so re-running a region that has been uploaded before is an
hour of requests that leave the database exactly as it was.

This module replays those decisions offline, against the nightly Firestore
export, so `--only-changed` can drop the payloads that would be no-ops.

It is a deliberate transcription of `frontend/server/utils/edges.ts` and the
matching helpers in `frontend/server/api/ingest/person.post.ts`, and it is worth
only as much as it stays one. Where the two could disagree it errs towards
*keeping* a payload: one sent needlessly costs a request, one dropped wrongly
loses a fact and nobody would see it go.
"""

import math
import typing
from collections import Counter
from dataclasses import dataclass

import numpy as np
import pandas as pd

from scrapers.koryta.download import KorytaEdges, KorytaNodes
from scrapers.stores import Context

#: Fields a node owns rather than states, which a revision never carries. The
#: ingest strips these off the stored document before comparing, so we do too.
#: Mirrors `INTERNAL_FIELDS` in `frontend/server/utils/revisions.ts`.
INTERNAL_FIELDS = frozenset(
    {
        "stats",
        "revision_id",
        "published",
        "revisions",
        "votes",
        "id",
        "deleted",
        "delete_reason",
        "visibility",
        "nameChunksLower",
    }
)

#: Fields whose stored spelling varies without the fact varying. PKW writes the
#: same committee in whatever case that year's file had; see `FOLDED_FIELDS` in
#: `frontend/server/utils/edges.ts`.
FOLDED_FIELDS = frozenset({"committee"})


@dataclass(frozen=True)
class EdgeSemantics:
    """When two edges of a type are the same fact. See `EDGE_SEMANTICS`."""

    #: "state" (the tie holds or it does not), "occurrence" (one bounded
    #: episode, and there can be several between a pair) or "authored".
    kind: str
    #: Fields beyond the pair that say *which* episode this is.
    discriminators: tuple[str, ...]
    #: Whether a stored edge may be matched by an incoming one that contradicts
    #: nothing and fills in a discriminator it lacks.
    enrichable: bool


EDGE_SEMANTICS: dict[str, EdgeSemantics] = {
    "owns": EdgeSemantics("state", (), False),
    "mentions": EdgeSemantics("state", (), False),
    "comment": EdgeSemantics("state", (), False),
    "source": EdgeSemantics("state", (), False),
    "employed": EdgeSemantics("occurrence", ("name", "start_date"), False),
    "election": EdgeSemantics(
        "occurrence", ("position", "start_date", "party", "committee", "term"), True
    ),
    "connection": EdgeSemantics(
        "authored", ("name", "content", "start_date", "end_date"), False
    ),
}

UNKNOWN_SEMANTICS = EdgeSemantics(
    "authored", ("name", "content", "start_date", "end_date"), False
)

#: What a stored edge must already say before it is specific enough to enrich.
ENRICH_FLOOR: dict[str, tuple[str, ...]] = {"election": ("start_date",)}

#: Candidacies the ingest silently skips for want of a region, rather than
#: failing on. Mirrors `allowedFailingElections` in `person.post.ts`; a payload
#: whose only news is one of these is still news to nobody.
ALLOWED_MISSING_REGION: tuple[tuple[str, str | None], ...] = (
    ("Samorząd", "1994"),
    ("Samorząd", "1998"),
    ("Sejm", "1991"),
    ("Sejm", "1993"),
    ("Sejm", "1997"),
    ("Sejm", "2001"),
    ("Senat", "1991"),
    ("Senat", "1993"),
    ("Senat", "1997"),
    ("Senat", "2001"),
    ("Senat", "2005"),
    ("Parlament Europejski", None),
)

#: Why a payload is worth sending. Counted per run so a report says what the
#: remaining uploads are actually for.
NEW_PERSON = "person not on koryta.pl"
PERSON_FIELDS = "person node learns a field"
MISSING_COMPANY = "company not on koryta.pl"
NEW_EMPLOYMENT = "employment not stored"
NEW_CANDIDACY = "candidacy not stored"
ENRICHED_CANDIDACY = "stored candidacy learns a field"
MISSING_ARTICLE = "article not on koryta.pl"
NEW_MENTION = "mention not stored"
UNRESOLVED_REGION = "candidacy the ingest cannot place"

Edge = dict[str, typing.Any]


def field(edge: typing.Mapping[str, typing.Any], name: str) -> typing.Any:
    """One writer's "unset" read as another's.

    The edit form writes `name: ""` and `party: ""` where the ingest omits the
    field; pandas turns a column no row of this type fills into NaN. All three
    mean the same nothing, and a comparison that told them apart would keep
    re-stating facts the site already holds.
    """
    value = edge.get(name)
    if value is None or value is False:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str):
        if not value:
            return None
        if name in FOLDED_FIELDS:
            return " ".join(value.lower().split())
    return value


def semantics(edge_type: typing.Any) -> EdgeSemantics:
    if isinstance(edge_type, str):
        return EDGE_SEMANTICS.get(edge_type, UNKNOWN_SEMANTICS)
    return UNKNOWN_SEMANTICS


def edge_identity(edge: typing.Mapping[str, typing.Any]) -> tuple:
    """What the edge asserts, as something two edges can be compared by."""
    return (
        edge.get("source"),
        edge.get("target"),
        edge.get("type"),
        *(field(edge, name) for name in semantics(edge.get("type")).discriminators),
    )


def edge_relation(
    stored: typing.Mapping[str, typing.Any],
    incoming: typing.Mapping[str, typing.Any],
) -> str:
    """How `incoming` stands to a stored edge of the same pair and type.

    "conflict" when they disagree about a discriminator they both know,
    "enriches" when the incoming edge fills in one the stored edge lacks, and
    "same" when there is nothing to add. Asymmetric on purpose: a discriminator
    only the *stored* edge knows - a `term` a reviewer typed in - is not a
    disagreement, because the pipeline saying nothing is not saying "none".
    """
    added = 0
    for name in semantics(incoming.get("type")).discriminators:
        before = field(stored, name)
        after = field(incoming, name)
        if before is None:
            if after is not None:
                added += 1
            continue
        if after is not None and before != after:
            return "conflict"
    return "enriches" if added else "same"


def meets_enrich_floor(stored: typing.Mapping[str, typing.Any]) -> bool:
    required = ENRICH_FLOOR.get(str(stored.get("type")), ())
    return all(field(stored, name) is not None for name in required)


def _records(df: pd.DataFrame) -> list[dict]:
    """The frame's rows as dicts, with the columns a row does not fill dropped.

    Every row of a Firestore export carries every column any document of the
    collection has, so a person node arrives with a `krsNumber` of NaN. Reading
    those as absent here is what lets the rest of the module treat a stored
    document like the JSON the ingest reads.
    """
    if df is None or df.empty:
        return []
    records = []
    for raw in df.to_dict(orient="records"):
        row = {str(key): value for key, value in raw.items()}
        records.append({k: v for k, v in row.items() if field(row, k) is not None})
    return records


class SiteSnapshot:
    """The site as one Firestore export left it, indexed the way ingest looks.

    Every lookup here mirrors a query in `person.post.ts`: a person by exact
    `name`, a company by `krsNumber`, a region by `teryt`, an article by
    `sourceURL`, and edges by the (source, target, type) triple the ingest
    narrows in memory afterwards.
    """

    def __init__(self, nodes: pd.DataFrame, edges: pd.DataFrame) -> None:
        self.people: dict[str, dict] = {}
        self.companies: dict[str, str] = {}
        self.regions: dict[str, str] = {}
        self.articles: dict[str, str] = {}

        for node in _records(nodes):
            node_id = str(node.get("id", ""))
            if not node_id:
                continue
            node_type = node.get("type")
            if node_type == "person" and "name" in node:
                # `limit(1)` on an equality query: with two nodes of one name
                # the ingest takes whichever Firestore hands it first, and so
                # do we. Keeping the first is at least stable across runs.
                self.people.setdefault(str(node["name"]), node)
            elif node_type == "place" and "krsNumber" in node:
                self.companies.setdefault(str(node["krsNumber"]), node_id)
            elif node_type == "region" and "teryt" in node:
                self.regions.setdefault(str(node["teryt"]), node_id)
            elif node_type == "article" and "sourceURL" in node:
                self.articles.setdefault(str(node["sourceURL"]), node_id)

        self.edges: dict[tuple, list[dict]] = {}
        for edge in _records(edges):
            pair = (edge.get("source"), edge.get("target"), edge.get("type"))
            self.edges.setdefault(pair, []).append(edge)
        for siblings in self.edges.values():
            # The ingest sorts its candidates by document id, so that which of
            # several indistinguishable candidacies gets matched is arbitrary
            # but not arbitrary differently twice. Same reason here.
            siblings.sort(key=lambda edge: str(edge.get("id", "")))

    @classmethod
    def read(cls, ctx: Context, date: str | None = None) -> "SiteSnapshot":
        """The snapshot from the export of `date`, or the latest before it."""
        return cls(
            KorytaNodes(date).read_or_process(ctx),
            KorytaEdges(date).read_or_process(ctx),
        )

    def changes(self, payload: typing.Mapping[str, typing.Any]) -> list[str]:
        """What uploading this payload would write. Empty means it is a no-op.

        Deliberately not short-circuited past the first change: the counts are
        what tell a reader whether a run is 300 new people or 3000 candidacies
        waiting on a committee.
        """
        stored = self.people.get(str(payload.get("name")))
        if stored is None:
            return [NEW_PERSON]

        person_id = str(stored["id"])
        reasons: list[str] = []
        if self._person_learns(stored, payload):
            reasons.append(PERSON_FIELDS)

        matcher = _EdgeMatcher(self)
        reasons += self._employment_changes(matcher, person_id, payload)
        reasons += self._mention_changes(matcher, person_id, payload)
        reasons += self._candidacy_changes(matcher, person_id, payload)
        return reasons

    def _person_learns(
        self, stored: dict, payload: typing.Mapping[str, typing.Any]
    ) -> bool:
        """Whether the node itself would gain a revision. See `updatedPerson`."""
        data = {k: v for k, v in stored.items() if k not in INTERNAL_FIELDS}

        stored_parties = _as_list(data.get("parties"))
        parties = sorted(set(stored_parties) | set(_as_list(payload.get("parties"))))

        learned: dict[str, typing.Any] = {}
        if len(parties) > len(stored_parties):
            learned["parties"] = parties
        for key in ("content", "wikipedia", "rejestrIo"):
            value = payload.get(key)
            if value:
                learned[key] = value

        return any(value != data.get(key) for key, value in learned.items())

    def _employment_changes(
        self,
        matcher: "_EdgeMatcher",
        person_id: str,
        payload: typing.Mapping[str, typing.Any],
    ) -> list[str]:
        reasons = []
        for company in _rows(payload.get("companies")):
            krs = company.get("krs")
            company_id = self.companies.get(str(krs)) if krs else None
            if company_id is None:
                # The ingest answers 404 and writes nothing at all, and the
                # uploader creates the company and posts the person again.
                reasons.append(MISSING_COMPANY)
                continue
            edge: Edge = {
                "type": "employed",
                "name": company.get("role"),
                "source": person_id,
                "target": company_id,
            }
            if company.get("start"):
                edge["start_date"] = company["start"]
            if company.get("end"):
                edge["end_date"] = company["end"]
            if matcher.place(edge) != "same":
                reasons.append(NEW_EMPLOYMENT)
        return reasons

    def _mention_changes(
        self,
        matcher: "_EdgeMatcher",
        person_id: str,
        payload: typing.Mapping[str, typing.Any],
    ) -> list[str]:
        reasons = []
        for url in payload.get("sources") or []:
            article_id = self.articles.get(str(url))
            if article_id is None:
                reasons.append(MISSING_ARTICLE)
                continue
            edge: Edge = {
                "source": person_id,
                "target": article_id,
                "type": "mentions",
            }
            if matcher.place(edge) != "same":
                reasons.append(NEW_MENTION)
        return reasons

    def _candidacy_changes(
        self,
        matcher: "_EdgeMatcher",
        person_id: str,
        payload: typing.Mapping[str, typing.Any],
    ) -> list[str]:
        reasons = []
        for election in _rows(payload.get("elections")):
            region_id = self._region_of(election)
            if region_id is _SKIPPED:
                continue
            if region_id is None:
                # `lookupRegionId` throws, the request fails, and it fails the
                # same way whether or not we send it. Keeping the payload is
                # what makes --only-changed a filter rather than a fix.
                reasons.append(UNRESOLVED_REGION)
                continue
            edge: Edge = {
                "source": person_id,
                "target": region_id,
                "type": "election",
                "name": "kandydatura",
                "position": election.get("election_type"),
            }
            if election.get("party"):
                edge["party"] = election["party"]
            if election.get("committee"):
                edge["committee"] = election["committee"]
            if election.get("election_year"):
                edge["start_date"] = f"{election['election_year']}-01-01"

            match matcher.place(edge):
                case "same":
                    pass
                case "enriches":
                    reasons.append(ENRICHED_CANDIDACY)
                case _:
                    reasons.append(NEW_CANDIDACY)
        return reasons

    def _region_of(self, election: typing.Mapping[str, typing.Any]):
        """The region node a candidacy hangs off, or why there is none.

        `_SKIPPED` for the elections the ingest is content to drop, `None` for
        the ones it raises on.
        """
        teryt = election.get("teryt")
        if not teryt:
            for position, year in ALLOWED_MISSING_REGION:
                if position == election.get("election_type") and (
                    year is None or year == str(election.get("election_year"))
                ):
                    return _SKIPPED
            return None
        return self.regions.get(str(teryt))


class _SkippedRegion:
    """A candidacy the ingest drops on purpose, told apart from one it fails on."""


_SKIPPED = _SkippedRegion()


class _EdgeMatcher:
    """One payload's worth of edge placement, as `findEdgeOrCreate` does it.

    Both counters exist because a payload routinely states the same thing twice
    - two spells at one company, two 2024 candidacies in one powiat - and the
    ingest reads a repeat as a second fact rather than as a duplicate. The n-th
    such row is matched against the n-th stored edge, which is what stops a
    re-run growing the collection while still letting it hold both.
    """

    def __init__(self, snapshot: SiteSnapshot) -> None:
        self.snapshot = snapshot
        self.occurrences: typing.Counter[tuple] = Counter()
        self.claimed: set[str] = set()

    def place(self, edge: Edge) -> str:
        """Whether the site already says this: "same", "enriches" or "new"."""
        identity = edge_identity(edge)
        occurrence = self.occurrences[identity]
        self.occurrences[identity] += 1

        pair = (edge.get("source"), edge.get("target"), edge.get("type"))
        siblings = self.snapshot.edges.get(pair, [])
        may_enrich = semantics(edge.get("type")).enrichable

        same: list[dict] = []
        enrichable: list[dict] = []
        for stored in siblings:
            if edge_identity(stored) == identity:
                same.append(stored)
                continue
            if not may_enrich or not meets_enrich_floor(stored):
                continue
            match edge_relation(stored, edge):
                case "enriches":
                    enrichable.append(stored)
                case "same":
                    same.append(stored)

        unclaimed = [s for s in same if str(s.get("id")) not in self.claimed]
        if occurrence < len(unclaimed):
            self.claimed.add(str(unclaimed[occurrence].get("id")))
            return "same"

        for candidate in enrichable:
            if str(candidate.get("id")) not in self.claimed:
                self.claimed.add(str(candidate.get("id")))
                return "enriches"

        return "new"


def _as_list(value: typing.Any) -> list:
    """A list field, with every way of saying "no list" read as an empty one."""
    if isinstance(value, np.ndarray):
        return list(value)
    if isinstance(value, (list, tuple)):
        return list(value)
    return []


def _rows(value: typing.Any) -> list[dict]:
    if value is None or isinstance(value, float):
        return []
    return [row for row in value if isinstance(row, dict)]
