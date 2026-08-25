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
    # Where a company is registered, split out of `owns` after this module was
    # written. No person payload creates one, so it is here to keep the
    # transcription complete rather than because anything reads it yet.
    "seat": EdgeSemantics("state", (), False),
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

#: Reasons worth reporting that are not writes. The ingest drops a candidacy it
#: cannot place and says so in `unplacedElections`, so a payload whose only
#: difference is one of these would upload to no effect - it is counted, so a
#: run says how many candidacies it is leaving behind, but it does not keep the
#: payload. Until the ingest was changed it did: the drop was a *throw*, and a
#: payload that would fail is one somebody has to see fail.
INFORMATIONAL_REASONS = frozenset({UNRESOLVED_REGION})

NEW_COMPANY = "company not on koryta.pl"
COMPANY_FIELDS = "company node learns a field"
COMPANY_UNAPPROVED = "company node has no approved revision"
NEW_OWNER = "owner link not stored"
NEW_SEAT = "seat not stored"

#: The site's own node for the Skarb Panstwa, which has no KRS and no TERYT of
#: its own. Hardcoded on both sides of the wire - see `SKARB_PANSTWA_NODE_ID`
#: in `frontend/server/api/ingest/company.post.ts`, where the comment explains
#: why a document id cannot travel in a payload.
SKARB_PANSTWA_NODE_ID = "qMsAXmM5nDGNdUqmQpWR"

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
        #: People by their rejestr.io link, which is what identifies them. See
        #: `person_for`.
        self.people: dict[str, dict] = {}
        #: People by node id, for a payload that already knows which page it is.
        self.people_by_id: dict[str, dict] = {}
        #: People by name, for the ones the site has no register link for.
        self.people_by_name: dict[str, dict] = {}
        #: How many person nodes carry each name. `people_by_name` keeps the
        #: first, because that is what `limit(1)` does, so the count of the
        #: others would otherwise be lost - and a name shared by two pages is
        #: exactly where the name fallback must not be trusted.
        self.people_named: typing.Counter[str] = Counter()
        self.companies: dict[str, str] = {}
        #: The same companies as `self.companies`, whole rather than by id.
        #: `CompaniesPayloads` compares fields; the person payload only ever
        #: needs somewhere to point an employment at.
        self.company_nodes: dict[str, dict] = {}
        self.regions: dict[str, str] = {}
        #: Every node id, for the one lookup that goes by id rather than by a
        #: field: `findRegionByTeryt` tries the document `teryt<code>` before it
        #: queries anything.
        self.node_ids: set[str] = set()
        self.articles: dict[str, str] = {}

        for node in _records(nodes):
            node_id = str(node.get("id", ""))
            if not node_id:
                continue
            self.node_ids.add(node_id)
            node_type = node.get("type")
            if node_type == "person":
                self.people_by_id[node_id] = node
                register = field(node, "rejestrIo")
                if register is not None:
                    self.people.setdefault(str(register), node)
                if "name" in node:
                    # `limit(1)` on an equality query: with two nodes of one
                    # name the ingest takes whichever Firestore hands it first,
                    # and so do we. Keeping the first is at least stable across
                    # runs. 170 names identify two people each, so this is not
                    # hypothetical - but it only decides the fallback now, and
                    # the fallback only fires for somebody with no register
                    # link at all.
                    self.people_by_name.setdefault(str(node["name"]), node)
                    self.people_named[str(node["name"])] += 1
            elif node_type == "place" and "krsNumber" in node:
                self.companies.setdefault(str(node["krsNumber"]), node_id)
                self.company_nodes.setdefault(str(node["krsNumber"]), node)
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

    def person_for(self, payload: typing.Mapping[str, typing.Any]) -> dict | None:
        """The stored person this payload would land on, or None for a new one.

        Mirrors `lookupPersonDoc` in `frontend/server/api/ingest/person.post.ts`
        exactly, and has to: this filter exists to predict what an upload would
        write, and a filter that identifies people differently from the ingest
        predicts the wrong page. It would drop a payload as a no-op against a
        node the upload was never going to touch.

        The node id first where the payload carries one, because that is the
        page and there is nothing left to work out. Then the register link,
        because that is the identity - the name is not, and matching on it
        exactly is what filed 170 people under two pages each. The name only as
        a fallback, and only onto somebody the site has no register link for,
        because a page carrying a *different* link is a different human however
        the two are spelled.
        """
        koryta_id = field(payload, "korytaId")
        if koryta_id is not None:
            stored = self.people_by_id.get(str(koryta_id))
            if stored is not None:
                return stored

        register = field(payload, "rejestrIo")
        if register is not None:
            stored = self.people.get(str(register))
            if stored is not None:
                return stored

        by_name = self.people_by_name.get(str(payload.get("name")))
        if by_name is None:
            return None

        stored_register = field(by_name, "rejestrIo")
        if register is None or stored_register is None:
            return by_name
        return by_name if str(stored_register) == str(register) else None

    def changes(self, payload: typing.Mapping[str, typing.Any]) -> list[str]:
        """What uploading this payload would write. Empty means it is a no-op.

        Deliberately not short-circuited past the first change: the counts are
        what tell a reader whether a run is 300 new people or 3000 candidacies
        waiting on a committee.
        """
        stored = self.person_for(payload)
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
        """Whether the node itself would gain a revision. See `updatedPerson`.

        Read through `field`, because a payload states an absent link as NaN -
        `map_person_payload` takes it off a pandas row - and NaN is both truthy
        and unequal to itself. Read literally, every person the pipeline has no
        Wikipedia page for would look like a person about to learn one.
        `iterate_pipeline_dict` turns it into None on the way to the uploader,
        so the request the site actually receives carries no such field.
        """
        data = {k: v for k, v in stored.items() if k not in INTERNAL_FIELDS}

        stored_parties = _as_list(data.get("parties"))
        parties = sorted(set(stored_parties) | set(_as_list(payload.get("parties"))))

        learned: dict[str, typing.Any] = {}
        if len(parties) > len(stored_parties):
            learned["parties"] = parties
        for key in ("content", "wikipedia", "rejestrIo"):
            value = field(payload, key)
            if value:
                learned[key] = value

        # Filled in, never rewritten, so a payload restating a date the node
        # already carries writes nothing and must not keep the payload alive.
        # `updatedPerson` is the only field with this rule; the rest above are
        # last-write-wins.
        birth_date = field(payload, "birthDate")
        if birth_date and not data.get("birthDate"):
            learned["birthDate"] = birth_date

        return any(value != data.get(key) for key, value in learned.items())

    def company_changes(self, payload: typing.Mapping[str, typing.Any]) -> list[str]:
        """What uploading this company payload would write. Empty means no-op.

        A transcription of `frontend/server/api/ingest/company.post.ts`, on the
        same terms as `changes` is one of the person ingest: where the two could
        disagree it keeps the payload.

        It is looser than the ingest in exactly one place, and deliberately.
        A stored `isPublic: false` reaches this module as an absent field -
        `field` reads `False` as unset, because for every other field on the
        site that is what an empty one means - so a payload saying
        `is_public: false` about a node that has never carried the field looks
        like a no-op, while the ingest would write it. What it would write is a
        field whose absence already says the same thing, once, and never again;
        against that stands a revision on each of the ~3,900 companies that have
        no `isPublic` today.

        Two things it does not see at all, both of them repairs rather than
        facts: a node whose `stats` nothing has computed, which the write would
        seed, and one whose arrays are stored as numbered-key maps. The second
        looks like a difference and keeps the payload, which is the right
        answer by accident; the first does not, and a company on the site
        without counters waits for a run that has something else to say.
        """
        krs = str(payload.get("krs") or "")
        stored = self.company_nodes.get(krs)
        if stored is None:
            return [NEW_COMPANY]

        reasons: list[str] = []
        # Approving is also what points the node at a revision, so one with
        # nothing to point at is written whatever it says. See
        # `revisionChangesNothing`.
        if not stored.get("revision_id"):
            reasons.append(COMPANY_UNAPPROVED)
        if self._company_learns(stored, payload):
            reasons.append(COMPANY_FIELDS)

        company_id = str(stored["id"])
        reasons += self._owner_changes(company_id, payload)
        reasons += self._seat_changes(company_id, payload)
        return reasons

    def _company_learns(
        self, stored: dict, payload: typing.Mapping[str, typing.Any]
    ) -> bool:
        """Whether the node itself would gain a revision.

        The `...Source: "manual"` markers are why this cannot be a plain
        comparison: a person who has set a company's categories or said who
        owns it has the last word, and the ingest then declines to write the
        payload's answer at all - so disagreeing with them is not a change.
        """
        data = {k: v for k, v in stored.items() if k not in INTERNAL_FIELDS}
        written: dict[str, typing.Any] = {"name": payload.get("name")}

        # An empty `activity` is a payload that found no codes rather than one
        # asserting there are none, and the ingest leaves the stored list alone.
        activity = _as_list(payload.get("activity"))
        if activity:
            written["activity"] = activity

        # An empty `categories`, by contrast, is a real answer: this company is
        # in no sector we track. Absent means the payload did not work them out.
        categories = payload.get("categories")
        if categories is not None and data.get("categoriesSource") != "manual":
            written["categories"] = _as_list(categories)

        is_public = payload.get("is_public")
        if is_public is not None and data.get("isPublicSource") != "manual":
            written["isPublic"] = bool(is_public)

        # "" is not a value here but a deletion: an ordinary company has no
        # supervisory body, and marking 3,900 of them with an empty string
        # would be a field that means nothing on all but a hundred.
        body = payload.get("supervisory_body")
        if body is not None:
            if body == "":
                if "supervisoryBody" in data:
                    return True
            else:
                written["supervisoryBody"] = body

        if payload.get("legal_form"):
            written["legalForm"] = payload["legal_form"]
        if payload.get("supervisory_organ"):
            written["supervisoryOrgan"] = payload["supervisory_organ"]

        for key, value in written.items():
            current = data.get(key)
            if isinstance(value, list):
                if _as_list(current) != value:
                    return True
            elif isinstance(value, bool):
                if bool(current) != value:
                    return True
            elif current != value:
                return True
        return False

    def _owner_changes(
        self, company_id: str, payload: typing.Mapping[str, typing.Any]
    ) -> list[str]:
        """The ownership edges the upload would draw and the site has not.

        An owner the site does not hold a node for is skipped by the ingest
        rather than created, so it is not a change: the register names 238
        companies as shareholders that koryta.pl does not track, and a TERYT
        the region ingest has not reached yet resolves to nothing.
        """
        sources: list[str] = []
        for owner_krs in _as_list(payload.get("owners")):
            owner_id = self.companies.get(str(owner_krs))
            if owner_id:
                sources.append(owner_id)
        if payload.get("owner_skarb_panstwa") and (
            SKARB_PANSTWA_NODE_ID in self.node_ids
        ):
            sources.append(SKARB_PANSTWA_NODE_ID)
        for owner_teryt in _as_list(payload.get("owner_teryts")):
            region_id = self._region_by_teryt(str(owner_teryt))
            if region_id:
                sources.append(region_id)

        # `createEdge` keeps its own set of the ids this request has already
        # added, because nothing is committed until the end and a payload
        # naming one owner twice would otherwise write the link twice over.
        drawn: set[str] = set()
        reasons = []
        for source in sources:
            if source in drawn:
                continue
            drawn.add(source)
            if not self._edge_exists(source, company_id, "owns"):
                reasons.append(NEW_OWNER)
        return reasons

    def _seat_changes(
        self, company_id: str, payload: typing.Mapping[str, typing.Any]
    ) -> list[str]:
        """Whether the company's registered seat would be drawn.

        Three ways it would not, each one the ingest's: the TERYT resolves to no
        region node, a seat in a *different* region is already stored - a
        disagreement the ingest reports and refuses to act on - or the pair
        already carries an `owns` edge, which is what a seat written before the
        `owns`/`seat` split looks like until `split-seat-edges.ts` retypes it.
        """
        teryt = payload.get("teryt_code")
        if not teryt:
            return []
        region_id = self._region_by_teryt(str(teryt))
        if region_id is None:
            return []
        if self._seat_elsewhere(company_id, region_id):
            return []
        if self._edge_exists(region_id, company_id, "seat"):
            return []
        if self._edge_exists(region_id, company_id, "owns"):
            return []
        return [NEW_SEAT]

    def _edge_exists(self, source: str, target: str, edge_type: str) -> bool:
        """`findEdge`: any edge asserting this, removed ones included.

        A removed edge still counts, because the ingest looks it up the same
        way and would not write a second one beside it. The seat check is the
        one place that reads `deleted`, and it does so itself.
        """
        return bool(self.edges.get((source, target, edge_type)))

    def _seat_elsewhere(self, company_id: str, region_id: str) -> str | None:
        """The region already recorded as this company's seat, if another one.

        See `findSeatFromAnotherRegion`. A seat an admin has removed is not a
        competing claim - it is one they have already ruled on.
        """
        for pair, siblings in self.edges.items():
            if pair[1] != company_id or pair[2] != "seat":
                continue
            for stored in siblings:
                if stored.get("deleted") is True:
                    continue
                source = stored.get("source")
                if source and source != region_id:
                    return str(source)
        return None

    def _region_by_teryt(self, teryt: str) -> str | None:
        """`findRegionByTeryt`: the exact code, then the powiat above it.

        Each tried as a document id first and as a `teryt` field second, which
        is what the ingest does - the region pipeline mints `teryt<code>`, but
        a region node written before it carries the code as a field only.
        """
        candidates = [teryt, teryt[:4]] if len(teryt) > 4 else [teryt]
        for code in candidates:
            node_id = f"teryt{code}"
            if node_id in self.node_ids:
                return node_id
            found = self.regions.get(code)
            if found:
                return found
        return None

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
                # The ingest reports this candidacy and writes nothing, so
                # sending the payload for it achieves nothing either. Counted
                # rather than acted on - see `INFORMATIONAL_REASONS`.
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
        #: Stored edges a row has taken, and the `edge_identity` of the row
        #: that took each. The identity, not just the id, for the reason
        #: `claimedEdgeIds` carries it in `person.post.ts`.
        self.claimed: dict[str, tuple] = {}

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

        # The n-th row of this identity onto the n-th stored edge that says it,
        # out of those no *other* identity has taken. Both halves, and for the
        # two different collisions `findEdgeOrCreate` names: another row's claim
        # excludes an edge, an earlier row of this same identity is already
        # counted by `occurrence`. Subtracting the second twice is what let the
        # ingest write a duplicate.
        unclaimed = [
            stored
            for stored in same
            if self.claimed.get(str(stored.get("id")), identity) == identity
        ]
        if occurrence < len(unclaimed):
            self.claimed[str(unclaimed[occurrence].get("id"))] = identity
            return "same"

        for candidate in enrichable:
            if str(candidate.get("id")) not in self.claimed:
                self.claimed[str(candidate.get("id"))] = identity
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
