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

Reading the export needs credentials and a download, so the whole file is
marked ``e2e`` and deselected by default. Run it with::

    .venv/bin/pytest -m e2e src/tests/pipelines/test_invariants.py
"""

import collections

import pytest

from scrapers.koryta.snapshot import is_reference, reference_id

#: Every test here reads the production export rather than a fixture, which is
#: what `e2e` marks: a test that needs state this repository does not carry.
pytestmark = pytest.mark.e2e

# Node and edge types the frontend knows how to render, from `shared/model.ts`.
# `topic` is the newest and the reason `nodeTypes` there is a tuple the zod
# enums derive from: four handlers had written the list out by hand and none of
# them was found by the compiler when it was added.
NODE_TYPES = {"person", "place", "article", "region", "topic"}
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

# Edge types that assert a relationship rather than an occurrence: the pair and
# the type are the whole of what they say, so there is nothing to count and a
# second document is always redundant. `employed` and `election` are the other
# kind - one bounded episode, which can legitimately repeat between the same two
# nodes. Kept in step with EDGE_SEMANTICS in `frontend/server/utils/edges.ts`.
STATE_EDGE_TYPES = {"owns", "mentions", "comment", "source"}

# Edge types that record a period rather than a standing tie, and so have to say
# when it began. Every other type asserts something with no beginning - an
# article names a person, a region seats a company - and the edit form agrees:
# it offers the two date fields only on its `employed` branch. `connection` is
# the one that looks like an exception, because `EDGE_SEMANTICS` lists
# `start_date` among the fields that tell two of them apart, but nothing can
# write one and not one of the 89 stored carries a date.
#
# So on the other six types a `start_date` is always a blank rather than a date:
# 6 `owns`, 8 `mentions`, 8 `connection` and 3 `mentioned_person` hold an empty
# string, which is what a form leaves behind, and none holds a value.
DATED_EDGE_TYPES = ("employed", "election")

VOTE_CATEGORIES = {"interesting", "quality", "correct", "insufficient"}

EXTRACTION_FACT_TYPES = {
    "employment",
    "party_membership",
    "personal_relation",
    "affair_involvement",
}

# `computeVoteStats` never counts the pipeline's own votes as human review, and
# each scoring model votes under its own uid containing this word.
PIPELINE_USER = "pipeline"


def sample(items, limit: int = 10) -> list:
    """A short, stable excerpt for an assertion message."""
    if isinstance(items, (set, dict)):
        return sorted(items)[:limit]
    return list(items)[:limit]


def has_date(document: dict, field: str) -> bool:
    """Whether a stored date field says anything.

    `None` and `""` are one absence seen from two writers: /api/edges/create
    stores `null` for a date the form left blank while the editor stores an
    empty string, and every reader in the frontend tests the field for
    truthiness, so neither is a date.
    """
    value = document.get(field)
    if isinstance(value, str):
        return bool(value.strip())
    return value is not None


def stats_of(document: dict) -> dict:
    """The document's `stats` sub-document, or an empty mapping."""
    stats = document.get("stats")
    return stats if isinstance(stats, dict) else {}


def stats_votes(document: dict) -> dict:
    """The stored vote aggregate of a node or extraction, or an empty mapping."""
    votes = stats_of(document).get("votes")
    return votes if isinstance(votes, dict) else {}


def page_is_public(document: dict) -> bool:
    """Whether a logged out visitor can see this document's page.

    A port of `pageIsPublic` in `frontend/shared/model.ts`: an approved removal
    outranks everything, and otherwise `published` is the whole answer. An
    absent flag is a draft, which is what makes losing the field a way to
    unpublish a page by accident rather than a no-op.
    """
    if document.get("deleted") is True:
        return False
    return document.get("published") is True


def compute_vote_stats(votes: list[dict]) -> dict:
    """Recompute a vote aggregate the way the site does.

    A port of `computeVoteStats` in `frontend/shared/stats.ts`, which the
    `onVoteWritten` trigger runs to maintain `stats.votes`. Only the counters,
    the `humanVoted` flag and the `humanCount` tally are reproduced;
    `lastVotedAt` is a formatted timestamp and nothing queries it, and `models`
    is a breakdown rather than a tally.

    `humanCount` has to be mirrored rather than ignored: `stale_aggregates`
    walks the union of the stored and the expected keys, so a counter the site
    writes and this port does not know about reads as a difference on every
    node anybody has voted on. Until the backfill in
    `frontend/scripts/migrate/backfill-vote-human-count.ts` has run against a
    snapshot - and the functions redeploy that keeps it current - those nodes
    are genuinely stale, and this reports them.

    Human votes sum and the scoring models contribute only their best, which is
    what keeps a new model from rescaling a number the site sorts and buckets
    on. See `computeVoteStats` for why.
    """
    aggregate: dict = {"interesting": 0, "quality": 0, "humanVoted": False}
    pipeline_best: dict = {}
    # By uid, as the site counts it: one person voting in two categories on the
    # same node is one voter. A vote carrying no uid still sets `humanVoted` and
    # still cannot be counted, which is the site's behaviour too.
    humans: set = set()
    for vote in votes:
        from_pipeline = PIPELINE_USER in str(vote.get("userUid") or "")
        if not from_pipeline:
            aggregate["humanVoted"] = True
            if vote.get("userUid"):
                humans.add(str(vote["userUid"]))
        for category, value in (vote.get("categoryVotes") or {}).items():
            if from_pipeline:
                current = pipeline_best.get(category)
                pipeline_best[category] = (
                    value if current is None else max(current, value)
                )
            else:
                aggregate[category] = (aggregate.get(category) or 0) + value
    for category, best in pipeline_best.items():
        aggregate[category] = (aggregate.get(category) or 0) + best
    if humans:
        aggregate["humanCount"] = len(humans)
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
        # `lastVotedAt` is a formatted timestamp and `models` a per-model
        # breakdown, rather than tallies; the recomputation deliberately
        # reproduces neither.
        for key in set(expected) | (set(stored) - {"lastVotedAt", "models"}):
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
def articles(nodes) -> list[dict]:
    """The article nodes, which /zrodla is a list of.

    They are the one node type nothing edits by hand: `ensureArticleNode` writes
    them from whatever `getPageMeta` could read off the page, approves them on
    the spot and never comes back. So a field it failed to fill stays empty, and
    the tests below are about the fields the site then needs.
    """
    return [document for document in nodes if document.get("type") == "article"]


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


def test_extraction_fact_types_are_known(extractions):
    """Only the fact types the ingest schema accepts may be stored."""
    unknown = collections.Counter(
        document.get("fact_type")
        for document in extractions
        if document.get("fact_type") not in EXTRACTION_FACT_TYPES
    )

    assert not unknown, (
        f"Extractions carry fact types the frontend does not render: {dict(unknown)}"
    )


# --------------------------------------------------------------------------- #
# votes                                                                        #
# --------------------------------------------------------------------------- #


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


@pytest.mark.parametrize("collection", ["nodes", "edges"])
def test_every_document_says_whether_it_is_published(snapshot, collection):
    """`published` is stored on every node and edge, not merely on the live ones.

    A revision is written to its target with `set` rather than `merge`, and
    `withoutInternalFields` keeps `published` out of every revision on purpose -
    a revision states the data, not who may see it. So a writer that does not
    carry the flag back does not leave it alone, it deletes it, and
    `pageIsPublic` reads an absent flag as a draft: the page comes off the site
    without anything having decided to remove it.

    That is not hypothetical. It is what re-running the scrapers over somebody
    the database already had used to do, until the person ingest started handing
    the stored document to `createRevisionTransaction` - which is the only
    reason this test can be strict rather than carry a budget.
    """
    missing = [
        document["id"]
        for document in snapshot.collection(collection)
        if "published" not in document
    ]

    assert not missing, (
        f"{len(missing)} {collection} have no `published` field, so they read "
        f"as drafts whatever was intended: {sample(missing)}"
    )


def test_every_node_keeps_the_counters_no_revision_carries(nodes):
    """`stats` and `revisions` survive every write to a node.

    Neither is part of any revision - see `INTERNAL_FIELDS` - and both are
    written by triggers rather than by whoever last edited the node, so the
    write that materialises a revision has to put them back explicitly. Missing
    them is invisible on the page itself and only shows up in aggregate: `stats`
    backs every filter, count and sort on /eksploruj, and `revisions` is the
    history the edit UI offers.

    `votes` and `nameChunksLower` belong to the same set but are not asserted
    here. Exactly one node carries a `votes` field, so requiring it would state
    a rule the data has never followed; `nameChunksLower` is absent from 520
    nodes, 263 of them published articles, which is a gap in the search index
    rather than anything a revision write did.
    """
    missing = [
        (document["id"], field)
        for document in nodes
        for field in ("stats", "revisions")
        if field not in document
    ]

    assert not missing, (
        f"{len(missing)} nodes have lost a field no revision carries, as "
        f"(node, field): {sample(missing)}"
    )


def test_a_published_node_is_in_the_listings(nodes):
    """A node the public can see must also be one the listings can find.

    `/api/nodes` filters every listing on `stats.isApproved == true`, and a
    Firestore equality filter does not match a document that lacks the field at
    all. So a node that is published but whose `stats` went missing keeps its
    page and disappears from every table, search and graph that leads to it -
    live, and reachable only by someone who already has the URL.

    The two halves are written by different things, which is how they came
    apart: `published` by whoever last wrote the node, `stats.isApproved` by the
    `onNodeWritten` trigger, and that trigger only rewrites it when visibility
    *changes*. Carrying visibility across correctly is what stopped it covering
    for a `stats` that a re-ingest had erased.
    """
    invisible = [
        document["id"]
        for document in nodes
        if page_is_public(document) and stats_of(document).get("isApproved") is not True
    ]

    assert not invisible, (
        f"{len(invisible)} nodes are published but not `stats.isApproved`, so "
        f"their pages are live and absent from every listing that leads to "
        f"them: {sample(invisible)}"
    )


def test_a_node_with_a_name_index_can_be_searched_for(nodes):
    """Carrying the search index is not enough to be found by it.

    `/api/search` matches on `nameChunksLower` and orders the hits by
    `stats.nodeGroupSize`, and Firestore returns no document that lacks the
    field it is ordered on. So a node can carry a complete name index, have a
    working page, and still be absent from every search for its own name -
    which is what a person ingested on 2026-08-21 was reported as.

    Only `/api/stats/computeNodes` really works the counter out, it writes it
    for every node at once, and an admin runs it by hand, so between two runs
    everything created in between was in this state.
    `withSeededNodeStats` in server/utils/revisions.ts now seeds a zero on
    every node written through a revision, and
    scripts/migrate/backfill-node-group-size.ts repairs the ones already
    stored.
    """
    # Measured against production on 2026-08-23, before the migration ran:
    # 474 people and 204 companies. Articles are not searched and so are not
    # counted here. This goes to zero once the backfill has been run against
    # production.
    UNSEEDED = 678

    searchable = {"person", "place", "region"}
    unfindable = [
        document["id"]
        for document in nodes
        if document.get("type") in searchable
        and document.get("nameChunksLower")
        and "nodeGroupSize" not in stats_of(document)
    ]

    assert len(unfindable) <= UNSEEDED, (
        f"{len(unfindable)} nodes carry a name index but no "
        f"`stats.nodeGroupSize`, so no search for their name returns them - up "
        f"from the {UNSEEDED} known ones: {sample(unfindable)}"
    )


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


def test_every_article_has_a_publication_date(articles):
    """An article with no `publishedDate` is not in /zrodla at all.

    The page asks for its rows with `sortBy=publishedDate`, which reaches the
    paginated branch of `/api/nodes` and becomes a Firestore `orderBy
    publishedDate`. An `orderBy` does not return documents that lack the field
    - so an undated article is not sorted last, it is absent, for readers and
    editors alike. Nothing says so: the page renders, one row shorter.

    `ensureArticleNode` wrote `publishedDate: parseArticleDate(...)`, which is
    `undefined` whenever the scraped meta carried no date, and `undefined` is
    dropped on the way to Firestore rather than stored as a blank. `getPageMeta`
    reads only the *first* ld+json block on the page and no
    `article:published_time` meta tag at all, so on the outlets that lead with
    an Organization block that was every article they published.
    """
    # 185 of the 317 articles in the export of 2026-08-20, and the count was
    # still climbing - 184 on 2026-08-11 - because the ingest kept adding to it.
    # `ensureArticleNode` now falls back to the time the article was added, so
    # nothing new joins them, and
    # `frontend/scripts/migrate/backfill-article-dates.ts` re-reads the date off
    # each page to clear the ones already stored. This goes to zero when it has
    # been run against production.
    UNDATED = 185

    undated = [
        document["id"]
        for document in articles
        if not has_date(document, "publishedDate")
    ]

    assert len(undated) <= UNDATED, (
        f"{len(undated)} articles have no publishedDate and so appear nowhere "
        f"in /zrodla, up from the {UNDATED} the backfill knows about. "
        f"Sample IDs: {sample(undated)}"
    )


def test_every_article_says_where_it_came_from(articles):
    """`sourceURL` is the article's identity, not one of its details.

    `findArticleNodeId` is the only thing standing between the site and a second
    copy of every article: both ingest paths look the url up, exactly first and
    then normalized across every article node, and create one only when that
    misses. A node with no url matches neither query, so it can never be found
    again - the next person to paste that link gets a new node, and the notes,
    topics and `mentions` edges hanging off the old one stay on the copy nobody
    reaches. It is also what the title in the listing links out to.
    """
    # Five in the export of 2026-08-20, all of them among the 24 that were never
    # approved - they look like rows typed straight into the database rather
    # than anything /api/ingest/article wrote, since that path cannot run
    # without a url.
    URL_LESS = 5

    unsourced = [
        document["id"] for document in articles if not document.get("sourceURL")
    ]

    assert len(unsourced) <= URL_LESS, (
        f"{len(unsourced)} articles have no sourceURL, so nothing can find them "
        f"again and the next paste of that link makes a second copy - up from "
        f"the {URL_LESS} known ones. Sample IDs: {sample(unsourced)}"
    )


def test_every_article_has_an_approved_revision(articles):
    """An article node is published the moment it is created, or never.

    Articles are the one type with no review step: `ensureArticleNode` calls
    `createRevisionTransaction` with `approve: true, published: true`, so a
    normally ingested article has a `revision_id` and is live before anyone
    looks at it. One without a `revision_id` therefore did not come from the
    ingest, and nothing will ever approve it either - the admin queue lists
    nodes with pending revisions, and these have no revisions at all.

    They are stuck: `/api/nodes/publish` refuses to publish a node with no
    `revision_id`, which is the right rule and leaves no way out from the UI.
    """
    # 24 in the export of 2026-08-20, unchanged since 2026-08-11 - the ingest
    # does not add to this one. `backfill-article-dates.ts --publish` writes
    # them an approved revision and puts them live.
    UNAPPROVED = 24

    stuck = [document["id"] for document in articles if not document.get("revision_id")]

    assert len(stuck) <= UNAPPROVED, (
        f"{len(stuck)} articles have no approved revision, so they are invisible "
        f"and there is no way to approve them from the UI - up from the "
        f"{UNAPPROVED} known ones. Sample IDs: {sample(stuck)}"
    )


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


def test_a_company_can_be_told_apart_from_the_others(nodes):
    """No two companies go by the same name.

    Municipal companies are named after what they do and every town has one:
    24 are called "Przedsiębiorstwo Energetyki Cieplnej", and three separate
    registrations are all called exactly "Zakład Utylizacji Odpadów". Nothing
    is duplicated in the register - `test_companies_are_not_duplicated_by_krs`
    covers that - but on a person's page two of them are the same line twice,
    which is the "wypisany dwa razy" note on Marek Staniszewski.

    `display_name` puts the town in the name where the name does not already
    carry it, so this shrinks as companies are re-ingested.
    """
    # 393 on the 2026-07-28 export, 394 on the 2026-08-02 one. It climbs by
    # about a company a week until `display_name` is deployed and the affected
    # companies are re-ingested.
    KNOWN_SHARED_NAMES = 394

    counts = collections.Counter(
        (document.get("name") or "").strip().lower()
        for document in nodes
        if document.get("type") == "place" and (document.get("name") or "").strip()
    )
    shared = {name: count for name, count in counts.items() if count > 1}
    affected = sum(shared.values())

    assert affected <= KNOWN_SHARED_NAMES, (
        f"{affected} companies across {len(shared)} names cannot be told apart "
        f"from another company by name, up from the {KNOWN_SHARED_NAMES} known "
        f"ones: {sample(shared, 5)}"
    )


def test_every_company_is_published(nodes):
    """A company node is published, or nothing on the site can link to it.

    Unlike a person, a company is never somebody's unverified claim: the nodes
    come from the KRS ingest, out of the register, and the site treats them as
    reference data. Every path that reaches one assumes as much - a person's
    employer is rendered as a link on their page whether or not the company
    behind it is published, and `/instytucja/<slug>-<id>` then answers "Strona
    nieznaleziona" to a logged out reader.

    That asymmetry is deliberate for people, where an unpublished node is the
    invitation to log in and help review it. It is not deliberate here, and it
    is the reason `PKP Cargotabor` could be found in the search box and not on
    the page the hit led to.

    `page_is_public` rather than the raw flag, so a company retired through an
    approved removal is not reported as a hole - `deleted` is how a company
    stops having a page on purpose.
    """
    # 136 of 4024 companies on the export of 2026-08-26T02:00Z, which is what
    # scripts/migrate/publish-places.ts reports and publishes. Zero afterwards.
    UNPUBLISHED_COMPANIES = 136

    unpublished = [
        document["id"]
        for document in nodes
        if document.get("type") == "place" and not page_is_public(document)
    ]

    assert len(unpublished) <= UNPUBLISHED_COMPANIES, (
        f"{len(unpublished)} companies are not published, so every link to one "
        f"of them is a dead end for a logged out reader - up from the "
        f"{UNPUBLISHED_COMPANIES} the migration knows about: {sample(unpublished)}"
    )


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


def test_edge_stats_cover_every_edge_of_the_node(nodes, edges):
    """`stats.edges.all.targetNodeIds` is the index behind the table filters.

    The people table filters by company and by region through an
    `array-contains` on this field rather than by reading the edges, so a target
    missing from it means the person does not show up under a company they
    demonstrably work for.

    This was strict until 2026-08-02, on the grounds that the exports of
    2026-06-28 and 2026-07-28 both had every edge covered. They no longer do,
    and what the drift turned out to be is not lag: 36 of the 50 have no
    `stats` field whatever, and were created in mid-2025. computeNodes is not
    scheduled, so a node only ever gets stats if something else recomputes it -
    which is the open question the branch left rather than a new defect.
    """
    # `computeNodeStats` indexes an edge under both of its ends and then takes
    # the target of each, so a node that is only ever a target still lists
    # itself. Mirrored here rather than corrected: the point is to check the
    # stored index against the edges, not to redesign it.
    expected: dict[str, set[str]] = collections.defaultdict(set)
    for edge in edges:
        expected[edge["source"]].add(edge["target"])
        expected[edge["target"]].add(edge["target"])

    # 49 places and one person on the 2026-08-02 export. The 36 with no stats
    # at all are the ones `test_is_approved_matches_the_approved_revision`
    # counts; the other 14 have stats that predate an edge. Goes to zero once
    # /api/stats/computeNodes has covered them.
    UNCOMPUTED_NODES = 50

    incomplete = []
    for document in nodes:
        edge_stats = stats_of(document).get("edges") or {}
        stored = set((edge_stats.get("all") or {}).get("targetNodeIds") or [])
        missing = expected.get(document["id"], set()) - stored
        if missing:
            incomplete.append((document["id"], sample(missing, 3)))

    assert len(incomplete) <= UNCOMPUTED_NODES, (
        f"{len(incomplete)} nodes have edge targets missing from "
        f"stats.edges.all.targetNodeIds, so the table filters cannot find them, "
        f"up from the {UNCOMPUTED_NODES} known ones: {sample(incomplete, 5)}"
    )


# --------------------------------------------------------------------------- #
# edges                                                                        #
# --------------------------------------------------------------------------- #


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


def test_a_state_edge_is_not_stored_twice(edges):
    """A tie that either holds or does not may only be recorded once.

    `owns`, `mentions` and `comment` assert a relationship rather than an
    occurrence - a region seats a company, an article names a person - so the
    pair and the type are the whole of what they say and a second document adds
    nothing. This is the only edge duplication that can be judged from the
    stored data alone; see `test_occurrence_edges_may_repeat` for why the rest
    cannot. The rule this mirrors lives in `frontend/server/utils/edges.ts`.
    """
    # 64 region->company links written twice by one company ingest, before the
    # edge id was derived from the pair. Goes to zero once
    # scripts/migrate/dedupe-edges.ts has been run against production.
    DUPLICATED_STATE_EDGES = 64

    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") not in STATE_EDGE_TYPES:
            continue
        groups[(edge["source"], edge["target"], edge["type"])].append(edge["id"])

    duplicated = {key: ids for key, ids in groups.items() if len(ids) > 1}
    redundant = sum(len(ids) - 1 for ids in duplicated.values())
    by_type = collections.Counter(key[2] for key in duplicated)

    assert redundant <= DUPLICATED_STATE_EDGES, (
        f"{redundant} state edges duplicate another one across "
        f"{len(duplicated)} pairs ({dict(by_type)}), up from the "
        f"{DUPLICATED_STATE_EDGES} known ones. "
        f"Sample: {sample(list(duplicated.values()), 5)}"
    )


def test_nobody_stands_in_two_places_at_once(edges, nodes):
    """One person, one election, one constituency.

    Where that does not hold, the person is two people: `create_people_table`
    merges namesakes of the same age on purpose - somebody who filed once as
    "Donald Tusk" and once as "Donald Franciszek Tusk" is one man - and cannot
    tell that apart from two strangers who happen to share a name and a year of
    birth. Tomasz Wojciech Krasowski stands in Warszawa and in powiat sokólski
    in the same election, four elections running.

    A województwo that contains the powiat is not a second place: standing for
    the sejmik and for a local council in the same region is ordinary, and the
    two are recorded at different depths. Two kinds of election in one year are
    two contests - 2024 held both the local and the european ones - so the
    office has to match too.
    """
    # `drop_contradictory_candidacies` stops these being published; the stored
    # ones go once the affected people are re-ingested.
    KNOWN_CONTRADICTIONS = 135

    nodes_by_id = {node["id"]: node for node in nodes}
    regions: dict[tuple, set[str]] = collections.defaultdict(set)
    for edge in edges:
        if edge.get("type") != "election":
            continue
        teryt = nodes_by_id.get(edge["target"], {}).get("teryt")
        if not teryt:
            continue
        key = (edge["source"], str(edge.get("start_date"))[:4], edge.get("position"))
        regions[key].add(teryt)

    def contradict(teryts: set[str]) -> bool:
        ordered = sorted(teryts)
        return any(
            not (a.startswith(b) or b.startswith(a))
            for i, a in enumerate(ordered)
            for b in ordered[i + 1 :]
        )

    contradictory = {
        key: teryts for key, teryts in regions.items() if contradict(teryts)
    }

    assert len(contradictory) <= KNOWN_CONTRADICTIONS, (
        f"{len(contradictory)} candidacies put one person in two constituencies "
        f"in the same election, up from the {KNOWN_CONTRADICTIONS} known ones, "
        f"so the person is two people: "
        f"{sample(list(contradictory.items()), 5)}"
    )


def test_occurrence_edges_may_repeat(edges):
    """Two identical `election` or `employed` edges are not a defect to fix.

    They are how the database says a person stood twice or was employed twice,
    and for `election` the fields that would tell two candidacies apart are
    destroyed before the ingest sees them: the office collapses into the
    "Samorząd" bucket, the gmina TERYT is truncated to its powiat, `committee`
    is dropped at the API boundary, and the run-off round is discarded by the
    scraper. Standing for burmistrz and for that town's rada in 2024 is stored
    as two byte-identical documents - and so is one mayoral bid that went to a
    second round.

    So this test asserts nothing about how many there are. What it does check is
    that the *reason* they cannot be judged still holds: if a duplicated
    candidacy ever turns up for an office nobody can stand for twice - Sejm,
    Senat, the European Parliament - then the repeats are a write bug after all
    and the whole question is worth reopening.
    """
    single_seat = {"Sejm", "Senat", "Parlament Europejski"}

    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "election":
            continue
        if edge.get("position") not in single_seat:
            continue
        groups[
            (
                edge["source"],
                edge["target"],
                edge.get("position"),
                edge.get("start_date"),
            )
        ].append(edge["id"])

    duplicated = {key: ids for key, ids in groups.items() if len(ids) > 1}

    assert not duplicated, (
        f"{len(duplicated)} candidacies are recorded twice for an office that "
        f"can only be stood for once, so the repeats are not two real "
        f"candidacies after all: {sample(list(duplicated.items()), 5)}"
    )


def test_one_spell_of_employment_is_stored_once(edges):
    """A person may hold the same role at the same company twice - not at once.

    Unlike a candidacy, an employment carries the fields that tell two spells
    apart, and `EDGE_SEMANTICS` in `frontend/server/utils/edges.ts` names them:
    the role and the day it began. `end_date` is deliberately not one of them,
    because it is learned after the fact - so one spell recorded twice, once
    while it was still open and once since closed, is one spell and not two.

    That is exactly the shape the pipeline used to produce. Every crawl of a
    company was kept in the bucket and every one of them was read, so a board
    seat held across four crawls arrived four times, disagreeing with itself
    about whether it had ended. `extract_people` now keeps only the last crawl
    of each query, and the ingest refuses the duplicate even if one is offered.
    """
    # Written before either guard existed. Goes to zero once
    # scripts/migrate/dedupe-edges.ts has been run against production.
    #
    # 205 on the 2026-07-28 export, 211 on the 2026-08-02 one: neither guard is
    # deployed yet, so the nightly run still adds about one a day and this
    # number is a measurement rather than a ceiling.
    DUPLICATED_SPELLS = 211

    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "employed":
            continue
        groups[
            (
                edge["source"],
                edge["target"],
                edge.get("name"),
                edge.get("start_date"),
            )
        ].append(edge["id"])

    duplicated = {key: ids for key, ids in groups.items() if len(ids) > 1}
    redundant = sum(len(ids) - 1 for ids in duplicated.values())

    assert redundant <= DUPLICATED_SPELLS, (
        f"{redundant} employment edges repeat a spell already stored across "
        f"{len(duplicated)} (person, company, role, start) groups, up from the "
        f"{DUPLICATED_SPELLS} known ones. "
        f"Sample: {sample(list(duplicated.values()), 5)}"
    )


def test_employment_says_what_the_person_did(edges):
    """Every `employed` edge carries a role.

    The role is half of what tells two spells apart - `EDGE_SEMANTICS` keys an
    employment on the pair, the role and the start - so an edge without one
    cannot be distinguished from any other spell at that company, and the site
    has nothing to print next to it but the company's name.

    They came from the kinds of rejestr.io connection that are not employment:
    an owner, a beneficial owner, a receiver appointed by a court. Those used
    to be published as jobs with no role, dated to whenever the registration
    was recorded - so Tadeusz Krupiński, who left the board of ESV9 on
    2026-06-19 and became its prokurent the same day, appeared to have *joined*
    ESV9 that day. `KRS_RELATION_ROLES` now decides which connections are posts
    and what each one is called.
    """
    # Written before KRS_RELATION_ROLES existed. 240 on the 2026-07-28 export,
    # 246 on the 2026-08-02 one - the table decides nothing until it ships, so
    # every nightly run still writes a few more.
    KNOWN_ROLELESS = 246

    roleless = [
        edge["id"]
        for edge in edges
        if edge.get("type") == "employed" and not edge.get("name")
    ]

    assert len(roleless) <= KNOWN_ROLELESS, (
        f"{len(roleless)} employment edges say nothing about what the person "
        f"did, up from the {KNOWN_ROLELESS} known ones: {sample(roleless)}"
    )


@pytest.mark.parametrize("edge_type", DATED_EDGE_TYPES)
def test_a_dated_edge_says_when_it_began(edges, edge_type):
    """An edge that records a period has to say when the period started.

    Nothing raises when it does not. `calculateExperience` skips an interval it
    cannot place, so the person shows less experience than they have rather than
    an error; `EDGE_SEMANTICS` keys an employment on the role *and* the start, so
    an undated spell is indistinguishable from every other spell at that company
    - which is also why `findEdges` narrows in memory, since a Firestore filter
    on `start_date` matches no document that is missing it. Until the duration
    chip learned to print "?", the history card rendered "undefined - obecnie".

    The two types fail differently, which is why the budgets differ. A candidacy
    without a date is a candidacy with no election: the ingest derives the field
    from the election year (`${election.election_year}-01-01`), so it cannot
    write one without it, and no export has ever held one. An employment can be
    entered by hand, where the date field is optional.
    """
    # 195 employment edges on the 2026-08-03 export. Nearly all of them are old:
    # 183 in December 2025, when 183 was *every* employment stored, and still 184
    # in June 2026 after the KRS import had taken the collection past 11,000 -
    # that importer always sets a start date. The 11 added since are hand edits,
    # and 185 of the 195 carry a revision_id, so the editor is where they come
    # from. The other 10 came from an ingest and are all unpublished.
    #
    # It is a budget rather than a ceiling: the article-extraction path has no
    # date field at all - none of the 244 employment extractions carries one -
    # so every fact promoted from a review lands here until it gains one.
    UNDATED = {"employed": 195, "election": 0}

    undated = [
        edge["id"]
        for edge in edges
        if edge.get("type") == edge_type and not has_date(edge, "start_date")
    ]
    budget = UNDATED[edge_type]

    assert len(undated) <= budget, (
        f"{len(undated)} {edge_type} edges do not say when they began, so they "
        f"count for no experience and cannot be told from another spell - up "
        f"from the {budget} known ones. Sample IDs: {sample(undated)}"
    )


def test_an_edge_that_ends_has_a_beginning(edges):
    """An `end_date` with no `start_date` is an interval nothing can place.

    `calculateExperience` reads a missing end as "still going" and a missing
    start as no interval at all, so an edge with only an end contributes nothing
    while reading, on the page, as a job that finished. There are none, on any
    export read so far and across all eight stored edge types, so this is stated
    strictly rather than budgeted: the writers that fill in an end always know
    the start, and one that does not would be a new defect.
    """
    dangling = [
        (edge["id"], edge.get("type"), edge["end_date"])
        for edge in edges
        if has_date(edge, "end_date") and not has_date(edge, "start_date")
    ]

    assert not dangling, (
        f"{len(dangling)} edges record an end but no beginning, as "
        f"(edge, type, end_date): {sample(dangling)}"
    )


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


def test_every_revision_says_whether_a_person_made_it(revisions):
    """`update_automatic` has to be on every revision, not only the true ones.

    The flag separates what the pipelines file from what a person proposed, and
    it was written *only when true* until 2026-08-21. Firestore matches no
    filter against a field a document does not have, so while any revision is
    missing it, "show me human work" cannot be a `where` and every reader has to
    pull the collection and filter `!== true` in memory - /api/revisions/queue,
    /api/revisions/mine and /api/admin/summary all say so in their comments.

    That is not only slow, it is wrong at the edges. `collectActivityEvents`
    caps each scan at 20,000 documents and marks the kind truncated when it hits
    that, *before* the in-memory filter runs, so a day the ingest was busy on
    reads as capped however little of it was human: 2026-08-29 held 23,532
    revisions, 92 by a person, and /eksploruj/statystyki has shown "za duzo
    zdarzen w tym okresie" for every window containing it ever since.
    """
    # 1768 revisions written before the flag was, in the export of
    # 2026-08-31T02:00Z. `createRevisionTransaction` and `createProposalInBatch`
    # in server/utils/revisions.ts now write it whichever way it goes, so this
    # can only shrink; frontend/scripts/migrate/backfill-revision-automatic.ts
    # takes it to zero.
    FLAGLESS_REVISIONS = 0

    flagless = [
        revision["id"]
        for revision in revisions
        if not isinstance(revision.get("update_automatic"), bool)
    ]

    assert len(flagless) <= FLAGLESS_REVISIONS, (
        f"{len(flagless)} revisions do not say whether a person or a pipeline "
        f"made them, up from the {FLAGLESS_REVISIONS} written before the field "
        f"existed - so something is writing a revision without the flag again. "
        f"Sample IDs: {sample(flagless)}"
    )


# --------------------------------------------------------------------------- #
# notes                                                                        #
# --------------------------------------------------------------------------- #


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
