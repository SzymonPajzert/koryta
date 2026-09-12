"""What `firestore.rules` lets the score uploader do.

The uploader stopped going through the Admin SDK against a deployed site: a
person's account holds no Firestore IAM role, so it writes over the REST API
with their Firebase id token and is judged by the rules instead. That makes the
rules part of the upload path, and the only honest way to check them is to put
them in front of an emulator and try.

The same is now true of what a *person* may write there, which is why the file
has outgrown its title. Odznaki (frontend/shared/badges.ts) are stored as
`badge:<id>` keys inside the ordinary vote document, and a badge becomes public
on three different people supporting it - so "one person, one vote document per
target" stopped being hygiene and became the thing standing between a reader
and a label of their choosing on somebody's page. That is a rules question, and
rules are only ever really answered by an emulator.

Needs the auth and firestore emulators, so it skips without them:

    cd frontend && devns npx firebase emulators:exec --project demo-koryta-pl \\
        --only auth,firestore \\
        "cd ../data/pipelines && .venv/bin/python -m pytest -m e2e \\
            src/tests/e2e/test_vote_rules.py"
"""

import os
import socket

import firebase_admin
import pytest
import requests
from firebase_admin import auth

from entities.composite import PersonScore
from util.firestore import AdminVotes, RestVotes, vote_id

pytestmark = pytest.mark.e2e

FIRESTORE_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
AUTH_HOST = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
#: `emulators:exec --project` and the `firestore.database` in firebase.json.
PROJECT = os.environ.get("GCLOUD_PROJECT", "demo-koryta-pl")
DATABASE = "koryta-pl"

MODEL = "pipeline-rules-test"


def listening(host_port: str) -> bool:
    host, _, port = host_port.rpartition(":")
    try:
        with socket.create_connection((host, int(port)), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module", autouse=True)
def emulators():
    for name, host in (("firestore", FIRESTORE_HOST), ("auth", AUTH_HOST)):
        if not listening(host):
            pytest.skip(f"no {name} emulator on {host}")


def id_token(uid: str, **claims) -> str:
    """A signed-in user carrying `claims`, the way the rules will see them.

    The auth emulator issues unsigned tokens, so this needs no credentials -
    the same custom-token exchange the extractor service does in production.
    """
    os.environ.setdefault("GCLOUD_PROJECT", PROJECT)
    try:
        app = firebase_admin.get_app("rules-test")
    except ValueError:
        app = firebase_admin.initialize_app(
            options={"projectId": PROJECT}, name="rules-test"
        )

    custom_token = auth.create_custom_token(uid, claims, app=app)
    response = requests.post(
        f"http://{AUTH_HOST}/identitytoolkit.googleapis.com/v1/"
        "accounts:signInWithCustomToken",
        params={"key": "emulator"},
        json={"token": custom_token.decode(), "returnSecureToken": True},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["idToken"]


def votes_as(uid: str, **claims) -> RestVotes:
    return RestVotes(
        PROJECT, DATABASE, id_token(uid, **claims), origin=f"http://{FIRESTORE_HOST}"
    )


def score(node_id: str, value: int) -> PersonScore:
    return PersonScore(node_id=node_id, name=node_id, score=value, model=MODEL)


class TestDatascienceMember:
    def test_writes_reads_and_retracts_a_models_scores(self):
        votes = votes_as("analyst", datascience=True)

        votes.apply(MODEL, [score("n1", 5), score("n2", 3)], [])
        assert votes.scores(MODEL) == {"n1": 5, "n2": 3}

        votes.apply(MODEL, [], ["n1", "n2"])
        assert votes.scores(MODEL) == {}

    def test_cannot_vote_in_a_persons_name(self):
        # The claim buys the right to write a model's opinion, not to put a
        # verdict on the site under somebody else's uid.
        votes = votes_as("analyst", datascience=True)

        with pytest.raises(PermissionError):
            votes.apply("aB3xYzHumanLookingUid", [score("n1", 5)], [])

    def test_cannot_disguise_a_vote_as_another_document(self):
        # The document id has to spell out the nodeId and uid it carries,
        # otherwise a write could land on a person's own vote document.
        votes = votes_as("analyst", datascience=True)
        forged = {
            "writes": [
                {
                    "update": {
                        "name": votes.document_name(
                            vote_id("n1", "aB3xYzHumanLookingUid")
                        ),
                        "fields": {
                            "nodeId": {"stringValue": "n1"},
                            "userUid": {"stringValue": MODEL},
                            "categoryVotes": {
                                "mapValue": {
                                    "fields": {"interesting": {"integerValue": "5"}}
                                }
                            },
                        },
                    }
                }
            ]
        }

        response = votes.session.post(f"{votes.documents}:commit", json=forged)

        assert response.status_code == 403, response.text


class TestEveryoneElse:
    def test_a_signed_in_user_without_the_claim_is_refused(self):
        votes = votes_as("passer-by")

        with pytest.raises(PermissionError, match="datascience"):
            votes.apply(MODEL, [score("n1", 5)], [])

    def test_a_person_can_still_cast_their_own_vote(self):
        # The branch the site itself writes through, kept alongside the new one
        # so a change to either is checked against the same emulator.
        votes = votes_as("aB3xYzHumanLookingUid")
        own = {
            "writes": [
                {
                    "update": {
                        "name": votes.document_name(
                            vote_id("n1", "aB3xYzHumanLookingUid")
                        ),
                        "fields": {
                            "nodeId": {"stringValue": "n1"},
                            "userUid": {"stringValue": "aB3xYzHumanLookingUid"},
                            "categoryVotes": {
                                "mapValue": {
                                    "fields": {"interesting": {"integerValue": "5"}}
                                }
                            },
                        },
                    }
                }
            ]
        }

        response = votes.session.post(f"{votes.documents}:commit", json=own)

        assert response.status_code == 200, response.text


class TestLocalStack:
    """The other way in: the Admin SDK, which the emulator asks nothing of."""

    def test_writes_reads_and_retracts_a_models_scores(self):
        os.environ["FIRESTORE_EMULATOR_HOST"] = FIRESTORE_HOST
        votes = AdminVotes(PROJECT, DATABASE)
        model = f"{MODEL}-admin"

        votes.apply(model, [score("n1", 5), score("n2", 3)], [])
        assert votes.scores(model) == {"n1": 5, "n2": 3}

        votes.apply(model, [], ["n1", "n2"])
        assert votes.scores(model) == {}


HUMAN = "aB3xYzHumanLookingUid"


def commit(votes: RestVotes, document_id: str, fields: dict):
    """One REST write of `fields` to `votes/<document_id>`, as the rules see it.

    The same shape the tests above spell out inline, factored out because the
    checks below differ only in the document id and the map they carry, and
    reading three near-identical 20-line literals hides exactly the one line
    that matters in each.
    """
    return votes.session.post(
        f"{votes.documents}:commit",
        json={
            "writes": [
                {
                    "update": {
                        "name": votes.document_name(document_id),
                        "fields": fields,
                    }
                }
            ]
        },
    )


def human_vote(node_id: str, uid: str, category_votes: dict[str, int]) -> dict:
    """A vote document as the browser writes one, in REST field encoding."""
    return {
        "nodeId": {"stringValue": node_id},
        "userUid": {"stringValue": uid},
        "categoryVotes": {
            "mapValue": {
                "fields": {
                    key: {"integerValue": str(value)}
                    for key, value in category_votes.items()
                }
            }
        },
    }


class TestBadgeVotes:
    """A badge vote is a key in the same document, so it is the same rule.

    Odznaki are stored as `badge:<id>` inside the existing `categoryVotes` map
    of `votes/${nodeId}_${uid}` - no collection of its own, see
    `frontend/shared/badges.ts`. That is only sound if the rules on that
    document really do give one person one vote, which is what this class and
    the next one check.
    """

    def test_a_badge_vote_is_a_key_in_the_persons_own_document(self):
        votes = votes_as(HUMAN)

        response = commit(
            votes,
            vote_id("n1", HUMAN),
            human_vote("n1", HUMAN, {"badge:spolecznik": 1}),
        )

        assert response.status_code == 200, response.text

    def test_a_badge_vote_can_be_retracted_with_an_explicit_zero(self):
        # Withdrawing is writing 0, never deleting the key: the aggregation
        # trigger recomputes from the documents it can see, and a key that
        # vanished and a key that was never there are indistinguishable to it,
        # while a 0 is a fact about what this person now thinks. `saneVote` has
        # to admit it, which is why 0 sits in the middle of the allowed list.
        votes = votes_as(HUMAN)

        response = commit(
            votes,
            vote_id("n2", HUMAN),
            human_vote("n2", HUMAN, {"badge:spolecznik": 0}),
        )

        assert response.status_code == 200, response.text


class TestOneDocumentPerPersonAndTarget:
    """The hole `ownsVoteTarget` closes, from the attacker's side.

    Every aggregate over votes - `computeVoteStats`, and now
    `computeBadgeStats` - walks the vote *documents* filed against a node, so
    what counts as "a different person" is a different document. Before this
    rule the human branch checked only that the id ended in the caller's uid,
    so one signed-in reader could file as many documents about one node as they
    liked. With the badge threshold at three net supporters
    (`BADGE_PUBLIC_THRESHOLD`), that is not an inflated counter but a way to
    publish a label of your own choosing on a named person's page.

    Not a hypothetical: run against the previous rules, every write both this
    class and `TestVoteShape` expect to be refused came back 200 from the
    emulator (measured 2026-09-12, same tests, only `firestore.rules` swapped).
    """

    def test_a_second_document_about_the_same_node_is_refused(self):
        votes = votes_as(HUMAN)

        first = commit(
            votes,
            vote_id("n1", HUMAN),
            human_vote("n1", HUMAN, {"badge:spolecznik": 1}),
        )
        assert first.status_code == 200, first.text

        # Same payload, same signed-in person, same node - only the document id
        # is made up. It still ends in the caller's uid, which is all the old
        # rule asked; a second supporter is exactly what it looks like to the
        # aggregate.
        forged = commit(
            votes,
            f"cokolwiek_{HUMAN}",
            human_vote("n1", HUMAN, {"badge:spolecznik": 1}),
        )

        assert forged.status_code == 403, forged.text

    def test_an_extraction_vote_is_pinned_to_its_extraction(self):
        # The other id field, checked the same way: the review flow writes
        # `extractionId` rather than `nodeId` (`castVoteOnce(..., "extraction")`
        # in app/composables/votes.ts), and an id derived from neither is not a
        # vote on anything.
        votes = votes_as(HUMAN)
        fields = {
            "extractionId": {"stringValue": "e1"},
            "userUid": {"stringValue": HUMAN},
            "categoryVotes": {
                "mapValue": {"fields": {"correct": {"integerValue": "1"}}}
            },
        }

        allowed = commit(votes, vote_id("e1", HUMAN), fields)
        refused = commit(votes, vote_id("e2", HUMAN), fields)

        assert allowed.status_code == 200, allowed.text
        assert refused.status_code == 403, refused.text


class TestVoteShape:
    """`categoryVotes` is written by the client, so its shape is the rules' job.

    Nothing between the browser and the stored document validates it: the
    aggregation trigger sums what it finds, and the site reads the sum. The two
    checks here are the two ways one write can cost more than one vote.
    """

    def test_a_value_outside_the_scale_is_refused(self):
        # The UI clamps to -5..5 (`Math.max(-5, Math.min(5, ...))` in
        # `castVote`), which binds the UI and nobody else. A single
        # `interesting: 1e9` would put one person at the top of every list the
        # site sorts by that counter.
        votes = votes_as(HUMAN)

        response = commit(
            votes,
            vote_id("n3", HUMAN),
            human_vote("n3", HUMAN, {"interesting": 1_000_000_000}),
        )

        assert response.status_code == 403, response.text

    def test_more_keys_than_the_catalogue_could_ever_need_are_refused(self):
        # `MAX_VOTE_KEYS` is 40 (frontend/shared/badges.ts) against five
        # categories plus five badges in use. The cost of a fat map is not the
        # document but `onVoteWritten`, which re-reads every vote on the node
        # and rewrites its stats on each subsequent write by anybody.
        votes = votes_as(HUMAN)

        response = commit(
            votes,
            vote_id("n4", HUMAN),
            human_vote(
                "n4", HUMAN, {f"badge:filler-{index}": 1 for index in range(41)}
            ),
        )

        assert response.status_code == 403, response.text


class TestDeletingAVote:
    """Removing one's own vote, which the rules only now actually permit.

    The old branch said `create, update, delete` in one line and tested
    `request.resource.data.userUid`, which on a delete reads a field of null:
    the condition could never be true, so no client has ever deleted a vote.
    The app does not need it either - a withdrawn vote is an explicit 0, see
    `TestBadgeVotes` - so this is not a feature being added but a rule being
    made to mean what it says, on the stored document rather than on a payload
    a delete does not carry.
    """

    def test_a_person_can_remove_their_own_vote(self):
        votes = votes_as(HUMAN)
        written = commit(
            votes,
            vote_id("n5", HUMAN),
            human_vote("n5", HUMAN, {"interesting": 3}),
        )
        assert written.status_code == 200, written.text

        removed = votes.session.post(
            f"{votes.documents}:commit",
            json={"writes": [{"delete": votes.document_name(vote_id("n5", HUMAN))}]},
        )

        assert removed.status_code == 200, removed.text

    def test_a_person_cannot_remove_somebody_elses_vote(self):
        # The whole reason the delete branch reads `resource.data`: the only
        # thing that says whose vote this is, is the document that is already
        # there. A badge one reader disputes must not be removable by the
        # reader who proposed it.
        other = "innyCzytelnikUid"
        theirs = votes_as(other)
        written = commit(
            theirs,
            vote_id("n6", other),
            human_vote("n6", other, {"badge:spolecznik": 1}),
        )
        assert written.status_code == 200, written.text

        mine = votes_as(HUMAN)
        removed = mine.session.post(
            f"{mine.documents}:commit",
            json={"writes": [{"delete": mine.document_name(vote_id("n6", other))}]},
        )

        assert removed.status_code == 403, removed.text
