"""Invariants the koryta.pl database has to satisfy for the site to work.

Firestore enforces no schema and no foreign keys, so the assumptions the
frontend makes about its own data are only ever written down in the code that
reads it. When one of them stops holding, nothing raises: a dangling edge just
disappears from a graph, a person whose ``parties`` is an empty map matches
neither the "PiS" filter nor the "no party" one, and an extraction with no
``stats.votes`` is invisible to the query that looks for unreviewed facts -
which is the bug that prompted this file. The failure is always a missing row
somewhere, never an error.

These tests read the most recent production export and check those assumptions
against real data, so a regression shows up as a red test rather than as
something quietly missing from a page.

Where an invariant does not hold today the test carries a **budget**: the number
of documents known to be broken, with a note on what broke them. The invariant
is still stated in full - the budget only stops a known problem from failing the
build, and shrinks as the data is repaired. New breakage pushes the count over
the budget and fails.

Run just this file with::

    poetry run pytest src/tests/pipelines/test_invariants.py
"""

import collections

import pytest

from scrapers.koryta.snapshot import is_reference, reference_id

# Node and edge types the frontend knows how to render, from `shared/model.ts`.
NODE_TYPES = {"person", "place", "article", "region"}
EDGE_TYPES = {"employed", "connection", "mentions", "owns", "comment", "election"}

# Which node types an edge type may join, from `app/composables/useEdgeTypes.ts`,
# which is what the edit UI offers. `owns` also builds the region tree
# (województwo owns powiat), which no UI creates but `computeNodeStats` walks to
# attribute a company to its region. `comment` is left out on purpose: it only
# ever pointed at the legacy `blob` nodes and nothing creates it any more.
#
# `mentions` is the one type accepted in both directions, and only because the
# codebase cannot make up its mind: `useEdgeTypes.ts` declares the article as the
# source ("article mentions person"), while `ingest/person.post.ts` writes
# "person appears in article" and produces most of them. Until one of the two
# wins, the direction of a `mentions` edge carries no information and this test
# cannot ask it to.
EDGE_ENDPOINT_TYPES: dict[str, set[tuple[str, str]]] = {
    "employed": {("person", "place")},
    "election": {("person", "region")},
    "connection": {("person", "person")},
    "mentions": {
        ("article", "person"),
        ("article", "place"),
        ("person", "article"),
        ("place", "article"),
    },
    "owns": {("place", "place"), ("region", "place"), ("region", "region")},
}

VOTE_CATEGORIES = {"interesting", "quality", "correct", "insufficient"}

EXTRACTION_FACT_TYPES = {"employment", "party_membership", "personal_relation"}

# `computeVoteStats` never counts the pipeline's own votes as human review.
PIPELINE_USER = "pipeline"


def sample(items, limit: int = 10) -> list:
    """A short, stable excerpt for an assertion message."""
    if isinstance(items, (set, dict)):
        return sorted(items)[:limit]
    return list(items)[:limit]


def stats_of(document: dict) -> dict:
    """The document's `stats` sub-document, or an empty mapping."""
    stats = document.get("stats")
    return stats if isinstance(stats, dict) else {}


def stats_votes(document: dict) -> dict:
    """The stored vote aggregate of a node or extraction, or an empty mapping."""
    votes = stats_of(document).get("votes")
    return votes if isinstance(votes, dict) else {}


def compute_vote_stats(votes: list[dict]) -> dict:
    """Recompute a vote aggregate the way the site does.

    A port of `computeVoteStats` in `frontend/shared/stats.ts`, which the
    `onVoteWritten` trigger runs to maintain `stats.votes`. Only the counters and
    the `humanVoted` flag are reproduced; `lastVotedAt` is a formatted timestamp
    and nothing queries it.
    """
    aggregate: dict = {"interesting": 0, "quality": 0, "humanVoted": False}
    for vote in votes:
        if vote.get("userUid") != PIPELINE_USER:
            aggregate["humanVoted"] = True
        for category, value in (vote.get("categoryVotes") or {}).items():
            aggregate[category] = (aggregate.get(category) or 0) + value
    return aggregate


def stale_aggregates(documents: dict[str, dict], votes_by_target: dict[str, list]):
    """Targets whose stored `stats.votes` disagrees with the votes cast on them."""
    stale = []
    for target_id, votes in votes_by_target.items():
        document = documents.get(target_id)
        if document is None:
            continue  # a dangling vote, which test_vote_targets_exist covers
        stored = stats_votes(document)
        expected = compute_vote_stats(votes)
        differences = {}
        # `lastVotedAt` is a formatted timestamp rather than a tally, and the
        # recomputation deliberately does not reproduce it.
        for key in set(expected) | (set(stored) - {"lastVotedAt"}):
            got = stored.get(key)
            want = expected.get(key, 0)
            # A counter that was never written is a zero, not a difference; the
            # ingest seeds `{humanVoted: false}` and lets the trigger fill in the
            # rest on the first vote.
            actual = bool(got) if key == "humanVoted" else (got or 0)
            if actual != want:
                differences[key] = (got, want)
        if differences:
            stale.append((target_id, differences))
    return stale


# --------------------------------------------------------------------------- #
# Collections                                                                  #
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="session")
def nodes(snapshot):
    return snapshot.collection("nodes")


@pytest.fixture(scope="session")
def edges(snapshot):
    return snapshot.collection("edges")


@pytest.fixture(scope="session")
def revisions(snapshot):
    return snapshot.collection("revisions")


@pytest.fixture(scope="session")
def votes(snapshot):
    return snapshot.collection("votes")


@pytest.fixture(scope="session")
def extractions(snapshot):
    return snapshot.collection("extractions")


@pytest.fixture(scope="session")
def notes(snapshot):
    return snapshot.collection("notes")


@pytest.fixture(scope="session")
def node_ids(snapshot) -> set[str]:
    return snapshot.ids("nodes")


@pytest.fixture(scope="session")
def votes_by_node(votes) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = collections.defaultdict(list)
    for vote in votes:
        if vote.get("nodeId"):
            grouped[vote["nodeId"]].append(vote)
    return grouped


@pytest.fixture(scope="session")
def votes_by_extraction(votes) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = collections.defaultdict(list)
    for vote in votes:
        if vote.get("extractionId"):
            grouped[vote["extractionId"]].append(vote)
    return grouped


# --------------------------------------------------------------------------- #
# extractions                                                                  #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_every_extraction_has_vote_stats(extractions):
    """An extraction must carry `stats.votes.humanVoted`, even with no votes.

    The review flow asks the server for the facts nobody has looked at, which is
    a `stats.votes.humanVoted == false` query. Firestore cannot match a field
    that is absent, so a fact missing the aggregate is not "unreviewed" to that
    query - it simply does not exist, and no reviewer is ever shown it. Ingest
    seeds the field and the `onVoteWritten` trigger maintains it from there.
    """
    missing = [
        document["id"]
        for document in extractions
        if not isinstance(stats_votes(document).get("humanVoted"), bool)
    ]

    assert not missing, (
        f"{len(missing)}/{len(extractions)} extractions have no boolean "
        f"stats.votes.humanVoted, so the review flow cannot find them. "
        f"Repair with scripts/backfill-extraction-vote-stats.ts. "
        f"Sample IDs: {sample(missing)}"
    )


@pytest.mark.integration
def test_extraction_vote_stats_match_the_votes_cast(extractions, votes_by_extraction):
    """`stats.votes` must agree with the votes collection.

    The aggregate is what the review flow reads; the votes are the truth. They
    drift apart whenever the trigger does not fire - which is how the aggregate
    went missing on extractions in the first place, before the trigger covered
    them.
    """
    by_id = {document["id"]: document for document in extractions}
    stale = stale_aggregates(by_id, votes_by_extraction)

    assert not stale, (
        f"{len(stale)}/{len(votes_by_extraction)} voted-on extractions have a "
        f"stats.votes that disagrees with their votes, as "
        f"(id, {{field: (stored, recomputed)}}): {sample(stale, 5)}"
    )


@pytest.mark.integration
def test_extraction_article_node_is_an_article(extractions, snapshot):
    """`articleNodeId` links a fact to the article node it was extracted from.

    Vacuous today: not one of the 269 extractions carries the field, because the
    ingest only sets it when an article node already has that exact `sourceURL`
    and none of the 68 urls the facts came from matched one. The check is here
    for when they start to.
    """
    nodes_by_id = snapshot.by_id("nodes")
    wrong = [
        (document["id"], document["articleNodeId"])
        for document in extractions
        if document.get("articleNodeId")
        and nodes_by_id.get(document["articleNodeId"], {}).get("type") != "article"
    ]

    assert not wrong, (
        f"{len(wrong)} extractions link to a node that is missing or is not an "
        f"article: {sample(wrong)}"
    )


@pytest.mark.integration
def test_extraction_fact_types_are_known(extractions):
    """Only the fact types the ingest schema accepts may be stored."""
    unknown = collections.Counter(
        document.get("fact_type")
        for document in extractions
        if document.get("fact_type") not in EXTRACTION_FACT_TYPES
    )

    assert not unknown, (
        f"Extractions carry fact types the frontend does not render: "
        f"{dict(unknown)}"
    )


# --------------------------------------------------------------------------- #
# votes                                                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_every_vote_names_the_document_it_is_about(votes):
    """A vote sets exactly one of `nodeId` and `extractionId`.

    `onVoteWritten` has nothing to aggregate into otherwise: it logs a warning
    and returns, so the vote counts for nothing.
    """
    # 299 documents from the pre-2025 vote format, which stored `scores` keyed by
    # user and a `reference.external_id` pointing at a document that no longer
    # exists. They are inert - every reader skips a vote with no target - but
    # they are also 7% of the collection, so they are worth deleting rather than
    # scanning forever.
    LEGACY_VOTES = 299

    untargeted = [
        vote["id"]
        for vote in votes
        if bool(vote.get("nodeId")) == bool(vote.get("extractionId"))
    ]

    assert len(untargeted) <= LEGACY_VOTES, (
        f"{len(untargeted)} votes name neither a node nor an extraction (or "
        f"both), up from the {LEGACY_VOTES} known legacy documents. "
        f"Sample IDs: {sample(untargeted)}"
    )


@pytest.mark.integration
def test_vote_targets_exist(votes, node_ids, snapshot):
    """A vote must point at a document that is still there."""
    extraction_ids = snapshot.ids("extractions")
    dangling = [
        (vote["id"], vote.get("nodeId") or vote.get("extractionId"))
        for vote in votes
        if (vote.get("nodeId") and vote["nodeId"] not in node_ids)
        or (vote.get("extractionId") and vote["extractionId"] not in extraction_ids)
    ]

    assert not dangling, (
        f"{len(dangling)} votes point at a node or extraction that no longer "
        f"exists: {sample(dangling)}"
    )


@pytest.mark.integration
def test_vote_categories_are_known(votes):
    """`categoryVotes` decides which counters `stats.votes` grows.

    An unknown category is summed into the aggregate all the same, where nothing
    reads it, so a typo silently produces a counter no page shows.
    """
    unknown = collections.Counter(
        category
        for vote in votes
        for category in (vote.get("categoryVotes") or {})
        if category not in VOTE_CATEGORIES
    )

    assert not unknown, f"Votes use categories the frontend ignores: {dict(unknown)}"


# --------------------------------------------------------------------------- #
# nodes                                                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_node_vote_stats_match_the_votes_cast(nodes, votes_by_node):
    """The same aggregate-versus-truth check as for extractions, for nodes.

    `stats.votes.interesting` backs the table's "minimum votes" filter and
    `humanVoted` backs the tagging-progress counts, so a stale aggregate shows
    the wrong people as still needing review.
    """
    by_id = {document["id"]: document for document in nodes}
    stale = stale_aggregates(by_id, votes_by_node)

    assert not stale, (
        f"{len(stale)}/{len(votes_by_node)} voted-on nodes have a stats.votes "
        f"that disagrees with their votes, as "
        f"(id, {{field: (stored, recomputed)}}): {sample(stale, 5)}"
    )


@pytest.mark.integration
def test_is_approved_matches_the_approved_revision(nodes):
    """`stats.isApproved` is a copy of `!!revision_id` and must stay one.

    The two are read in different places - `isApproved` by the tagging-progress
    counters, `revision_id` by `pageIsPublic`, which decides whether a logged out
    visitor sees the page at all - so if they disagree the site contradicts
    itself about whether a person is published.
    """
    mismatched = [
        document["id"]
        for document in nodes
        if bool(document.get("revision_id"))
        != bool(stats_of(document).get("isApproved"))
    ]

    assert not mismatched, (
        f"{len(mismatched)} nodes disagree with themselves about being "
        f"approved: {sample(mismatched)}"
    )


@pytest.mark.integration
@pytest.mark.parametrize("collection", ["nodes", "edges"])
def test_revision_id_points_at_the_documents_own_revision(snapshot, collection):
    """`revision_id` names the revision that was published.

    `/api/revisions/byNode` compares it against the revisions of that document
    to decide which one is live, and `computeRevisionsObj` compares it against
    the newest one to decide whether a change is still awaiting approval.
    Pointing somewhere else makes every revision look unapproved forever.
    """
    # The TERYT seeding, which set `revision_id` to a value it made up rather
    # than to a revision it wrote: the region's own id (`teryt02`) on 390 nodes
    # and `rev_edge_<...>` on 375 of the region tree's `owns` edges, plus 15
    # regions pointing at a neighbouring region's revision. They read as
    # published, which is what was wanted, but their history is permanently
    # marked as pending.
    SEEDED_REGIONS = {"nodes": 405, "edges": 375}

    revisions_by_id = snapshot.by_id("revisions")
    wrong = []
    for document in snapshot.collection(collection):
        if not document.get("revision_id"):
            continue
        revision = revisions_by_id.get(reference_id(document["revision_id"]))
        if revision is None or reference_id(revision.get("node_id")) != document["id"]:
            wrong.append((document["id"], reference_id(document["revision_id"])))

    budget = SEEDED_REGIONS[collection]
    assert len(wrong) <= budget, (
        f"{len(wrong)} {collection} have a revision_id that is not a revision "
        f"of that document, up from the {budget} known seeded regions. "
        f"Sample (document, revision_id): {sample(wrong)}"
    )


@pytest.mark.integration
def test_node_types_are_known(nodes):
    """Every node is one of the four types the frontend can render.

    `getNodesNoStats` builds the graph from people, companies and regions only,
    so a node of any other type is dropped - and with it every edge that touches
    it, since edges to unknown nodes are filtered out too.
    """
    # 233 `blob` nodes: free text and article urls attached to a person by the
    # earliest version of the site, before articles were nodes of their own. They
    # are only reachable through the `comment` and `source` edges that point at
    # them, which are legacy in the same way.
    LEGACY_BLOBS = 233

    unknown = [
        document["id"] for document in nodes if document.get("type") not in NODE_TYPES
    ]
    by_type = collections.Counter(
        document.get("type")
        for document in nodes
        if document.get("type") not in NODE_TYPES
    )

    assert len(unknown) <= LEGACY_BLOBS, (
        f"{len(unknown)} nodes have a type the frontend does not render "
        f"({dict(by_type)}), up from the {LEGACY_BLOBS} known legacy blobs. "
        f"Sample IDs: {sample(unknown)}"
    )


@pytest.mark.integration
def test_every_node_has_a_name(nodes):
    """`name` is what search indexes and what every listing shows."""
    # The same 233 legacy blobs, which hold `text` or `url` instead, plus six
    # article nodes created from a url whose title could not be read.
    NAMELESS = 239

    nameless = [document["id"] for document in nodes if not document.get("name")]
    by_type = collections.Counter(
        document.get("type") for document in nodes if not document.get("name")
    )

    assert len(nameless) <= NAMELESS, (
        f"{len(nameless)} nodes have no name ({dict(by_type)}), up from the "
        f"{NAMELESS} known ones. Sample IDs: {sample(nameless)}"
    )


@pytest.mark.integration
def test_array_fields_are_stored_as_arrays(nodes):
    """An array field has to be a real array for `array-contains` to see it.

    `sanitizeFirestoreData` used to rewrite arrays as maps with numbered keys
    (`{"0": "PO"}`) when a revision was written, and Firestore's
    `array-contains-any` does not match a map - nor does it raise, so the node
    drops out of the filter rather than failing. A person stored that way is
    invisible to every party filter, and to the "no party" filter too, which
    looks for `parties == []` and does not match `{}` either.
    """
    # The writer is fixed (server/utils/revisions.ts rewrites only an array
    # nested directly inside another array, which is the case Firestore really
    # cannot store), so this count no longer grows - it was 105 in the export of
    # 2026-06-28 and 461 in that of 2026-07-28, while the number of people
    # holding a real array stood still at 5617 in both.
    #
    # It goes to zero once scripts/migrate/unwrap-array-fields.ts is run against
    # production; the budget is exactly the 3041 nodes its dry run reports.
    MAP_VALUED = 3041

    fields = ("parties", "activity", "categories")
    not_arrays = [
        (document["id"], field)
        for document in nodes
        for field in fields
        if field in document and not isinstance(document[field], list)
    ]
    by_field = collections.Counter(field for _, field in not_arrays)
    documents = {document_id for document_id, _ in not_arrays}

    assert len(documents) <= MAP_VALUED, (
        f"{len(documents)} nodes store an array field as a map ({dict(by_field)}), "
        f"and are missing from any array-contains filter on it - up from the "
        f"{MAP_VALUED} the migration knows about. "
        f"Sample: {sample(not_arrays)}"
    )


@pytest.mark.integration
def test_companies_are_not_duplicated_by_krs(nodes):
    """One company node per KRS number.

    Both the company ingest and the KRS table filter look a company up with
    `where("krsNumber", "==", krs).limit(1)`, so a second node with the same
    number is unreachable: ingests land on whichever copy Firestore returns
    first and the other silently keeps stale data.
    """
    counts = collections.Counter(
        document["krsNumber"] for document in nodes if document.get("krsNumber")
    )
    duplicated = {krs: count for krs, count in counts.items() if count > 1}

    assert not duplicated, (
        f"{len(duplicated)} KRS numbers have more than one company node: "
        f"{sample(duplicated)}"
    )


@pytest.mark.integration
def test_regions_are_identified_by_teryt(nodes):
    """Every region has a TERYT code, and no two regions share one.

    The company ingest resolves a company's seat to a region by TERYT, and the
    region filter matches on it; a missing or duplicated code makes a region
    unaddressable.
    """
    regions = [document for document in nodes if document.get("type") == "region"]
    missing = [document["id"] for document in regions if not document.get("teryt")]
    counts = collections.Counter(
        document["teryt"] for document in regions if document.get("teryt")
    )
    duplicated = {teryt: count for teryt, count in counts.items() if count > 1}

    assert not missing, f"{len(missing)} regions have no teryt: {sample(missing)}"
    assert not duplicated, f"TERYT codes used by several regions: {duplicated}"


@pytest.mark.integration
def test_edge_stats_cover_every_edge_of_the_node(nodes, edges):
    """`stats.edges.all.targetNodeIds` is the index behind the table filters.

    The people table filters by company and by region through an
    `array-contains` on this field rather than by reading the edges, so a target
    missing from it means the person does not show up under a company they
    demonstrably work for.

    Strict, even though /api/stats/computeNodes rebuilds it in a batch and could
    in principle lag: the exports of 2026-06-28 and 2026-07-28 both had every
    edge covered, so drift here is news rather than routine.
    """
    # `computeNodeStats` indexes an edge under both of its ends and then takes
    # the target of each, so a node that is only ever a target still lists
    # itself. Mirrored here rather than corrected: the point is to check the
    # stored index against the edges, not to redesign it.
    expected: dict[str, set[str]] = collections.defaultdict(set)
    for edge in edges:
        expected[edge["source"]].add(edge["target"])
        expected[edge["target"]].add(edge["target"])

    incomplete = []
    for document in nodes:
        edge_stats = stats_of(document).get("edges") or {}
        stored = set((edge_stats.get("all") or {}).get("targetNodeIds") or [])
        missing = expected.get(document["id"], set()) - stored
        if missing:
            incomplete.append((document["id"], sample(missing, 3)))

    assert not incomplete, (
        f"{len(incomplete)} nodes have edge targets missing from "
        f"stats.edges.all.targetNodeIds, so the table filters cannot find them: "
        f"{sample(incomplete, 5)}"
    )


# --------------------------------------------------------------------------- #
# edges                                                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_edge_endpoints_exist(edges, node_ids):
    """Both ends of an edge must be nodes that exist.

    An edge to a deleted node is dropped from the graph without a trace - the
    local-graph endpoint filters edges down to the nodes it managed to fetch -
    so a person quietly loses a connection instead of showing a broken one.
    """
    dangling = [
        (edge["id"], end, edge.get(end))
        for edge in edges
        for end in ("source", "target")
        if edge.get(end) not in node_ids
    ]

    assert not dangling, (
        f"{len(dangling)} edge endpoints reference a node that does not exist, "
        f"as (edge, end, missing node): {sample(dangling)}"
    )


@pytest.mark.integration
def test_edge_types_are_known(edges):
    """Only the six edge types `shared/model.ts` declares may be stored."""
    # 64 `source` and 3 `mentioned_person` edges. `source` predates article
    # nodes and points at a legacy blob; `mentioned_person` is the *UI* name for
    # an article->person `mentions` edge (see `useEdgeTypes.ts`), written to the
    # database by mistake instead of its `realType`.
    LEGACY_EDGE_TYPES = 67

    unknown = collections.Counter(
        edge.get("type") for edge in edges if edge.get("type") not in EDGE_TYPES
    )

    assert sum(unknown.values()) <= LEGACY_EDGE_TYPES, (
        f"{sum(unknown.values())} edges have a type the frontend does not "
        f"handle ({dict(unknown)}), up from the {LEGACY_EDGE_TYPES} known ones."
    )


@pytest.mark.integration
def test_edges_join_the_node_types_they_are_defined_for(edges, snapshot):
    """An `employed` edge runs person -> place, an `election` person -> region.

    The stats pipeline relies on it without checking: `computeEdgeStats` reads
    the *target* of every `employed` edge as the company whose public ownership
    decides whether the time counts as experience. An edge pointing the other
    way, or at a region, is counted as employment at a place that is not one.
    """
    # 81 edges into the legacy `blob` nodes, 27 `employed` edges pointing at a
    # region rather than at a company, and 21 assorted others - a `mentions`
    # edge between two articles, `connection` edges from an article or a
    # company. All predate the edit UI constraining what may be linked to what.
    LEGACY_ORIENTATIONS = 129

    nodes_by_id = snapshot.by_id("nodes")
    wrong: collections.Counter = collections.Counter()
    for edge in edges:
        allowed = EDGE_ENDPOINT_TYPES.get(edge.get("type"))
        if allowed is None:
            continue  # an unknown edge type, which test_edge_types_are_known covers
        pair = (
            nodes_by_id.get(edge["source"], {}).get("type"),
            nodes_by_id.get(edge["target"], {}).get("type"),
        )
        if pair not in allowed:
            wrong[(edge["type"], *pair)] += 1

    assert sum(wrong.values()) <= LEGACY_ORIENTATIONS, (
        f"{sum(wrong.values())} edges join node types their edge type is not "
        f"defined for, up from the {LEGACY_ORIENTATIONS} known ones, as "
        f"(edge type, source type, target type): {dict(wrong)}"
    )


@pytest.mark.integration
def test_no_edge_is_stored_twice(edges):
    """The same fact must not be recorded by two edge documents.

    Two identical `employed` edges are two jobs as far as the graph and the
    experience calculation are concerned. Duplicates are not merely (source,
    target, type) collisions - a person can genuinely hold the same post twice -
    so this compares everything that distinguishes one edge from another.
    """
    # 549 redundant documents, mostly `election` edges re-imported from PKW
    # before the ingest derived its edge ids from the triple they represent.
    # Still creeping up - 541 a month earlier - so a failure here means another
    # import wrote edges it should have recognised as already present.
    KNOWN_DUPLICATES = 549

    distinguishing = (
        "source",
        "target",
        "type",
        "name",
        "start_date",
        "end_date",
        "party",
        "committee",
        "position",
        "term",
        "elected",
        "by_election",
    )
    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        groups[tuple(str(edge.get(field)) for field in distinguishing)].append(
            edge["id"]
        )

    duplicated = {key: ids for key, ids in groups.items() if len(ids) > 1}
    redundant = sum(len(ids) - 1 for ids in duplicated.values())

    assert redundant <= KNOWN_DUPLICATES, (
        f"{redundant} edge documents duplicate another one exactly, across "
        f"{len(duplicated)} groups, up from the {KNOWN_DUPLICATES} known ones. "
        f"Sample groups: {sample(list(duplicated.values()), 5)}"
    )


@pytest.mark.integration
def test_employment_does_not_end_before_it_starts(edges):
    """`start_date <= end_date` on every edge that has both.

    `calculateExperience` silently drops an interval it cannot make sense of, so
    an inverted one does not raise - the person just shows less experience than
    they have.
    """
    # One `employed` edge, presumably a typo in a manually entered date.
    KNOWN_INVERTED = 1

    inverted = [
        (edge["id"], edge["start_date"], edge["end_date"])
        for edge in edges
        if edge.get("start_date")
        and edge.get("end_date")
        and str(edge["start_date"])[:10] > str(edge["end_date"])[:10]
    ]

    assert len(inverted) <= KNOWN_INVERTED, (
        f"{len(inverted)} edges end before they start, up from the "
        f"{KNOWN_INVERTED} known one: {sample(inverted)}"
    )


# --------------------------------------------------------------------------- #
# revisions                                                                    #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_revision_node_id_is_a_document_id(revisions):
    """`node_id` has to be a plain id string, not a document reference.

    `/api/revisions/byNode` finds a document's history with
    `where("node_id", "==", nodeId)`, passing the id as a string. Firestore
    compares a reference field to a string as unequal, so a revision stored with
    a reference never comes back: the document's history looks empty and the
    change cannot be approved through the UI.
    """
    # 1114 revisions from the December 2025 backfill in
    # src/scripts/create_revisions.py, which writes `source_ref.document(doc.id)`
    # where the frontend writes `targetRef.id`. The same batch is why
    # test_revisions.py's source/target checks fail - see its docstring.
    MIGRATION_REVISIONS = 1114

    references = [
        revision["id"]
        for revision in revisions
        if is_reference(revision.get("node_id"))
    ]

    assert len(references) <= MIGRATION_REVISIONS, (
        f"{len(references)} revisions store node_id as a document reference "
        f"rather than an id, so /api/revisions/byNode cannot find them - up "
        f"from the {MIGRATION_REVISIONS} known migration rows. "
        f"Sample IDs: {sample(references)}"
    )


@pytest.mark.integration
def test_every_revision_belongs_to_a_document(revisions, node_ids, snapshot):
    """A revision describes a node or an edge, which has to still exist.

    Revisions are the audit trail and the approval queue; one whose subject is
    gone can never be approved and is only ever noise in the pending list.
    """
    # 17 revisions of documents deleted after the revision was written.
    ORPHANED_REVISIONS = 17

    document_ids = node_ids | snapshot.ids("edges")
    orphaned = [
        revision["id"]
        for revision in revisions
        if reference_id(revision.get("node_id")) not in document_ids
    ]

    assert len(orphaned) <= ORPHANED_REVISIONS, (
        f"{len(orphaned)} revisions describe a node or edge that no longer "
        f"exists, up from the {ORPHANED_REVISIONS} known ones. "
        f"Sample IDs: {sample(orphaned)}"
    )


@pytest.mark.integration
def test_a_later_revision_never_drops_a_field(revisions):
    """A revision is a whole snapshot, so it must not lose an earlier field.

    `createRevisionTransaction` writes the revision's `data` over the node with
    `set`, not `merge`: whatever the revision leaves out is erased from the
    node. An endpoint that only knows some of the fields therefore has to layer
    them over `baseNodeFields` first, and a revision that skipped that step
    silently deletes everything it did not know about.
    """
    # One article, oYkxDlD1KfkO96p6PIwK, whose January 2026 edit lost the
    # `estimates` field the previous revision carried. It is still on the node
    # only because that revision was never approved; approving it would run the
    # `set` and drop the field for good.
    KNOWN_DROPS = 1

    # Bookkeeping the node owns rather than the revision, listed in
    # server/utils/revisions.ts as INTERNAL_FIELDS. They are regenerated or
    # maintained elsewhere, so a revision is right not to carry them.
    internal = {
        "stats",
        "revision_id",
        "revisions",
        "votes",
        "id",
        "deleted",
        "delete_reason",
        "visibility",
        "nameChunksLower",
    }

    by_document: dict[str, list[dict]] = collections.defaultdict(list)
    for revision in revisions:
        document_id = reference_id(revision.get("node_id"))
        if document_id and isinstance(revision.get("data"), dict):
            by_document[document_id].append(revision)

    dropped = []
    for document_id, history in by_document.items():
        if len(history) < 2:
            continue
        history = sorted(history, key=lambda r: str(r.get("update_time")))
        for earlier, later in zip(history, history[1:]):
            lost = {
                field
                for field, value in earlier["data"].items()
                if field not in internal
                and value not in (None, "", [], {})
                and field not in later["data"]
            }
            if lost:
                dropped.append((document_id, earlier["id"], later["id"], sorted(lost)))

    assert len(dropped) <= KNOWN_DROPS, (
        f"{len(dropped)} revisions drop a field their predecessor had, which "
        f"erases it from the node once approved - up from the {KNOWN_DROPS} "
        f"known one. As (document, earlier, later, lost fields): "
        f"{sample(dropped, 5)}"
    )


@pytest.mark.integration
def test_revisions_record_who_changed_what_and_when(revisions):
    """`update_time` and `update_user` back the history view and the credits.

    `computeRevisionsObj` sorts by `update_time` to decide which revision is the
    latest; one without a timestamp sorts as the epoch and can never be the
    latest, so the node claims a pending change forever.
    """
    # The single "Test field" revision, which has no data.type, node_id,
    # update_time or update_user - see test_revisions.py.
    KNOWN_INCOMPLETE = 1

    incomplete = [
        revision["id"]
        for revision in revisions
        if not revision.get("update_time") or not revision.get("update_user")
    ]

    assert len(incomplete) <= KNOWN_INCOMPLETE, (
        f"{len(incomplete)} revisions have no update_time or update_user, up "
        f"from the {KNOWN_INCOMPLETE} known one: {sample(incomplete)}"
    )


# --------------------------------------------------------------------------- #
# notes                                                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.integration
def test_notes_belong_to_an_existing_node(notes, node_ids):
    """`/api/notes` resolves each note's `nodeId` to a name to display it."""
    dangling = [
        (note["id"], note.get("nodeId"))
        for note in notes
        if note.get("nodeId") not in node_ids
    ]

    assert not dangling, (
        f"{len(dangling)} notes are attached to a node that does not exist: "
        f"{sample(dangling)}"
    )


@pytest.mark.integration
def test_one_note_per_user_and_node(notes):
    """A user keeps a single note per node, which the note editor overwrites.

    A second document for the same pair would make the editor show one note and
    `stats.notesCount` count both.
    """
    counts = collections.Counter(
        (note.get("userUid"), note.get("nodeId")) for note in notes
    )
    duplicated = {pair: count for pair, count in counts.items() if count > 1}

    assert not duplicated, (
        f"{len(duplicated)} (user, node) pairs have more than one note: "
        f"{sample(duplicated, 5)}"
    )


@pytest.mark.integration
def test_notes_count_matches_the_notes(notes, nodes):
    """`stats.notesCount` counts the *sources* across a node's notes.

    It is what the table's "has sources" column and the tagging-progress
    breakdown read, neither of which touches the notes collection.

    Unlike `stats.votes`, no trigger maintains this: it is only refreshed when
    someone runs /api/stats/computeNodes, which nothing in the repository calls.
    A node or two is therefore normally behind - the 2026-06-28 export had one -
    and the tolerance is there for that. A larger number means the recompute has
    not been run for a long time, not that a single edit went wrong.
    """
    RECOMPUTE_LAG = 5

    sources_by_node: collections.Counter = collections.Counter()
    for note in notes:
        sources = note.get("sources")
        sources_by_node[note.get("nodeId")] += len(sources) if sources else 0

    wrong = [
        (document["id"], stats_of(document).get("notesCount"), expected)
        for document in nodes
        if (expected := sources_by_node[document["id"]])
        != stats_of(document).get("notesCount", 0)
    ]

    assert len(wrong) <= RECOMPUTE_LAG, (
        f"{len(wrong)} nodes have a stats.notesCount that does not match their "
        f"notes, more than the {RECOMPUTE_LAG} a normal recompute lag explains. "
        f"As (node, stored, actual): {sample(wrong, 5)}"
    )
