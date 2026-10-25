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
the budget: for the first `BUDGET_BUFFER` (ten) past it the test passes with a
warning, which the night reports, and beyond that it fails (`within_budget` in
conftest.py).

Reading the export needs credentials and a download, so the whole file is
marked ``e2e`` and deselected by default. Run it with::

    .venv/bin/pytest -m e2e src/tests/pipelines/test_invariants.py
"""

import collections
import datetime
import re
import unicodedata
import urllib.parse
import zoneinfo

import pytest

from analysis.payloads.site import (
    DISTRICT_OFFICES,
    ELECTION_YEARS,
    edge_relation,
    election_kind,
    field,
    register_entry,
)
from scrapers.koryta.snapshot import is_reference, reference_id
from scrapers.wiki.shareholders import normalize_title
from util.polish import format_person_name, names_agree

#: Every test here reads the production export rather than a fixture, which is
#: what `e2e` marks: a test that needs state this repository does not carry.
pytestmark = pytest.mark.e2e

# Node and edge types the frontend knows how to render, from `shared/model.ts`.
# `topic` is the newest and the reason `nodeTypes` there is a tuple the zod
# enums derive from: four handlers had written the list out by hand and none of
# them was found by the compiler when it was added. `seat` (a company's
# registered seat, split out of `owns` on 2026-08-29) and `tagged` (article ->
# topic) joined `edgeTypes` there without joining this list, so every seat the
# company ingest wrote read as an unknown type: 5,452 of them on 2026-10-08.
NODE_TYPES = {"person", "place", "article", "region", "topic"}
EDGE_TYPES = {
    "employed",
    "connection",
    "mentions",
    "owns",
    "seat",
    "comment",
    "election",
    "tagged",
}

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
    "seat": {("region", "place")},
    "tagged": {("article", "topic")},
}

# Edge types that assert a relationship rather than an occurrence: the pair and
# the type are the whole of what they say, so there is nothing to count and a
# second document is always redundant. `employed` and `election` are the other
# kind - one bounded episode, which can legitimately repeat between the same two
# nodes. Kept in step with EDGE_SEMANTICS in `frontend/server/utils/edges.ts`,
# which has classed `seat` as one since the 2026-08-29 split took it out of
# `owns`, a while before this list learned it.
STATE_EDGE_TYPES = {"owns", "seat", "mentions", "comment", "source"}

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

# `VoteCategory` in `shared/model.ts`. `wrongPerson` - "To nie ta osoba", a
# reader saying an extracted fact was matched to a namesake - joined it on
# 2026-08-25 without joining this list, and its five votes read as a typo.
VOTE_CATEGORIES = {"interesting", "quality", "correct", "insufficient", "wrongPerson"}

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


def is_removed(document: dict) -> bool:
    """Whether the document was taken down by an approved removal.

    A removal is a soft delete: the document stays in its collection with
    `deleted: true` and every reader on the site skips it. So a broken document
    somebody removed is the repair of a defect rather than one more of them,
    and the checks that count defects leave it out - or removing a duplicate as
    „duplikat” reads as a new duplicate the night it happens.
    """
    return document.get("deleted") is True


def election_stood_in(edge: dict) -> str | None:
    """Which kind of election a candidacy was stood in: "parliament",
    "european" or "local", or None where nothing stored says.

    A named office says, by `election_kind`: the Sejm and the Senat are filled
    in one parliamentary election, and every other office, „Samorząd”
    included, in a local one. A candidacy with no office says only through its
    year, and only in a year that held one kind of election - which is how
    `isSameRun` in frontend/server/utils/edges.ts reads one. A 2005 candidacy
    without an office is that year's Sejm or Senat run; a 2024 one could be the
    local or the european one, and is None.
    """
    office = field(edge, "position")
    if office is not None:
        return election_kind(office)
    year = str(edge.get("start_date"))[:4]
    held = [kind for kind, years in ELECTION_YEARS.items() if year in years]
    return held[0] if len(held) == 1 else None


def timestamp_key(value) -> str:
    """A stored timestamp as text that sorts in time order.

    The export hands back Firestore timestamps as datetimes; a stamp somebody
    wrote as text instead is brought to the same shape, so the two compare.
    """
    if isinstance(value, datetime.datetime):
        return value.replace(tzinfo=None).isoformat()
    return str(value or "").replace("Z", "").replace(" ", "T")


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
    if is_removed(document):
        return False
    return document.get("published") is True


def is_merged_away(document: dict) -> bool:
    """Whether the page was merged into another one.

    `server/utils/merge.ts` keeps the duplicate's document, so its url still
    resolves and its votes and revisions still hang off something, and marks it
    `merged_into: <survivor>` beside `deleted: true`. Asked on its own rather
    than through `is_removed`, since a page that says it lives elsewhere is not
    a page whatever its `deleted` says.
    """
    value = document.get("merged_into")
    return isinstance(value, str) and bool(value.strip())


def is_live(document: dict) -> bool:
    """Whether a document is still one of the site's own: neither removed nor
    merged away."""
    return not is_removed(document) and not is_merged_away(document)


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


def stale_aggregates(
    documents: dict[str, dict],
    votes_by_target: dict[str, list],
    predates: frozenset[str] = frozenset(),
):
    """Targets whose stored `stats.votes` disagrees with the votes cast on them.

    `predates` names counters an aggregate may lack because it was last written
    before the site learned to keep them. A missing one is not a difference; one
    that is there and wrong still is.
    """
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
            if key in predates and key not in stored:
                continue
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
def entered_by_hand(revisions) -> set[str]:
    """The documents a person created through the site rather than an ingest.

    Told by the document's first revision, since `update_automatic` is on every
    one (`test_every_revision_says_whether_a_person_made_it`). The December 2025
    backfill that minted a revision for every document without one marked them
    as a person's, which they were: every employment stored then had been
    typed in. A document with no revision at all is not counted as a person's,
    so nothing goes unchecked for want of a history.
    """
    first: dict[str, dict] = {}
    for revision in revisions:
        document_id = reference_id(revision.get("node_id"))
        if not document_id:
            continue
        held = first.get(document_id)
        if held is None or timestamp_key(revision.get("update_time")) < timestamp_key(
            held.get("update_time")
        ):
            first[document_id] = revision
    return {
        document_id
        for document_id, revision in first.items()
        if revision.get("update_automatic") is False
    }


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
def live_people(nodes) -> list[dict]:
    """The person pages that are still pages: neither removed nor merged away.

    A tombstone keeps every field it had, its `rejestrIo` and `wikipedia`
    among them, so a check of who is filed where that read it would count every
    merge as one person on two pages.
    """
    return [
        document
        for document in nodes
        if document.get("type") == "person" and is_live(document)
    ]


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
    # `humanCount` is on every fact voted on since the trigger learned it in
    # September, and on none voted on before: 646 of the 757 on 2026-10-09, last
    # voted on in July and August. backfill-vote-human-count.ts recomputed nodes
    # only, and the site knows - `factVoterCount` falls back to `humanVoted` for
    # an aggregate without one. So a fact lacking the counter is an old one, not
    # a stale one; a fact whose counter is wrong still fails.
    stale = stale_aggregates(
        by_id, votes_by_extraction, predates=frozenset({"humanCount"})
    )

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


def test_every_vote_names_the_document_it_is_about(votes, within_budget):
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

    assert within_budget(len(untargeted), LEGACY_VOTES), (
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


def test_is_approved_matches_whether_the_page_is_public(nodes):
    """`stats.isApproved` is a copy of `pageIsPublic` and must stay one.

    The two are read in different places - `isApproved` by every listing
    (`/api/nodes` filters on it) and by the tagging-progress counters,
    `pageIsPublic` by whatever decides whether a logged out visitor sees the
    page at all - so if they disagree the site contradicts itself: a live page
    missing from every list that leads to it, or a listed one that answers
    "Strona nieznaleziona".

    It used to be a copy of `!!revision_id`, back when an approved revision was
    what made a page public, and this test said so until 2026-10-09. Since
    `published` became the flag, the `onNodeWritten` trigger and
    `withSeededNodeStats` both write `pageIsPublic`, and the old rule failed on
    1,082 nodes that agree with the new one: 984 seeded regions, public with no
    revision, and 98 unpublished people whose import revision was applied.
    """
    mismatched = [
        document["id"]
        for document in nodes
        if page_is_public(document) != (stats_of(document).get("isApproved") is True)
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


def test_a_node_with_a_name_index_can_be_searched_for(nodes, within_budget):
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
    # None on the export of 2026-10-25T03:00Z. There were 678 on 2026-08-23
    # (474 people and 204 companies) until backfill-node-group-size.ts was run
    # against production, and the seeding in `withSeededNodeStats` keeps new
    # nodes out. Articles are not searched and so are not counted here.
    UNSEEDED = 0

    searchable = {"person", "place", "region"}
    unfindable = [
        document["id"]
        for document in nodes
        if document.get("type") in searchable
        and document.get("nameChunksLower")
        and "nodeGroupSize" not in stats_of(document)
    ]

    assert within_budget(len(unfindable), UNSEEDED), (
        f"{len(unfindable)} nodes carry a name index but no "
        f"`stats.nodeGroupSize`, so no search for their name returns them - up "
        f"from the {UNSEEDED} known ones: {sample(unfindable)}"
    )


@pytest.mark.parametrize("collection", ["nodes", "edges"])
def test_revision_id_points_at_the_documents_own_revision(
    snapshot, collection, within_budget
):
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
    assert within_budget(len(wrong), budget), (
        f"{len(wrong)} {collection} have a revision_id that is not a revision "
        f"of that document, up from the {budget} known seeded regions. "
        f"Sample (document, revision_id): {sample(wrong)}"
    )


#: Fields a document owns rather than states, so no revision of it carries them:
#: `INTERNAL_FIELDS` in `frontend/server/utils/revisions.ts`, plus `stored_id`,
#: which is where `read_collection` keeps a document's own `id` field. The drop
#: check (`test_a_later_revision_never_drops_a_field`) keeps a narrower set.
INTERNAL_FIELDS = {
    "stats",
    "revision_id",
    "published",
    "revisions",
    "votes",
    "id",
    "stored_id",
    "deleted",
    "delete_reason",
    "visibility",
    "merged_into",
    "needs_split",
    "nameChunksLower",
    "content_changed_at",
}


def same_stored_value(a, b) -> bool:
    """Whether two stored values say the same thing.

    A port of `sameStoredValue` in `frontend/server/utils/revisions.ts`, which
    `holdsRevision` asks: a reference is the document it names, a timestamp
    its instant, an array its items in order and a map its keys. A boolean is
    not the number it equals in Python, as `===` keeps them apart there.
    """
    if is_reference(a) or is_reference(b):
        return (
            is_reference(a) and is_reference(b) and reference_id(a) == reference_id(b)
        )
    if isinstance(a, list) or isinstance(b, list):
        return (
            isinstance(a, list)
            and isinstance(b, list)
            and len(a) == len(b)
            and all(same_stored_value(x, y) for x, y in zip(a, b))
        )
    if isinstance(a, dict) or isinstance(b, dict):
        return (
            isinstance(a, dict)
            and isinstance(b, dict)
            and a.keys() == b.keys()
            and all(same_stored_value(a[key], b[key]) for key in a)
        )
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    return a == b


def test_publishing_an_edge_approves_only_what_the_edge_says(
    edges, revisions, within_budget
):
    """An edge revision marked approved is one the edge holds, or held.

    Approving a revision is `applyRevision` writing it over the document, so
    "approved" is the history's word for "this is what the page said". Until
    prod took a73fb7c2 on 2026-10-10, publishing a draft edge broke that:
    `publishEdgeInBatch` pointed the edge at its newest revision and stamped it
    approved, writing only `published` and `revision_id`, and the newest was
    often a `proposal_` one, which the edge never held. So a committee or a
    correction somebody proposed reads in the history as accepted and is on no
    page, and nothing will offer it to a reviewer again: the queue lists what
    is pending.

    So every approved edge proposal must say what its edge says, bar the
    fields the edge owns and its two ends, which a merge moves without a
    revision. One the edge has moved on from since is not counted: a revision
    applied after its approval explains the difference.

    The drop check reads these as never applied (`approved_by_publishing`),
    and keeps doing so until
    scripts/migrate/repair-unapplied-proposal-approvals.ts has run on prod.
    """
    # 21 on the 2026-10-25T03:00:33.098Z export, 21 on the 10-24 one: the 23
    # edge proposals publishing marked approved between 2026-08-29 and 10-09,
    # bar Gm2XbS1oTAmdH7GP1yEi, removed as a duplicate on 08-30, and
    # WQ6rgpfnBmCxk3GdUEpw, which the night of 10-10 wrote to. Every one lacks
    # its proposal's `committee`; 20 were filed by an upload, and one,
    # hXj75PkY7O5jf4RI8qSP, is a contributor's correction of one of Michał
    # Rado's candidacies. Nothing can add to them since the fix, so this only
    # goes down, and to zero once
    # scripts/migrate/repair-unapplied-proposal-approvals.ts has put them back
    # in the queue.
    UNAPPLIED_APPROVALS = 21

    edges_by_id = {edge["id"]: edge for edge in edges}
    by_document: dict[str, list[dict]] = collections.defaultdict(list)
    for revision in revisions:
        by_document[reference_id(revision.get("node_id")) or ""].append(revision)

    def stated(document: dict) -> dict:
        return {
            field: value
            for field, value in document.items()
            if field not in INTERNAL_FIELDS and field not in ("source", "target")
        }

    unapplied = []
    for revision in revisions:
        if (
            revision.get("collection") != "edges"
            or revision.get("status") != "approved"
            or not str(revision.get("id", "")).startswith("proposal_")
        ):
            continue
        edge = edges_by_id.get(reference_id(revision.get("node_id")) or "")
        if edge is None:
            continue  # test_every_revision_belongs_to_a_document covers it
        proposed, stored = stated(revision.get("data") or {}), stated(edge)
        if same_stored_value(proposed, stored):
            continue
        approved_at = timestamp_key(revision.get("review_time"))
        # applied and applied_at are the revision checks', defined with them.
        if any(
            other["id"] != revision["id"]
            and applied(other)
            and applied_at(other) > approved_at
            for other in by_document[edge["id"]]
        ):
            continue
        differing = sorted(
            field
            for field in set(proposed) | set(stored)
            if field not in proposed
            or field not in stored
            or not same_stored_value(proposed[field], stored[field])
        )
        unapplied.append((edge["id"], revision["id"], approved_at[:10], differing))

    assert within_budget(len(unapplied), UNAPPLIED_APPROVALS), (
        f"{len(unapplied)} edge proposals are marked approved and are not what "
        f"their edge says, with nothing applied to the edge since, up from the "
        f"{UNAPPLIED_APPROVALS} publishing approved before a73fb7c2. As (edge, "
        f"revision, approved on, fields that differ): {sample(unapplied, 5)}"
    )


def test_node_types_are_known(nodes, within_budget):
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

    assert within_budget(len(unknown), LEGACY_BLOBS), (
        f"{len(unknown)} nodes have a type the frontend does not render "
        f"({dict(by_type)}), up from the {LEGACY_BLOBS} known legacy blobs. "
        f"Sample IDs: {sample(unknown)}"
    )


def test_every_node_has_a_name(nodes, within_budget):
    """`name` is what search indexes and what every listing shows."""
    # The same 233 legacy blobs, which hold `text` or `url` instead, plus six
    # article nodes created from a url whose title could not be read.
    NAMELESS = 239

    nameless = [document["id"] for document in nodes if not document.get("name")]
    by_type = collections.Counter(
        document.get("type") for document in nodes if not document.get("name")
    )

    assert within_budget(len(nameless), NAMELESS), (
        f"{len(nameless)} nodes have no name ({dict(by_type)}), up from the "
        f"{NAMELESS} known ones. Sample IDs: {sample(nameless)}"
    )


def test_every_article_has_a_publication_date(articles, within_budget):
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
    # 66 of the 830 articles on the export of 2026-10-25T03:00Z, the same 66 as
    # on 2026-10-24, all of them published. There were 185 on 2026-08-20, before
    # `backfill-article-dates.ts` re-read the date off each page on 2026-08-22;
    # these are the pages it found no date on.
    # `ensureArticleNode` now falls back to the time the article was added, so
    # nothing new joins them, and this only falls.
    UNDATED = 66

    undated = [
        document["id"]
        for document in articles
        if not has_date(document, "publishedDate")
    ]

    assert within_budget(len(undated), UNDATED), (
        f"{len(undated)} articles have no publishedDate and so appear nowhere "
        f"in /zrodla, up from the {UNDATED} known ones. "
        f"Sample IDs: {sample(undated)}"
    )


def test_every_article_says_where_it_came_from(articles, within_budget):
    """`sourceURL` is the article's identity, not one of its details.

    `findArticleNodeId` is the only thing standing between the site and a second
    copy of every article: both ingest paths look the url up, exactly first and
    then normalized across every article node, and create one only when that
    misses. A node with no url matches neither query, so it can never be found
    again - the next person to paste that link gets a new node, and the notes,
    topics and `mentions` edges hanging off the old one stay on the copy nobody
    reaches. It is also what the title in the listing links out to.
    """
    # Five in the export of 2026-08-20, all of them among the 24 that were not
    # approved until 2026-08-22 - they look like rows typed straight into the
    # database rather than anything /api/ingest/article wrote, since that path
    # cannot run without a url.
    URL_LESS = 5

    unsourced = [
        document["id"] for document in articles if not document.get("sourceURL")
    ]

    assert within_budget(len(unsourced), URL_LESS), (
        f"{len(unsourced)} articles have no sourceURL, so nothing can find them "
        f"again and the next paste of that link makes a second copy - up from "
        f"the {URL_LESS} known ones. Sample IDs: {sample(unsourced)}"
    )


def test_every_article_has_an_approved_revision(articles, within_budget):
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
    # None on the export of 2026-10-25T03:00Z. There were 24 on 2026-08-20,
    # until `backfill-article-dates.ts --publish` wrote them an approved
    # revision on 2026-08-22, and the ingest does not add to this one.
    UNAPPROVED = 0

    stuck = [document["id"] for document in articles if not document.get("revision_id")]

    assert within_budget(len(stuck), UNAPPROVED), (
        f"{len(stuck)} articles have no approved revision, so they are invisible "
        f"and there is no way to approve them from the UI - up from the "
        f"{UNAPPROVED} known ones. Sample IDs: {sample(stuck)}"
    )


def test_person_names_are_capitalised(nodes, within_budget):
    """A person node is named the way the site shows a name, not the way a
    register recorded it.

    `PeoplePayloads` used to pass whichever of its name columns was filled
    straight through, and those columns disagree on case - the PKW-merged one
    shouts the surname by convention, and some of what the company register
    returns is in full capitals - so "MAŁGORZATA GRADZIUK" got a page next to
    the properly capitalised namesakes she shares a listing with. Nothing fails
    on it: the name is only ever displayed, and `nameChunksLower` is lowercased
    before it is indexed, so search still finds her. It just reads as shouting.

    Only shouting is asked about, because only shouting is unambiguous. Three
    further names read oddly - one typed flat (`jerzy hardie-douglas`), one
    whose elided article stayed lowercase (`D'obyrn`) and one that kept the
    whitespace it was created with - and all three are left to whoever typed
    them, exactly as `format_person_name` leaves them.

    Only person nodes are asked. A company is named as the register names it and
    "PKP CARGO S.A." is its own spelling, not a mistake.
    """
    # The people uploaded in full capitals before `format_person_name` was added
    # to the pipeline on 2026-09-12. This said five, all unpublished, and that
    # the next ingest would rename them. It does not: the ingest only ever
    # replaces a stored name with one that adds middle names or a surname's
    # hyphen to it (`learnsName`), so a stored spelling in capitals stays. Counted on
    # 2026-10-09 there are 30 live, every one created by an upload between
    # 08-18 and 09-10 and none since; one is published (Małgorzata Stępień).
    # Renaming them is a one-off migration, and then this goes to zero.
    MISFORMATTED = 30

    misformatted = [
        (document["id"], document["name"])
        for document in nodes
        if document.get("type") == "person"
        and not is_removed(document)
        and isinstance(document.get("name"), str)
        and document["name"].strip()
        and format_person_name(document["name"]) != document["name"]
    ]

    assert within_budget(len(misformatted), MISFORMATTED), (
        f"{len(misformatted)} person nodes are not named in the capitalised form "
        f"the pipeline writes, up from the {MISFORMATTED} known ones. "
        f"Sample: {sample(misformatted)}"
    )


def test_a_register_entry_has_one_page(nodes, within_budget):
    """One rejestr.io entry, one person page.

    An entry is one person - a namesake has an entry of their own - so two
    pages linking the same entry are one person filed twice, and the night
    cannot tell which of them to write to. `koryta_match` in analysis/people.py
    refuses an entry that two pages claim, so its payload carries no page id,
    and the ingest then lands on whichever page
    `where("rejestrIo", "==", link).limit(1)` returns. The register's jobs and
    candidacies go on arriving at one of the two, and the other keeps what it
    had.

    Pages are grouped by the entry's number, the way `registerEntry` in
    `person.post.ts` reads a link (`register_entry` here), not by the link as
    stored. 18 live pages of the 2026-10-25 export keep a link pasted from a
    browser, with the person's name after the number. The exact lookup misses
    such a page, which matters where no `korytaId` carries the payload to it
    instead: beside a twin, where `koryta_match` refuses the entry. It is why
    Beata Szydło's published page gets nothing while the night writes into her
    draft twin.

    A page merged away is left out: `lookupNodeDoc` follows its `merged_into`
    to the survivor, so merging one of two pages into the other is the repair.
    A removed page is counted, since the same lookup does not skip it, and a
    removed page beside a live one can still take the night's writes.
    """
    # 4 on the 2026-10-25T03:00:33.098Z export, as on the 10-14, 10-15, 10-23
    # and 10-24 ones, all made between 05-11 and 09-10, before the ingest and
    # the planner read a link by its number. None of them is a removed page:
    # - 1353470 Beata Szydło: the published IGdabqsPzTIfvEcoyyuZ stores the
    #   slugged link, so the night writes into the draft YiQRzcVwcbwPsf6Zy4dU.
    # - 1012219 Krzysztof Piotr Wojciechowski: the draft exMqDvCfDxrMY1S4ZZHQ
    #   beside the published IjpbUfURDSHkA3UhfOhF.
    # - 2732239 Łukasz Kenig: two drafts, 7HGps3vupBSxiyDNoU4f with the
    #   slugged link and mEYLagiXKzVevXUznKJj.
    # - 748966 Łukasz Grabowski: the draft RAD8Oh25J2omGaU76X2i beside the
    #   published BAfWPA4edipeM8mUIMWY.
    # Merging each pair takes this to zero; nothing should add to it.
    SHARED_ENTRIES = 4

    pages: dict[str, list[str]] = collections.defaultdict(list)
    for document in nodes:
        if document.get("type") != "person" or is_merged_away(document):
            continue
        link = document.get("rejestrIo")
        entry = register_entry(link.strip() if isinstance(link, str) else None)
        if entry:
            pages[entry].append(document["id"])
    shared = {entry: ids for entry, ids in pages.items() if len(ids) > 1}

    assert within_budget(len(shared), SHARED_ENTRIES), (
        f"{len(shared)} rejestr.io entries are linked by more than one person "
        f"page not merged away, up from the {SHARED_ENTRIES} known ones, so "
        f"the night writes each of them to one page only, as (entry, pages): "
        f"{sample(sorted(shared.items()))}"
    )


def wikipedia_article(link) -> tuple[str, str] | None:
    """The article a stored Wikipedia link names, as (wiki, title), or None.

    One article has many addresses, and pages store all of them: a link pasted
    from a browser is percent-encoded („Beata_Szyd%C5%82o”) where the pipeline
    writes the letters (`article_url`), a phone gives the `pl.m.` host, and a
    section, a query or a trailing slash does not make another article. Neither
    does the scheme, or a link written without one. The title is read the way
    MediaWiki resolves it (`normalize_title`): an underscore is a space and the
    first letter's case does not count. A redirect is not followed, so two
    titles of one article still read as two.

    None for a link that names no article by its title: another site, an
    `index.php` address by page or revision number, or a bare `/wiki/`.
    """
    if not isinstance(link, str) or not link.strip():
        return None
    text = link.strip()
    if "//" not in text:
        text = "//" + text
    parts = urllib.parse.urlsplit(text)
    wiki = parts.netloc.lower().replace(".m.wikipedia.", ".wikipedia.")
    if not wiki.endswith(".wikipedia.org"):
        return None
    path = urllib.parse.unquote(parts.path)
    if path.startswith("/wiki/"):
        raw = path.removeprefix("/wiki/").rstrip("/")
    else:
        raw = urllib.parse.parse_qs(parts.query).get("title", [""])[0]
    title = normalize_title(unicodedata.normalize("NFC", raw))
    return (wiki, title) if title else None


def test_a_biography_belongs_to_one_page(live_people, within_budget):
    """One Wikipedia article, one person page.

    A biography is about one person, so two live pages linking the same
    article are either one person filed twice - the case
    `test_a_register_entry_has_one_page` catches when both pages also link the
    register - or two people of whom one carries the other's biography, which
    the page shows as its own. Either way a reader of one of the two pages is
    told something about the wrong person, or not told it at all.

    Links are compared as the article they name (`wikipedia_article`), not as
    stored. A merged-away page keeps its link, so only live pages count.

    It cannot see a page that links a namesake's article no other page links:
    one page per article is all this asks.
    """
    # 2 on the 2026-10-25T03:00:33.098Z export, as on the 10-14, 10-15, 10-23
    # and 10-24 ones. Every link on it is https://pl.wikipedia.org/wiki/<title>:
    # - Józef_Pilch on two published pages for two register entries born in
    #   different months, 135yGE2ykTSkgphVaBiM (2199291) and
    #   RjGHK4cve38bskqQNOXE (2140078), left by the 2026-08-29 hand split: one
    #   of the two links the other's biography.
    # - Beata_Szydło on IGdabqsPzTIfvEcoyyuZ and YiQRzcVwcbwPsf6Zy4dU, the pair
    #   that also shares entry 1353470.
    # Unlinking Pilch's wrong page and merging Szydło's take this to zero.
    SHARED_BIOGRAPHIES = 2

    pages: dict[tuple[str, str], list[str]] = collections.defaultdict(list)
    for document in live_people:
        article = wikipedia_article(document.get("wikipedia"))
        if article:
            pages[article].append(document["id"])
    shared = {article: ids for article, ids in pages.items() if len(ids) > 1}

    assert within_budget(len(shared), SHARED_BIOGRAPHIES), (
        f"{len(shared)} Wikipedia articles are linked by more than one live "
        f"person page, up from the {SHARED_BIOGRAPHIES} known ones, as "
        f"((wiki, title), pages): {sample(sorted(shared.items()))}"
    )


def test_array_fields_are_stored_as_arrays(nodes, within_budget):
    """An array field has to be a real array for `array-contains` to see it.

    `sanitizeFirestoreData` used to rewrite arrays as maps with numbered keys
    (`{"0": "PO"}`) when a revision was written, and Firestore's
    `array-contains-any` does not match a map - nor does it raise, so the node
    drops out of the filter rather than failing. A person stored that way is
    invisible to every party filter, and to the "no party" filter too, which
    looks for `parties == []` and does not match `{}` either.
    """
    # None on the export of 2026-10-25T03:00Z. The writer is fixed
    # (server/utils/revisions.ts rewrites only an array nested directly inside
    # another array, which is the case Firestore really cannot store), and
    # unwrap-array-fields.ts unwrapped the 3041 nodes stored that way before it
    # was.
    MAP_VALUED = 0

    fields = ("parties", "activity", "categories")
    not_arrays = [
        (document["id"], field)
        for document in nodes
        for field in fields
        if field in document and not isinstance(document[field], list)
    ]
    by_field = collections.Counter(field for _, field in not_arrays)
    documents = {document_id for document_id, _ in not_arrays}

    assert within_budget(len(documents), MAP_VALUED), (
        f"{len(documents)} nodes store an array field as a map ({dict(by_field)}), "
        f"and are missing from any array-contains filter on it - up from the "
        f"{MAP_VALUED} known ones. "
        f"Sample: {sample(not_arrays)}"
    )


def test_companies_are_not_duplicated_by_krs(nodes, within_budget):
    """One company node per KRS number.

    Both the company ingest and the KRS table filter look a company up with
    `where("krsNumber", "==", krs).limit(1)`, so a second node with the same
    number is unreachable: ingests land on whichever copy Firestore returns
    first and the other silently keeps stale data.

    A removed or merged-away copy is still counted: neither lookup skips
    `deleted`, and a merge leaves the tombstone its `krsNumber`.
    """
    # Two on 2026-10-09, both a company page somebody created by hand for a
    # register the site already had - nothing on that path asks the KRS number
    # first. „Therma” (BnTvgqabfOXJFyuzFi8t, 2026-08-24) beside the uploaded
    # v9eUDB9lGr62mj4r4Trq for 0000081135, both published, and „Centrum
    # Rozwoju Komunalnego S.A.” (G5YGSqENIsJYuKMSaaQx, 2026-10-06, a pending
    # draft) beside the published nGhA6sL2jA1HFfyJWHFw for 0000013874. Merging
    # each pair takes this to zero once the merge stops leaving the number on
    # the tombstone, or the lookups start following `merged_into`.
    KNOWN_DUPLICATES = 2

    counts = collections.Counter(
        document["krsNumber"] for document in nodes if document.get("krsNumber")
    )
    duplicated = {krs: count for krs, count in counts.items() if count > 1}

    assert within_budget(len(duplicated), KNOWN_DUPLICATES), (
        f"{len(duplicated)} KRS numbers have more than one company node, up from "
        f"the {KNOWN_DUPLICATES} known ones: {sample(duplicated)}"
    )


def test_a_company_can_be_told_apart_from_the_others(nodes, within_budget):
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

    assert within_budget(affected, KNOWN_SHARED_NAMES), (
        f"{affected} companies across {len(shared)} names cannot be told apart "
        f"from another company by name, up from the {KNOWN_SHARED_NAMES} known "
        f"ones: {sample(shared, 5)}"
    )


def test_a_company_is_not_named_by_its_number(nodes, within_budget):
    """A company page is called what the company is called.

    `CompanyPayloads` falls back to the KRS number when the register row it
    builds the payload from has no name (analysis/payloads/company.py), so a
    company the scrape caught half-way gets a page titled "0000123456": in
    every listing, in search, and on the page of everybody employed there.
    Nothing else fails, which is why it lasted until somebody read the list.

    A name that is only digits, that is the page's own `krsNumber`, or that
    reads "KRS 0000123456" is counted. A removed page is not: it has no page.
    """
    # None on the 2026-10-25T03:00:33.098Z export, nor on the 10-24 one. The
    # 10-09 to 10-15 ones had four (C6Bs5LQTAXtzJGByQZrM, GIc2UKHYmIr4GEXRUn9C,
    # jmBJNu3lIkNppL7ZsVwj, uLGIS8xvGWzcJ4NjFudg), which the upload after the
    # 10-15 export renamed; the fallback that named them is still there.
    KNOWN_NUMBERED = 0

    def named_by_a_number(document: dict) -> bool:
        name = str(document.get("name") or "").strip()
        if document.get("krsNumber") and name == document["krsNumber"]:
            return True
        if name[:3].lower() == "krs":
            name = name[3:].lstrip(" :")
        digits = "".join(name.split())
        return digits.isascii() and digits.isdigit()

    numbered = [
        (document["id"], document.get("name"), document.get("krsNumber"))
        for document in nodes
        if document.get("type") == "place"
        and not is_removed(document)
        and named_by_a_number(document)
    ]

    assert within_budget(len(numbered), KNOWN_NUMBERED), (
        f"{len(numbered)} company pages are named by a number rather than by the "
        f"company's name, up from the {KNOWN_NUMBERED} known. As (page, name, "
        f"krsNumber): {sample(numbered)}"
    )


def test_every_company_is_published(nodes, within_budget):
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

    The exception is an institution page somebody creates by hand, which is a
    claim like a person's: it waits as a draft until a reviewer approves it,
    and those drafts are the known ones below.

    A company retired through an approved removal is not reported as a hole -
    `deleted` is how a company stops having a page on purpose, and a merge
    leaves a removed tombstone - so only the live ones are counted, by the raw
    flag: `page_is_public` is false for a removed page too.
    """
    # Five on the export of 2026-10-25T03:00Z, the same five as on 2026-10-24,
    # every one an institution page somebody created by hand and nobody has
    # approved yet: „INSTYTUT PAMIĘCI NARODOWEJ KOMISJA ŚCIGANIA ZBRODNI
    # PRZECIWKO NARODOWI POLSKIEMU” (1CgFdGU15k37CbAUcSHZ, 10-20), „Sejmik
    # Województwa Kujawsko-Pomorskiego” (AuIOBqiuFjxUYsvYHGkh, 10-21), „Urząd
    # Miasta Łodzi” (rf82ncQA6uZYrHqa0PtA, 10-21), „Miejski Ośrodek Sportu i
    # Rekreacji w Częstochowie” (ciRcClIvnNHAxJtYO0Yw, 09-08) and „Centrum
    # Rozwoju Komunalnego S.A.” (G5YGSqENIsJYuKMSaaQx, 10-06, the draft twin
    # of a published company in test_companies_are_not_duplicated_by_krs).
    # There were 136 on 2026-08-26, all of which publish-places.ts published on
    # 08-27.
    UNPUBLISHED_COMPANIES = 5

    unpublished = [
        document["id"]
        for document in nodes
        if document.get("type") == "place"
        and not is_removed(document)
        and document.get("published") is not True
    ]

    assert within_budget(len(unpublished), UNPUBLISHED_COMPANIES), (
        f"{len(unpublished)} companies are not published, so every link to one "
        f"of them is a dead end for a logged out reader - up from the "
        f"{UNPUBLISHED_COMPANIES} known drafts: {sample(unpublished)}"
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


def test_edge_stats_cover_every_edge_of_the_node(nodes, edges, within_budget):
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

    Since 2026-09-02 that something is `sweepEdgeStats`: `onEdgeWritten` marks
    an edge's source and the sweep recomputes it from the edges it is the
    source of, leaving out the deleted ones. This used to expect what a full
    `computeNodeStats` run writes instead - deleted edges included, and every
    edge's target listing itself - and so grew with every soft delete and every
    company the people import creates (only ever a target, never swept): 312
    nodes on the 2026-10-06 export, 761 two days later, not one of them missing
    a live edge.
    """
    # The self entry only a full computeNodes writes is left unchecked: the
    # readers of `targetNodeIds` (the person table's filters, the timeline, a
    # region's seats) all read a person's or a region's list, never a company
    # listing itself.
    expected: dict[str, set[str]] = collections.defaultdict(set)
    for edge in edges:
        if edge.get("deleted") is True:
            continue
        expected[edge["source"]].add(edge["target"])

    # None on the 2026-10-07 and 2026-10-08 exports. The sweep runs once a
    # minute, so an edge written while the export runs can be in it before its
    # source's stats are; as for `test_notes_count_matches_the_notes`, a few
    # are lag, more are a sweep that has stopped.
    RECOMPUTE_LAG = 5

    incomplete = []
    for document in nodes:
        edge_stats = stats_of(document).get("edges") or {}
        stored = set((edge_stats.get("all") or {}).get("targetNodeIds") or [])
        missing = expected.get(document["id"], set()) - stored
        if missing:
            incomplete.append((document["id"], sample(missing, 3)))

    assert within_budget(len(incomplete), RECOMPUTE_LAG, allowance=True), (
        f"{len(incomplete)} nodes have live edge targets missing from "
        f"stats.edges.all.targetNodeIds, so the table filters cannot find them, "
        f"more than the {RECOMPUTE_LAG} the sweep's lag explains: "
        f"{sample(incomplete, 5)}"
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


def test_a_live_edge_joins_two_live_pages(edges, snapshot, within_budget):
    """An edge nobody removed has a page that is still a page at each end.

    `test_edge_endpoints_exist` cannot see this, because a page that was taken
    down or merged away keeps its document: `deleted: true`, and for a merge
    `merged_into` the survivor. Readers drop that document, so an edge still
    hanging off it leads from a live page to one that is gone - the person
    loses a job or a candidacy the site had, or a company a board member - and
    a draft edge waits in the review queue for a page readers are sent away
    from. A merge re-points each of the duplicate's edges at the survivor, or
    removes the ones the survivor already states (`server/utils/merge.ts`), so
    it must not leave one behind, and neither may an ingest that reached the
    tombstone instead of the page it was merged into.

    A plain removal is not held to that yet. Approving one (`applyRevision`)
    writes only the page and leaves its edges as they are, so the first such
    removal of a page with edges shows up here. None had been approved by the
    2026-10-25 export, and whether the approval should take the page's edges
    with it is still to be decided.

    Counted is a retired page with at least one live edge, however many it
    has, so that one bad merge or removal costs one and not the page's degree.
    A live edge counts whether it is published or still a draft, since the
    merge moves both. An edge the merge or a reviewer removed is the repair
    and is left out: 763 removed edges hang off 166 of the 174 retired pages of
    the 2026-10-25 export, which is what the merges left.
    """
    # 0 on the 2026-10-25T03:00:33.098Z export, as on the 10-14, 10-15, 10-23
    # and 10-24 ones. All 174 retired pages are person pages both removed and
    # merged away. The company merges about to start are what this guards.
    RETIRED_PAGES_WITH_LIVE_EDGES = 0

    nodes_by_id = snapshot.by_id("nodes")

    def retired(node_id) -> bool:
        node = nodes_by_id.get(node_id)
        return node is not None and not is_live(node)

    stranded: dict[str, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if is_removed(edge):
            continue
        for end in {edge.get("source"), edge.get("target")}:
            if retired(end):
                stranded[end].append(edge["id"])
    pages = [
        (page, nodes_by_id[page].get("merged_into"), len(ids), sorted(ids)[:3])
        for page, ids in sorted(stranded.items())
    ]

    assert within_budget(len(pages), RETIRED_PAGES_WITH_LIVE_EDGES), (
        f"{len(pages)} removed or merged-away pages still have live edges, up "
        f"from the {RETIRED_PAGES_WITH_LIVE_EDGES} known, as (page, merged "
        f"into, live edges, first edges): {sample(pages)}"
    )


def test_edge_types_are_known(edges, within_budget):
    """Only the edge types `shared/model.ts` declares may be stored."""
    # 64 `source` and 3 `mentioned_person` edges. `source` predates article
    # nodes and points at a legacy blob; `mentioned_person` is the *UI* name for
    # an article->person `mentions` edge (see `useEdgeTypes.ts`), written to the
    # database by mistake instead of its `realType`.
    LEGACY_EDGE_TYPES = 67

    unknown = collections.Counter(
        edge.get("type") for edge in edges if edge.get("type") not in EDGE_TYPES
    )

    assert within_budget(sum(unknown.values()), LEGACY_EDGE_TYPES), (
        f"{sum(unknown.values())} edges have a type the frontend does not "
        f"handle ({dict(unknown)}), up from the {LEGACY_EDGE_TYPES} known ones."
    )


def test_edges_join_the_node_types_they_are_defined_for(edges, snapshot, within_budget):
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

    assert within_budget(sum(wrong.values()), LEGACY_ORIENTATIONS), (
        f"{sum(wrong.values())} edges join node types their edge type is not "
        f"defined for, up from the {LEGACY_ORIENTATIONS} known ones, as "
        f"(edge type, source type, target type): {dict(wrong)}"
    )


def test_a_company_has_one_registered_seat(edges, within_budget):
    """A company is seated in one region.

    The register gives a company one registered seat, and EDGE_SEMANTICS says
    as much of `seat`: one per pair, and in fact one per company. A second seat
    in another region puts the company in both: `computeNodes` folds every seat
    into the regions of the people employed there, and the region filter on
    /eksploruj reads seats too, so a company registered in Katowice is listed
    as one of another region's as well.

    The company ingest will not write one (`findSeatFromAnotherRegion` in
    server/api/ingest/company.post.ts refuses a seat when another region holds
    one), so a second seat is a person's, added through the edit form. Two
    copies of one seat are `test_a_state_edge_is_not_stored_twice`; this
    counts companies seated by two regions or more. A removed seat is not one,
    as the region filter skips it; an unpublished one is, as the filter does
    not.
    """
    # One on the 2026-10-25T03:00:33.098Z export, as on the 10-24 one: KOLEJE
    # ŚLĄSKIE (DMvg3qYqBqMhVlCR42zD), seated in Katowice by the ingest and in
    # Województwo śląskie by a draft seat made by hand, 4mlH10nwVU6WiEsp9Dgj.
    KNOWN_TWO_SEATS = 1

    regions: dict[str, set[str]] = collections.defaultdict(set)
    for edge in edges:
        if edge.get("type") == "seat" and not is_removed(edge):
            regions[edge["target"]].add(edge["source"])

    seated_twice = {
        company: sorted(seats) for company, seats in regions.items() if len(seats) > 1
    }

    assert within_budget(len(seated_twice), KNOWN_TWO_SEATS), (
        f"{len(seated_twice)} companies are seated in more than one region, up "
        f"from the {KNOWN_TWO_SEATS} known. As (company, regions): "
        f"{sample(list(seated_twice.items()), 5)}"
    )


def test_a_state_edge_is_not_stored_twice(edges, within_budget):
    """A tie that either holds or does not may only be recorded once.

    `owns`, `seat`, `mentions` and `comment` assert a relationship rather than
    an occurrence - a region seats a company, an article names a person - so the
    pair and the type are the whole of what they say and a second document adds
    nothing. This is the only edge duplication that can be judged from the
    stored data alone; see `test_occurrence_edges_may_repeat` for why the rest
    cannot. The rule this mirrors lives in `frontend/server/utils/edges.ts`.
    """
    # Region->company links written twice by one company ingest, before the
    # edge id was derived from the pair: 64 when this was first counted. The
    # 2026-08-29 split retyped them to `seat`, which this did not count until
    # 2026-10-25, so they went out of its sight unrepaired and it read 1. With
    # `seat` counted, 66 on the 2026-10-25T03:00:33.098Z export, as on the
    # 10-24 one, all unchanged since 10-09. 65 are seat pairs: 63 of that
    # ingest's, both copies filed between February and May 2026, and two with
    # a copy from August, one of them a seat made by hand on 08-24 beside its
    # derived id (UUfXaWU5JeZ8ZOpXAX9S, edge_teryt2461_CJ7iv0ZAQ6eYBmDq41Pr_seat).
    # The other is an `owns` pair in the region tree (xCI1ADtvW9UF7jvlpPD5,
    # OsHePx3pZCQjCbKuwurs). Only goes down, and to zero once
    # scripts/migrate/dedupe-edges.ts has been run against production. A
    # removed copy is the repair rather than one more duplicate, so it is not
    # counted.
    DUPLICATED_STATE_EDGES = 66

    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") not in STATE_EDGE_TYPES or is_removed(edge):
            continue
        groups[(edge["source"], edge["target"], edge["type"])].append(edge["id"])

    duplicated = {key: ids for key, ids in groups.items() if len(ids) > 1}
    redundant = sum(len(ids) - 1 for ids in duplicated.values())
    by_type = collections.Counter(key[2] for key in duplicated)

    assert within_budget(redundant, DUPLICATED_STATE_EDGES), (
        f"{redundant} state edges duplicate another one across "
        f"{len(duplicated)} pairs ({dict(by_type)}), up from the "
        f"{DUPLICATED_STATE_EDGES} known ones. "
        f"Sample: {sample(list(duplicated.values()), 5)}"
    )


def test_nobody_stands_in_two_places_at_once(edges, nodes, within_budget):
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
    candidacies are grouped by the election they were stood in
    (`election_stood_in`), not by the office. Keyed by the office, as this test
    was until 2026-10-25, a council run in Bytom beside a „Samorząd” one in
    powiat poznański never met, and every office the ingest named split one
    election into more groups that could not clash. A candidacy with no office
    in a year that held two kinds of election (2014, 2019, 2024) says neither,
    so a person's such runs of one year form one group of their own: it may
    join a european run with a local one, which is two contests rather than a
    clash, and only PKW can tell which.

    Only reviewed candidacies count, the ones `pageIsPublic` shows a visitor.
    Since 2026-10-07 a person is sent every PKW record nothing contradicts, and
    several namesakes' records can each fit one person, so the upload files
    some in two places at once on purpose: unpublished, for a reviewer to
    reject. Counted with them, this read 152 on the 2026-10-08 export, all but
    24 of them waiting in the queue.

    The publish dialog warns a reviewer by the place rule before a click adds
    to this count: `placeClashes` in frontend/shared/twoPlaces.ts. A change to
    one belongs in the other, but that port still groups by the office: moving
    it to the election is a follow-up, because it changes what the dialog
    shows. Until then the dialog misses the clashes this test finds by the
    election alone.
    """
    # 29 on the 2026-10-25T03:00:33.098Z export, 29 on the 10-24 one. 24 of
    # them are the clashes the office key counted, on 18 published pages on the
    # 2026-10-08 export, among them Mariusz Michał Wiśniewski, whose two June
    # candidacies for 2014 (Poznań, powiat grójecki) were approved on
    # 2026-10-07. The other five only the election key sees: Michał Bieda
    # 5rbdMT3pAeKIaqQyp4XG 2018 (Rada miasta Bytom and „Samorząd” in powiat
    # poznański), Adam Dziedzic t0cokSaabblva2ROLqKC 2014 (Wójt in powiat
    # rzeszowski, the podkarpackie sejmik and Rada powiatu kartuskiego), and
    # Tomasz Wiśniewski 4HydyClSHkXhj48tVC55 2010, Paweł Stolarczyk
    # 7Sy7yo2Uh768n74xEcnR 2010 and Sebastian Lorenc iHoGSMlr6ebLTChHErKD 2018,
    # each a run with no office beside a „Samorząd” one in another województwo.
    # In each, one of the places is somebody else's; the count goes down as
    # reviewers unpublish them. Four of the 29 are runs with no office in a
    # year of two elections, from the March 2026 upload, and may be a european
    # run beside a local one rather than a clash: Górski 7YCsfPftvPtrOyA2fOlJ
    # 2024 (0801, 2007), Mazur GWgzZD52BLymQwWCQ4Qf 2014 (0206, 0807), Mucha
    # aWxbUBV1x7YjXjus2Egf 2014 (1208, 3206) and Adamski VBeJC8Q0WNCAbHhGBV00
    # 2014 (3008, 3027). The office key pooled them the same way.
    KNOWN_CONTRADICTIONS = 29

    nodes_by_id = {node["id"]: node for node in nodes}
    regions: dict[tuple, set[str]] = collections.defaultdict(set)
    for edge in edges:
        if edge.get("type") != "election" or not page_is_public(edge):
            continue
        teryt = nodes_by_id.get(edge["target"], {}).get("teryt")
        if not teryt:
            continue
        key = (
            edge["source"],
            str(edge.get("start_date"))[:4],
            election_stood_in(edge),
        )
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

    assert within_budget(len(contradictory), KNOWN_CONTRADICTIONS), (
        f"{len(contradictory)} candidacies put one person in two constituencies "
        f"in the same election, up from the {KNOWN_CONTRADICTIONS} known ones, "
        f"so the person is two people: "
        f"{sample(list(contradictory.items()), 5)}"
    )


def test_occurrence_edges_may_repeat(edges, within_budget):
    """Two identical local candidacies are not a defect to fix; two identical
    runs for one national seat are.

    Identical local candidacies are how the database says a person stood
    twice, and the fields that would tell two of them apart are destroyed
    before the ingest sees them: the office collapses into the "Samorząd"
    bucket where PKW's files do not name it, the gmina TERYT is truncated to
    its powiat, `committee` is dropped at the API boundary, and the run-off
    round is discarded by the scraper. Standing for burmistrz and for that
    town's rada in 2024 is stored as two byte-identical documents - and so is
    one mayoral bid that went to a second round. So nothing counts those.

    Nobody stands twice for the Sejm, the Senat or the European Parliament,
    though, so a repeat of one of those offices is a write bug, and this test
    counts its plainest form: two candidacies of one person for one office,
    under one region and on one day, that contradict nothing (`edge_relation`,
    read both ways). It is the narrow form of
    `test_a_single_seat_run_is_stored_once`, which took the question over on
    2026-10-25 and also sees the copies filed in two places one inside the
    other, the copies with no office and the ones dated on another day; every
    run counted here counts there too.

    Two such candidacies that do contradict each other - another committee,
    another party - are two namesakes' runs on one page. Since 2026-10-07 the
    upload sends every PKW record nothing contradicts, so they arrive as
    drafts on purpose, for a reviewer to reject, and a budget on them would
    rise with ordinary sends; `test_a_person_stands_once_in_a_national_election`
    counts them once both are published. Until 2026-10-25 this test counted
    them too, and they were most of the warning it gave every night since the
    10-17 export.

    Employment was named here too, as an occurrence that may repeat. It is
    `test_one_spell_of_employment_is_stored_once`'s now, and was never counted
    here: that test keys an employment on the pair, the role and the start,
    which two identical employments always share, so it counts every
    identical copy as well as the ones that differ only in their end.
    """
    # 2 on the 2026-10-25T03:00:33.098Z export and on the 10-24 one, both on
    # unpublished pages, both kept by a page merge and both counted by
    # `test_a_single_seat_run_is_stored_once` too. Tomasz Pawlak
    # AaAjgAyGQH4Ru1nZsJU7, Sejm 2005 in wielkopolskie: the copy
    # edge_Xkt3x0BtxfzO5oHRl4iC_teryt30_election_6_bWisJ104. Witold Stępień
    # p1HPFg4Y63DNYZOeJFtz, European Parliament 2019 under powiat 1008:
    # fgXV1yaF2okWbz6jzT6A. Paweł Tomasz Kurek's two copies, known on
    # 2026-10-09, were removed on 10-12. Removing these two as „duplikat”
    # takes this to zero. The five namesakes' runs this also counted until
    # 2026-10-25 (Kozłowski Sejm 2015, Bury Sejm 2005, 2007 and 2011, Nowak
    # Sejm 2005) are drafts for a reviewer and no longer count.
    KNOWN_COPIES = 2

    groups: dict[tuple, list[dict]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "election" or is_removed(edge):
            continue
        if edge.get("position") not in DISTRICT_OFFICES:
            continue
        groups[
            (
                edge["source"],
                edge["target"],
                edge.get("position"),
                edge.get("start_date"),
            )
        ].append(edge)

    def contradict(a: dict, b: dict) -> bool:
        return "conflict" in (edge_relation(a, b), edge_relation(b, a))

    duplicated = {
        key: [candidacy["id"] for candidacy in candidacies]
        for key, candidacies in groups.items()
        if any(
            not contradict(a, b)
            for i, a in enumerate(candidacies)
            for b in candidacies[i + 1 :]
        )
    }

    assert within_budget(len(duplicated), KNOWN_COPIES), (
        f"{len(duplicated)} candidacies are recorded twice for an office that "
        f"can only be stood for once, up from the {KNOWN_COPIES} known copies, "
        f"so the repeats are not two real candidacies after all: "
        f"{sample(list(duplicated.items()), 5)}"
    )


def test_a_single_seat_run_is_stored_once(edges, nodes, within_budget):
    """A run for the Sejm, the Senat or the European Parliament is one document.

    Nobody stands twice in one national election, so two candidacies of one
    person in one of them are two people under one name or one run stored
    twice. They are a copy when neither contradicts the other - `edge_relation`
    finds no field they disagree about, read both ways, which also keeps a Sejm
    run apart from a Senat one - and their places agree: the same region, or
    one inside the other, which is where a run filed under the candidate's home
    powiat sits beside the one filed under the district's województwo. Any two
    places agree for the European Parliament, whose districts join several
    województwa, so a copy of its run need not lie inside the other. A copy
    with no office counts in a year that held only one kind of election
    (`election_stood_in`), as the ingest's `isSameRun` reads it. A run is the
    person, the year and the election, so a copy dated on another day of the
    year still meets its twin. Each run counts once, however many copies it
    has.

    The copies came from two writers. Uploads before 2026-07-30 could file a
    national run under the residence powiat, and european ones until the fix
    of 2026-10-12, and the ingest looked for a run only under the district, so
    every later send stored a twin beside it: 170 runs on the 2026-10-23
    export, 168 of which the national-runs-stored-twice migration cleared that
    evening; the other two are page-merge copies (below). Since then the
    ingest moves the home copy to the district (`misfiledRunOf`), so a twin
    here means that move stopped matching. And a page merge keeps the
    identical candidacies of the two pages it folds, for a reviewer to remove.

    Two namesakes' runs in one district contradict each other, so they are not
    counted here: the upload sends them as drafts on purpose, for a reviewer to
    reject, and `test_a_person_stands_once_in_a_national_election` counts them
    once both are published.
    """
    # 2 on the 2026-10-25T03:00:33.098Z export and on the 10-24 one, both on
    # unpublished pages. Tomasz Pawlak AaAjgAyGQH4Ru1nZsJU7, Sejm 2005: the copy
    # edge_Xkt3x0BtxfzO5oHRl4iC_teryt30_election_6_bWisJ104 came with the page
    # merge-duplicate-people folded into his in August. Witold Stępień
    # p1HPFg4Y63DNYZOeJFtz, European Parliament 2019: fgXV1yaF2okWbz6jzT6A,
    # the 06-01 upload's copy, came with the page merged into his on 10-12.
    # Removing the two copies as „duplikat” takes this to zero.
    KNOWN_STORED_TWICE = 2

    teryt_of = {
        node["id"]: node.get("teryt") or ""
        for node in nodes
        if node.get("type") == "region"
    }
    runs: dict[tuple, list[dict]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "election" or is_removed(edge):
            continue
        if not has_date(edge, "start_date"):
            continue
        kind = election_stood_in(edge)
        if kind in ("parliament", "european"):
            year = str(edge["start_date"])[:4]
            runs[(edge["source"], year, kind)].append(edge)

    def copies(kind: str, a: dict, b: dict) -> bool:
        if "conflict" in (edge_relation(a, b), edge_relation(b, a)):
            return False
        if kind == "european":
            return True
        here, there = teryt_of.get(a["target"]), teryt_of.get(b["target"])
        if not here or not there:
            return False
        return here.startswith(there) or there.startswith(here)

    stored_twice = {}
    for (person, year, kind), candidacies in runs.items():
        pairs = [
            (a["id"], b["id"])
            for i, a in enumerate(candidacies)
            for b in candidacies[i + 1 :]
            if copies(kind, a, b)
        ]
        if pairs:
            stored_twice[(person, year, kind)] = pairs

    assert within_budget(len(stored_twice), KNOWN_STORED_TWICE), (
        f"{len(stored_twice)} single-seat runs are stored more than once, up "
        f"from the {KNOWN_STORED_TWICE} known ones, as ((person, year, "
        f"election), [pairs of copies]): {sample(list(stored_twice.items()), 5)}"
    )


def test_a_person_stands_once_in_a_national_election(edges, within_budget):
    """A visitor sees at most one run of a person in one national election.

    A candidate stands in one district for one chamber: the Sejm and the Senat
    are filled in one parliamentary election, and nobody is on both ballots.
    So two published candidacies of one person in one Sejm-and-Senat election,
    or in one European one, are a run shown twice or two people on one page,
    whether or not their places agree and whatever their committees say.
    `test_nobody_stands_in_two_places_at_once` sees only the ones in places
    that disagree and `test_a_single_seat_run_is_stored_once` only the copies;
    this sees what a reader is shown. A by-election (`by_election`, „wybory
    uzupełniające”) is a contest of its own, so it is left out. A candidacy
    with no office counts in a year that held only one kind of election
    (`election_stood_in`).

    Only reviewed candidacies count, the ones `pageIsPublic` shows. The upload
    files every PKW record nothing contradicts, so namesakes' runs reach a page
    as drafts on purpose, for a reviewer to reject: 28 person-elections hold
    more than one live candidacy on the 2026-10-25 export. Published, 28 had
    two before the national-runs-stored-twice migration of 2026-10-23.
    """
    # 1 on the 2026-10-25T03:00:33.098Z export and on the 10-24 one: Piotr
    # Mazurek MYdOK2dYhoCVkBmc50oo, two published 2005 candidacies with no
    # office, 1bWXvAKJ83U33aX01ZSD in dolnośląskie (02) and
    # vBhkkFwffITYmjipDl26 in mazowieckie (14). 2005 held only the
    # parliamentary election, so one of the two is somebody else's; it is also
    # one of the clashes `test_nobody_stands_in_two_places_at_once` counts.
    KNOWN_TWICE_PUBLISHED = 1

    runs: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "election" or not page_is_public(edge):
            continue
        if edge.get("by_election") is True or not has_date(edge, "start_date"):
            continue
        kind = election_stood_in(edge)
        if kind in ("parliament", "european"):
            year = str(edge["start_date"])[:4]
            runs[(edge["source"], year, kind)].append(edge["id"])

    twice = {key: ids for key, ids in runs.items() if len(ids) > 1}

    assert within_budget(len(twice), KNOWN_TWICE_PUBLISHED), (
        f"{len(twice)} people are shown more than one run in one national "
        f"election, up from the {KNOWN_TWICE_PUBLISHED} known ones, as "
        f"((person, year, election), [candidacies]): "
        f"{sample(list(twice.items()), 5)}"
    )


def test_a_national_run_is_filed_under_its_district(edges, nodes, within_budget):
    """A Sejm, Senat or European Parliament candidacy is filed under a
    województwo.

    A national run is stood in a district, and the pipeline files every one
    under a województwo of its district (`DISTRICT_OFFICES`; a european
    district joins several): a two-digit TERYT, never a powiat or a gmina.
    Uploads before 2026-07-30 could file one under the
    candidate's residence instead, and european ones until the fix of
    2026-10-12, which the page then shows as a run for the European
    Parliament in powiat pabianicki, and which is how a run came to be stored
    twice: the ingest looked for it only under the district, did not find the
    home copy and stored a twin beside it
    (`test_a_single_seat_run_is_stored_once`). The ingest now moves a home
    copy to the district when the run is sent again (`misfiledRunOf`), so
    this count only falls, by as many as the night's sends reach. A new one
    means the payload places national runs at the residence again.

    Only a candidacy that names its office is counted. A home copy with no
    office, in a year of one kind of election, is the same misfile, and the
    ingest moves it the same way (`isSameRun` reads it by its year), but it
    says which election it was only through that year: the 21 below a
    województwo on the 2026-10-25 export (20 of 2023, one of 2001, 13
    published) are left to `test_a_candidacy_names_its_office`, which counts
    the 20 an ingest wrote.

    Four of the counted ones stay where they are on purpose: the home lies in
    another województwo than the district, so the copy cannot be told from a
    namesake's run and the ingest does not move it. They are the Sejm runs of
    Koszarek 2oj0TW6vjOkQOA8xjs4a, Norbert Kwiatkowski xyjpVBtsHW37sjgul9JD,
    Jabłoński KN947LkbkLBG3Z6Agbwq and Protasiewicz ENb8CrCGTG2q9TANeyZo. The
    fifth left on purpose, Cieślukowski's Senat run JKqh2x1GW6DbQnVWik4u, has
    no office, so it is not counted here.
    """
    # 281 on the 2026-10-25T03:00:33.098Z export: Sejm 199, European
    # Parliament 60, Senat 22, 17 of them published. 300 on the 10-24 export,
    # 299 of them written by the bulk uploads of 2026 (234 in June) and one by
    # the night of 10-07; nothing has written one since. The 10-24 night's
    # sends moved 19 to their district. Expected only to fall.
    KNOWN_UNDER_HOME = 281

    teryt_of = {
        node["id"]: node.get("teryt") or ""
        for node in nodes
        if node.get("type") == "region"
    }
    under_home = [
        (edge["id"], edge.get("position"), teryt_of.get(edge["target"]))
        for edge in edges
        if edge.get("type") == "election"
        and not is_removed(edge)
        and edge.get("position") in DISTRICT_OFFICES
        and len(teryt_of.get(edge["target"]) or "") > 2
    ]
    by_office = collections.Counter(office for _, office, _ in under_home)

    assert within_budget(len(under_home), KNOWN_UNDER_HOME), (
        f"{len(under_home)} national candidacies are filed below a województwo "
        f"({dict(by_office)}), up from the {KNOWN_UNDER_HOME} known ones, as "
        f"(edge, office, teryt): {sample(under_home)}"
    )


def test_a_candidacy_names_its_office(edges, entered_by_hand, within_budget):
    """Every candidacy an ingest wrote says which office was contested.

    Without an office the page lists a run with nothing to say what it was
    for, the elections list has nothing to show for it, and the checks on
    national runs can read it only by its year (`election_stood_in`), which in
    2014, 2019 and 2024 says nothing. The payload has sent an office on every
    row since the 2026-10-15 night - a named one where PKW's files give it,
    „Samorząd” where they do not - and the nights' sends fill it in on the
    stored candidacies they reach, so this count only falls. It also holds the
    national home copies with no office that
    `test_a_national_run_is_filed_under_its_district` leaves out.

    So this asks the ingests, as `test_employment_says_what_the_person_did`
    does: a person adding a candidacy through the site may not know the
    office, and a blank they leave is not a regression to hold the night's
    upload over. The revision side, counted since 2026-05-01, is
    `test_required_field_present[election.position]` in test_revisions.py.
    """
    # 1,440 on the 2026-10-25T03:00:33.098Z export, 1,017 of them published,
    # down from 1,620 on 10-09 and 1,478 on 10-24 as the nights' sends named
    # them. Every one was first written by the uploads of March (986) and April
    # 2026 (454); by year 2010 272, 2014 255, 2002 252, 2018 160, 2024 153,
    # 2006 116 and fewer in the rest. Expected only to fall. 15 more live
    # candidacies have no office and were typed in.
    KNOWN_OFFICELESS = 1440

    officeless = [
        edge
        for edge in edges
        if edge.get("type") == "election"
        and not is_removed(edge)
        and edge["id"] not in entered_by_hand
        and field(edge, "position") is None
    ]
    by_year = collections.Counter(
        str(edge.get("start_date"))[:4] for edge in officeless
    )

    assert within_budget(len(officeless), KNOWN_OFFICELESS), (
        f"{len(officeless)} candidacies an ingest wrote do not say which office "
        f"was contested, up from the {KNOWN_OFFICELESS} known ones, by year "
        f"{dict(sorted(by_year.items()))}: "
        f"{sample(edge['id'] for edge in officeless)}"
    )


def test_one_spell_of_employment_is_stored_once(edges, within_budget):
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
    # 205 on the export of 2026-10-25T03:00Z, as on 2026-10-24, counting only
    # the copies still live - the ones removed by hand as „duplikat” are the
    # repair. It was 205 on 2026-07-28 and 211 on 2026-08-02, while neither
    # guard was deployed and the nightly run added about one a day, then 207
    # on 2026-10-09 and 206 on 10-15. The newest is from 10-07: the people
    # import wrote Robert Marian Soszyński's 2015 Zarząd spell at Polskie LNG
    # twice in one request, once ending on the day it began, because the
    # payload carried both rows and the ingest stores a row per row. Nothing
    # has joined them since, so this only falls, and goes to zero once
    # dedupe-edges.ts has been run against production.
    DUPLICATED_SPELLS = 205

    groups: dict[tuple, list[str]] = collections.defaultdict(list)
    for edge in edges:
        if edge.get("type") != "employed" or is_removed(edge):
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

    assert within_budget(redundant, DUPLICATED_SPELLS), (
        f"{redundant} employment edges repeat a spell already stored across "
        f"{len(duplicated)} (person, company, role, start) groups, up from the "
        f"{DUPLICATED_SPELLS} known ones. "
        f"Sample: {sample(list(duplicated.values()), 5)}"
    )


def test_a_spell_of_employment_is_on_one_page(
    edges, live_people, revisions, within_budget
):
    """One spell, one person: two pages of one name do not both hold it.

    A role at a company that began on a given day is one person's - two
    namesakes do not join one board on one day - so the same (company, role,
    start) on two live pages whose names agree (`names_agree`, the ingest's
    own test) is one person filed twice, or one page holding a namesake's job.
    `test_one_spell_of_employment_is_stored_once` asks it of one page; this
    asks it across pages, where neither page looks wrong on its own.

    The register link does not settle it either way. Most of these pair a
    linked page with an unlinked one from the 2026-03-26 upload, made before
    the register reached the person. A payload with a link that finds no page
    by it falls back to the exact name (`lookupByName`), so a given name the
    older page writes and the payload does not makes a second page; seven
    pairs carry exactly the same name, which that does not explain. Some pair
    two entries, where one of the pages holds a namesake's job. Counted is a
    pair of pages, however many spells the two share, and only a spell with a
    start, since an undated one names no day to be the same on.

    The message lists the pairs newest first, by when the younger page of the
    two was made, so the pairs that pushed the count up come before the ones
    known for weeks.
    """
    # 47 page pairs on the 2026-10-25T03:00:33.098Z export, up from 36 on
    # 10-14 and 45 on 10-24:
    # - 27 pair a linked page with an unlinked one, 18 of them both published;
    #   among them Kulicki shares 12 spells, Świątkowski and Lisiewicz 9, Gut
    #   and Soszyński 8.
    # - 19 link two entries, a namesake's job on one of the pages.
    # - 1 links one entry twice, Wojciechowski's pair from
    #   `test_a_register_entry_has_one_page`.
    # The two new since 10-24 show both ways it grows. The night made the
    # linked Krzysztof Zaremba Krf3YgfPgU3qShbbX8OG beside the unlinked
    # Krzysztof Piotr Zaremba OxOLyO2vZ2YPSJ2dGET9 of 03-26: one person filed
    # twice, which only a merge stops (merge-linked-and-unlinked-person-twins).
    # And it filed a namesake's jobs on a page of his own, Paweł Wiśniewski
    # c4IOvR5Lz5pKSm440Fn5 beside uapqPAzp4VSQ38UghAhr (remove-namesake-jobs).
    # At about one a day this passes 57, the end of the buffer, around
    # 2026-11-04 and holds that night's upload: measure it again before then,
    # once those two have run.
    SHARED_SPELL_PAIRS = 47

    pages = {document["id"]: document for document in live_people}
    holders: dict[tuple, set[str]] = collections.defaultdict(set)
    for edge in edges:
        if edge.get("type") != "employed" or is_removed(edge):
            continue
        if edge.get("source") not in pages or not has_date(edge, "start_date"):
            continue
        spell = (edge["target"], edge.get("name") or None, str(edge["start_date"])[:10])
        holders[spell].add(edge["source"])

    shared: collections.Counter = collections.Counter()
    for spell, ids in holders.items():
        ordered = sorted(ids)
        for i, one in enumerate(ordered):
            for other in ordered[i + 1 :]:
                if names_agree(pages[one].get("name"), pages[other].get("name")):
                    shared[(one, other)] += 1

    paired = {page for pair in shared for page in pair}
    made: dict[str, str] = {}
    for revision in revisions:
        page = reference_id(revision.get("node_id"))
        if page in paired:
            stamp = timestamp_key(revision.get("update_time"))
            made[page] = min(made.get(page, stamp), stamp)
    newest = sorted(
        (
            (
                max(made.get(one, ""), made.get(other, ""))[:10],
                one,
                other,
                pages[one].get("name"),
                count,
            )
            for (one, other), count in shared.items()
        ),
        reverse=True,
    )

    assert within_budget(len(shared), SHARED_SPELL_PAIRS), (
        f"{len(shared)} pairs of live person pages whose names agree hold the "
        f"same (company, role, start), up from the {SHARED_SPELL_PAIRS} known, "
        f"so each pair is one person on two pages, or one of them holds a "
        f"namesake's job, newest first as (younger page made, page, page, "
        f"name, spells shared): {sample(newest)}"
    )


def test_employment_says_what_the_person_did(edges, entered_by_hand, within_budget):
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

    So this asks the ingests. A person adding a post through the site may leave
    the role blank - `RelationDetailFields` puts no rule on it, and an article
    often names the company and not the post - and a role nobody knew is not a
    regression that should hold the night's upload.
    """
    # Written before KRS_RELATION_ROLES existed. 240 on the 2026-07-28 export,
    # 246 on the 2026-08-02 one - the table decides nothing until it ships, so
    # every nightly run still writes a few more.

    #
    # 193 of them on 2026-10-09 came from an ingest and are still live: 249
    # counted everything, three of them removed since (two by
    # merge-duplicate-people) and 53 entered by hand - 42 typed in in December
    # 2025, 8 in January 2026 and three facts from articles in August.
    KNOWN_ROLELESS = 193

    roleless = [
        edge["id"]
        for edge in edges
        if edge.get("type") == "employed"
        and not is_removed(edge)
        and edge["id"] not in entered_by_hand
        and not edge.get("name")
    ]

    assert within_budget(len(roleless), KNOWN_ROLELESS), (
        f"{len(roleless)} employment edges say nothing about what the person "
        f"did, up from the {KNOWN_ROLELESS} known ones: {sample(roleless)}"
    )


@pytest.mark.parametrize("edge_type", DATED_EDGE_TYPES)
def test_a_dated_edge_says_when_it_began(
    edges, entered_by_hand, edge_type, within_budget
):
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

    Which is why only what an ingest wrote is counted. `relationDateRule`
    accepts an empty start, an article that names a post rarely says when it
    began, and the site prints "?" for it - so a person leaving the date blank
    is the form working, not a defect to hold the night's upload over. The
    count used to include them and could only grow: every fact promoted from an
    article review added one.
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
    #
    # Counted as an ingest's only, 11 on 2026-10-09: the July uploads above,
    # nine of them unpublished. The other 193 live ones were typed in - 181
    # before 2026, one in January and 11 in August and September, ten of those
    # facts from articles - and so was the one undated candidacy, a
    # „wicestarosta” post entered as an election.
    UNDATED = {"employed": 11, "election": 0}

    undated = [
        edge["id"]
        for edge in edges
        if edge.get("type") == edge_type
        and not is_removed(edge)
        and edge["id"] not in entered_by_hand
        and not has_date(edge, "start_date")
    ]
    budget = UNDATED[edge_type]

    assert within_budget(len(undated), budget), (
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


def test_employment_does_not_end_before_it_starts(edges, within_budget):
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

    assert within_budget(len(inverted), KNOWN_INVERTED), (
        f"{len(inverted)} edges end before they start, up from the "
        f"{KNOWN_INVERTED} known one: {sample(inverted)}"
    )


#: The days PeopleKRS ran before 5fe9e12b (2026-05-05) and wrote as the end of
#: every post rejestr.io still listed as current. Kept in step with
#: `CRAWL_STAMPS` in `frontend/scripts/migrate/clear-crawl-stamp-job-ends.ts`.
CRAWL_STAMPS = ("2026-03-18", "2026-04-06")

WARSAW = zoneinfo.ZoneInfo("Europe/Warsaw")


def end_day(edge: dict) -> str | None:
    """The day an edge's `end_date` names, or None where it names none.

    Every writer stores the day as text; a timestamp is read as the Warsaw day
    it falls on, as the migration reads one, since a date picked as midnight in
    Poland is stored as the evening before in UTC.
    """
    value = edge.get("end_date")
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=datetime.UTC)
        return value.astimezone(WARSAW).date().isoformat()
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return value.strip()[:10]
    return None


def job_ends_by_day(edges) -> collections.Counter:
    """How many live employment edges end on each day."""
    return collections.Counter(
        day
        for edge in edges
        if edge.get("type") == "employed" and not is_removed(edge)
        for day in [end_day(edge)]
        if day is not None
    )


def test_a_job_does_not_end_on_the_day_a_crawl_ran(edges, within_budget):
    """No employment ends on a day PeopleKRS ran rather than one somebody left.

    Until 5fe9e12b `end_time()` in `scrapers/krs/list.py` read rejestr.io's
    `data_koniec` with the run's own date as the default, so every post the
    register listed as current came out of that run ending on the day it ran.
    Two runs reached the site: 1,044 edges on the 2026-10-14 export, 825
    ending 2026-04-06 and 219 ending 2026-03-18, and the register, matched to
    the page's person as the migration matches it, lists 845 of those posts as
    current. The ingest never rewrites a stored end, so nothing repairs them by
    itself - the night only reports them as `dropped`.

    `frontend/scripts/migrate/clear-crawl-stamp-job-ends.ts` puts back the
    register's answer on 991 of them. The rest it lists for a reviewer by id.
    """
    # 1,043 live on the 2026-10-14 export, before the migration. After it, 52
    # by its dry run against that export: 45 the register has no row for (33
    # spells from before 05-05 under another role or start, 9 pages linking a
    # rejestr.io entry other than the one whose row fits, 3 people the register
    # does not place at the company), 5 old spells whose person's open spell
    # has no edge, 1 contributor's proposal clearing the end that waits at
    # /admin/rewizje, and the 1 post the register really ends on 2026-03-18.
    # Lower it as reviewers resolve them; a re-run of the migration against a
    # newer register picks up any its rows now answer.
    STAMPED_ENDS = 52

    stamped = sorted(
        edge["id"]
        for edge in edges
        if edge.get("type") == "employed"
        and not is_removed(edge)
        and end_day(edge) in CRAWL_STAMPS
    )

    assert within_budget(len(stamped), STAMPED_ENDS), (
        f"{len(stamped)} employment edges end on a day PeopleKRS ran "
        f"({', '.join(CRAWL_STAMPS)}) rather than one the register gives, up "
        f"from the {STAMPED_ENDS} known ones. Run "
        f"scripts/migrate/clear-crawl-stamp-job-ends.ts. Sample: {sample(stamped)}"
    )


def test_no_day_ends_a_hundred_jobs(edges):
    """No single day since 2026-01-01 ends a hundred employments.

    The check that would have caught the crawl stamps, and catches the next
    one: a writer filling in a clock's date for a blank end puts every open
    post it touches on one day. Before the migration the two stamps held 824
    and 219 live edges; no other day of 2026 holds more than 13 (2026-07-07 on
    the 2026-10-14 export), and none since records began reaches 50 - the
    busiest real day is 2024-04-12, with 46 ends at 20 companies. Days before
    2026 are left out: a run that stamped then would have been seen by now,
    and a company wound up with its whole board is a real day.
    """
    SINCE = "2026-01-01"
    BULK = 100

    bulk = {
        day: count
        for day, count in job_ends_by_day(edges).items()
        if day >= SINCE and count >= BULK
    }

    assert not bulk, (
        f"{sum(bulk.values())} employment edges end on {len(bulk)} days that "
        f"each end {BULK} or more, which no register does - a writer is "
        f"stamping a clock's date as the end of every post it reads: "
        f"{sorted(bulk.items())}"
    )


# --------------------------------------------------------------------------- #
# revisions                                                                    #
# --------------------------------------------------------------------------- #


def test_revision_node_id_is_a_document_id(revisions, within_budget):
    """`node_id` has to be a plain id string, not a document reference.

    `/api/revisions/byNode` finds a document's history with
    `where("node_id", "==", nodeId)`, passing the id as a string. Firestore
    compares a reference field to a string as unequal, so a revision stored with
    a reference never comes back: the document's history looks empty and the
    change cannot be approved through the UI.
    """
    # None on the export of 2026-10-25T03:00Z. There were 1114, all from the
    # December 2025 backfill in src/scripts/create_revisions.py, which wrote
    # `source_ref.document(doc.id)` where the frontend writes `targetRef.id`,
    # until scripts/migrate/archive/repair-migrated-revisions.ts rewrote them.
    # The script is fixed too, so nothing new joins them.
    MIGRATION_REVISIONS = 0

    references = [
        revision["id"]
        for revision in revisions
        if is_reference(revision.get("node_id"))
    ]

    assert within_budget(len(references), MIGRATION_REVISIONS), (
        f"{len(references)} revisions store node_id as a document reference "
        f"rather than an id, so /api/revisions/byNode cannot find them - up "
        f"from the {MIGRATION_REVISIONS} known ones. "
        f"Sample IDs: {sample(references)}"
    )


def test_every_revision_belongs_to_a_document(
    revisions, node_ids, snapshot, within_budget
):
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

    assert within_budget(len(orphaned), ORPHANED_REVISIONS), (
        f"{len(orphaned)} revisions describe a node or edge that no longer "
        f"exists, up from the {ORPHANED_REVISIONS} known ones. "
        f"Sample IDs: {sample(orphaned)}"
    )


# How the revision checks tell which revisions were written over their document,
# and when. Written for `test_a_later_revision_never_drops_a_field` and shared
# with the checks that replay a document's history the same way.
#
# When the last backend took a73fb7c2, after which publishing an edge
# approves only a revision the edge already holds: prod's rollout of
# f0a02878 went live at this time (UTC). autopush built it at 18:57 on
# 10-09, after the last of the 23 (18:31 that day).
PUBLISHING_STOPPED_FAKING = "2026-10-10T21:29:35"


def approved_by_publishing(revision: dict) -> bool:
    """Whether publishing stamped the revision approved without writing it.

    That is every edge proposal approved before the fix: not one edge
    proposal was applied through /api/revisions/approve before then, and
    none could be approved by publishing after it, since a proposal is not
    what its edge holds. A node proposal is applied when it is approved.
    Once scripts/migrate/repair-unapplied-proposal-approvals.ts has run on
    prod they are pending again, and this matches nothing.
    """
    return (
        revision.get("status") == "approved"
        and revision.get("collection") == "edges"
        and str(revision.get("id", "")).startswith("proposal_")
        and timestamp_key(revision.get("review_time")) < PUBLISHING_STOPPED_FAKING
    )


def applied(revision: dict) -> bool:
    """Whether the revision was written over its document.

    An approved one was, unless publishing approved it. So was an automatic
    one when it was filed, whatever its status says, unless it is a
    `proposal_` one, which files without writing. A revision with no status
    predates statuses (August 2026) and is taken as applied, which is what
    `test_a_later_revision_never_drops_a_field` assumed of every revision
    before. A document's first revision also created it, pending or not,
    which this does not say: a check that replays a history starts from that
    revision itself (`replay`).
    """
    if approved_by_publishing(revision):
        return False
    if revision.get("status") in (None, "approved"):
        return True
    return revision.get("update_automatic") is True and not str(
        revision.get("id", "")
    ).startswith("proposal_")


def applied_at(revision: dict) -> str:
    """When the revision was written over its document, as a sortable stamp.

    An approved revision was written when it was approved: `applyRevision`
    sets the document and stamps `review_time` in one batch. Anything else
    that was applied was applied as it was filed, and one that was not is
    placed where it was filed, to be compared with the page it was offered
    against.
    """
    if (
        revision.get("status") == "approved"
        and revision.get("review_time")
        and not approved_by_publishing(revision)
    ):
        return timestamp_key(revision["review_time"])
    return timestamp_key(revision.get("update_time"))


def filed_at(revision: dict) -> str:
    """When the revision was filed, as a sortable stamp."""
    return timestamp_key(revision.get("update_time"))


def replay(history: list[dict]) -> list[dict]:
    """A document's revisions in the order they were written over it.

    It starts from the first one filed, which created the document - as a
    pending revision if it was approved later, since it was one until then.
    `applyRevision` wrote it over the page again when it was approved, so it
    comes back at that point, approved.
    """
    created = min(history, key=filed_at)
    rest = [revision for revision in history if revision is not created]
    if applied_at(created) > filed_at(created):
        return [
            {**created, "status": "pending"},
            *sorted([*rest, created], key=applied_at),
        ]
    return [created, *sorted(rest, key=applied_at)]


def test_a_later_revision_never_drops_a_field(revisions, within_budget):
    """A revision is a whole snapshot, so it must not lose an earlier field.

    `createRevisionTransaction` writes the revision's `data` over the node with
    `set`, not `merge`: whatever the revision leaves out is erased from the
    node. An endpoint that only knows some of the fields therefore has to layer
    them over `baseNodeFields` first, and a revision that skipped that step
    silently deletes everything it did not know about.

    What a revision replaces is the page as the last applied revision left it,
    so that is what each one is compared with. A pending or rejected proposal
    never was the page: next to it a later revision drops nothing. Compared
    with it, the count went from 17 to 52 overnight on 2026-10-07, when the
    partiesSource backfill stamped 143 pending proposals and every revision
    written after one of them seemed to lose the field.

    And the page a revision replaced is the one standing when it was *applied*,
    which for an approved revision is when it was approved - `applyRevision`
    writes it then, whenever it was filed. Ordered by filing instead, a proposal
    approved after the people import's revision of that page reads as the page
    the import's revision replaced. Two did on 2026-10-09: Bartosz Zawieja's,
    filed on 10-07 a minute before a people import's revision of his page and
    approved on 10-09, and Wojciech Bochnak's, filed six minutes before a
    one-person import of his page that morning and approved an hour and a half
    after it. The evening's hand run of the night held its upload on the "loss"
    of `partiesSource`, `content` and `education` that both pages still carry.

    A page's first revision is the exception, being written twice: filed, it
    created the page, and approved later, it was written over the page again.
    Ordered by its approval alone it came after the proposals filed while it
    waited, and the first of those, which never was the page, stood in for the
    page it had created. Four of Wojciech Prokocki's candidacies for Powiat
    bartoszycki did on the 2026-10-15 export: created on 06-01, a committee
    proposed for each on 09-28 and still pending, and the creating revisions
    approved with his page on 10-14. Each then seemed to drop the `committee`
    that none of the four edges has ever had, and the night held its upload.

    Nor was an edge proposal that publishing marked approved ever the page.
    Until prod took a73fb7c2, `publishEdgeInBatch` pointed a draft edge at its
    newest revision and stamped that approved, writing only `published` and
    `revision_id`, and the newest was often a proposal, which the edge never
    holds. All 23 edge proposals marked approved on the 2026-10-11 export got
    it that way, each with a `publish` audit row within a millisecond, and
    not one is on its edge. The night of 10-10 wrote to two of Michał Rado's
    candidacies (WQ6rgpfnBmCxk3GdUEpw, hXj75PkY7O5jf4RI8qSP) whose approval of
    that kind was a contributor's correction of 09-06 dating each to its
    election day. Read as their page, the import's revisions seemed to lose an
    `end_date` that neither edge has ever had, and the 10-11 night failed on it.
    """
    # One article, oYkxDlD1KfkO96p6PIwK, whose January 2026 edit lost the
    # `estimates` field the previous revision carried. It is still on the node
    # only because that revision was never approved; approving it would run the
    # `set` and drop the field for good. One more from August 2026, applied:
    # `shortName` lost from article 0XrffRWh3d3es3ZYjAm4 by
    # migration:backfill-article-dates. Two others were misreadings. An
    # upload's revision of Anna Derlukiewicz (enSvS2jSoLIqQmwUdy9I) without the
    # `content` of the one filed before it: that one was approved on 08-30, the
    # day after the upload, and the content is on her page. And the removal of
    # election edge Gm2XbS1oTAmdH7GP1yEi as a duplicate on 08-30, which "lost"
    # a `committee` that publishing had marked approved 15 seconds earlier
    # without writing it to the edge.
    KNOWN_DROPS = 2

    # Bookkeeping the node owns rather than the revision, from
    # server/utils/revisions.ts's INTERNAL_FIELDS. They are regenerated or
    # maintained elsewhere, so a revision is right not to carry them. Narrower
    # than the module's INTERNAL_FIELDS on purpose, as KNOWN_DROPS was counted
    # with it: losing `published`, `merged_into`, `needs_split` or
    # `content_changed_at` still counts here.
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

    # backfill-parties-source.ts (2026-10-06) stamped `partiesSource` into the
    # pending human revisions after the fact, a page's creating one among them,
    # and gave the page the field through a revision of its own. So a pending
    # revision standing for the page it created does not say the page had it.
    stamped_later = {"partiesSource"}

    dropped = []
    for document_id, history in by_document.items():
        page = None
        for revision in replay(history):
            if page is not None:
                unknown = stamped_later if page.get("status") == "pending" else set()
                lost = {
                    field
                    for field, value in page["data"].items()
                    if field not in internal
                    and field not in unknown
                    and value not in (None, "", [], {})
                    and field not in revision["data"]
                }
                if lost:
                    dropped.append(
                        (document_id, page["id"], revision["id"], sorted(lost))
                    )
            if page is None or applied(revision):
                page = revision

    assert within_budget(len(dropped), KNOWN_DROPS), (
        f"{len(dropped)} revisions drop a field the page they replace had, which "
        f"erases it from the node once approved - up from the {KNOWN_DROPS} "
        f"known ones. As (document, applied before it, revision, lost fields): "
        f"{sample(dropped, 5)}"
    )


def party_list(value) -> list[str]:
    """The parties a stored `parties` field lists, in a comparable order.

    A list, or the numbered map the old `sanitizeFirestoreData` made of one
    (`test_array_fields_are_stored_as_arrays`); anything else lists none.
    """
    if isinstance(value, dict):
        value = list(value.values())
    if not isinstance(value, list):
        return []
    return sorted(str(party) for party in value if party)


def test_a_party_list_a_person_pinned_is_changed_only_by_a_person(
    nodes, revisions, snapshot, within_budget
):
    """Once a person has set a page's parties, only a person changes them.

    `partiesSource: "manual"` is the pin: the list was typed in or confirmed by
    somebody, rather than worked out from the registers, and the people import
    leaves a pinned list alone. Before the pin existed it did not, and a robot
    widening a list a person had set was the defect. Read with a person's own
    revision of the list as the pin, this check flags 31 revisions on the
    2026-10-25 export: 15 lists an upload or a merge widened between
    2026-08-18 and 10-06, Delewicz, Piętniewicz, Szymanek, Sobczak, Zaczyński,
    Huzarski, Barczyk and Bujak among them, and the 16 revisions of
    backfill-parties-source.ts that narrowed 14 of those back on 10-06, pinned,
    and emptied 2 others.

    So after an applied revision that pins the list, no applied revision may
    state a different one unless a person wrote it. A robot is an automatic
    revision, a `migration:` one, or one written within 10 s of a merge into
    the page: `carriedFields` in server/utils/merge.ts still unions the
    tombstone's parties into the survivor, pinned or not, and files that under
    the admin who merged. The window is open on both sides, as that revision is
    stamped just before the merge's audit entry, in the same request.

    A page's history is replayed as the drop check replays it (`replay`), from
    the revision that created the page, so a draft a person made with a pinned
    list is pinned from its first revision while that one still waits. One
    filed before 10-06 and still waiting pins it only from when
    backfill-parties-source.ts ran, as that stamped the pin into it after the
    fact (the drop check's `stamped_later`).

    The revision that sets the pin is not judged, so a robot that pinned a
    list it changed in the same write is outside this check, as
    backfill-parties-source.ts was when it emptied the lists a contributor had
    stated in February on Olkiewicz (raqQZJO5CAbtU18aBmsx) and Myszko
    (ExeCUCt1Ik5tFOD4tshJ). A revision that leaves `parties` out is passed
    over, and one that takes `partiesSource` off unpins the page from there
    on: both are the drop check's (`test_a_later_revision_never_drops_a_field`)
    to catch, so a migration taking pins off has to be accounted for there.
    """
    # None on the 2026-10-25T03:00:33.098Z export, nor on the 10-24 one: the
    # guard has held since the pins were stamped. The replay sees every page
    # pinned on the node pinned too: 662 on 10-25, 650 on 10-24.
    KNOWN_CHANGED = 0

    # The last write of migration:backfill-parties-source, 2026-10-06 (UTC).
    PARTIES_SOURCE_BACKFILLED = "2026-10-06T10:34:26"

    def instant(value) -> datetime.datetime | None:
        """A stored timestamp as a naive UTC datetime, or None if it has none."""
        try:
            moment = datetime.datetime.fromisoformat(timestamp_key(value))
        except ValueError:
            return None
        if moment.tzinfo is not None:
            moment = moment.astimezone(datetime.UTC).replace(tzinfo=None)
        return moment

    merged_at: dict[str, list[datetime.datetime]] = collections.defaultdict(list)
    for entry in snapshot.collection("audit"):
        merge = entry.get("merge")
        into = merge.get("into") if isinstance(merge, dict) else None
        at = instant(entry.get("at"))
        if entry.get("action") == "merge" and into and at:
            merged_at[reference_id(into) or ""].append(at)

    people = {
        document["id"]
        for document in nodes
        if document.get("type") == "person" and not is_removed(document)
    }
    by_document: dict[str, list[dict]] = collections.defaultdict(list)
    for revision in revisions:
        document_id = reference_id(revision.get("node_id"))
        if document_id in people and isinstance(revision.get("data"), dict):
            by_document[document_id].append(revision)

    def by_a_robot(revision: dict, page_id: str) -> bool:
        if revision.get("update_automatic") is True:
            return True
        if str(revision.get("update_user") or "").startswith("migration:"):
            return True
        written = instant(revision.get("update_time"))
        return written is not None and any(
            abs((written - merge).total_seconds()) < 10 for merge in merged_at[page_id]
        )

    def pinned_from(revision: dict) -> str | None:
        """From when the page the revision wrote is pinned, if it is."""
        if revision["data"].get("partiesSource") != "manual":
            return None
        if applied(revision) or filed_at(revision) > PARTIES_SOURCE_BACKFILLED:
            return applied_at(revision)
        return PARTIES_SOURCE_BACKFILLED

    changed = []
    for page_id, history in by_document.items():
        pin, page = None, None
        for position, revision in enumerate(replay(history)):
            if position and not applied(revision):
                continue  # never the page; the first one created it
            if "parties" not in revision["data"]:
                continue
            parties = party_list(revision["data"]["parties"])
            if (
                pin is not None
                and applied_at(revision) >= pin
                and parties != page
                and by_a_robot(revision, page_id)
            ):
                changed.append(
                    (
                        page_id,
                        revision["id"],
                        applied_at(revision)[:10],
                        revision.get("update_user"),
                        page,
                        parties,
                    )
                )
            pin = pinned_from(revision)
            page = parties

    assert within_budget(len(changed), KNOWN_CHANGED), (
        f"{len(changed)} revisions by an upload, a migration or a merge changed a "
        f"party list a person had pinned, up from the {KNOWN_CHANGED} known. As "
        f"(page, revision, applied on, author, pinned list, list it states): "
        f"{sample(changed, 5)}"
    )


def test_revisions_record_who_changed_what_and_when(revisions, within_budget):
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

    assert within_budget(len(incomplete), KNOWN_INCOMPLETE), (
        f"{len(incomplete)} revisions have no update_time or update_user, up "
        f"from the {KNOWN_INCOMPLETE} known one: {sample(incomplete)}"
    )


def test_every_revision_says_whether_a_person_made_it(revisions, within_budget):
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

    assert within_budget(len(flagless), FLAGLESS_REVISIONS), (
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


def test_notes_count_matches_the_notes(notes, nodes, within_budget):
    """`stats.notesCount` says what the node's notes hold.

    It is what the table's notes column and the tagging-progress breakdown
    read, neither of which touches the notes collection.

    Two writers keep it, and they do not count the same thing.
    `computeNodeStats` - /api/stats/computeNodes, which somebody runs by hand -
    counts the *sources* across a node's notes. The `onNoteWritten` trigger in
    `functions/src/notes.ts`, which runs on every note written, counts the
    *notes*. So a node holds whichever count its last writer wrote: on
    2026-10-09, 188 nodes held the source count and 20 the note count - each of
    those 20 with a note written since the last recompute - and not one held
    anything else. Until the two agree, either is a current value, and only a
    count that is neither is stale.

    A node or two is normally behind - the 2026-06-28 export had one - and the
    tolerance is there for that. A larger number means something stopped
    counting, not that a single edit went wrong.
    """
    RECOMPUTE_LAG = 5

    sources_by_node: collections.Counter = collections.Counter()
    notes_by_node: collections.Counter = collections.Counter()
    for note in notes:
        sources = note.get("sources")
        sources_by_node[note.get("nodeId")] += len(sources) if sources else 0
        notes_by_node[note.get("nodeId")] += 1

    wrong = [
        (
            document["id"],
            stored,
            (sources_by_node[document["id"]], notes_by_node[document["id"]]),
        )
        for document in nodes
        if (stored := stats_of(document).get("notesCount", 0))
        not in (sources_by_node[document["id"]], notes_by_node[document["id"]])
    ]

    assert within_budget(len(wrong), RECOMPUTE_LAG, allowance=True), (
        f"{len(wrong)} nodes have a stats.notesCount that is neither the number of "
        f"their notes nor the number of sources in them, more than the "
        f"{RECOMPUTE_LAG} a normal recompute lag explains. "
        f"As (node, stored, (sources, notes)): {sample(wrong, 5)}"
    )
