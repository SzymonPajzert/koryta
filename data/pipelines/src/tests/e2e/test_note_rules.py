"""What `firestore.rules` lets the note uploader do.

`test_vote_rules` makes the case for putting the rules in front of an emulator
rather than reading them: against a deployed site the uploader is a person with
a Firebase id token, so the rules are the write path. Notes need their own file
because they are checked further than votes are - a note is prose that appears
on somebody's page, so the rules look at what it says as well as at who wrote
it.

Needs the auth and firestore emulators, so it skips without them:

    cd frontend && devns npx firebase emulators:exec --project demo-koryta-pl \\
        --only auth,firestore \\
        "cd ../data/pipelines && .venv/bin/python -m pytest -m e2e \\
            src/tests/e2e/test_note_rules.py"
"""

import os

import pytest

from entities.composite import PersonNote
from tests.e2e.test_vote_rules import (  # noqa: F401  (emulators fixture)
    DATABASE,
    FIRESTORE_HOST,
    PROJECT,
    emulators,
    id_token,
)
from util.firestore import (
    AdminNotes,
    RestNotes,
    encode_note,
    note_document,
    note_id,
)

pytestmark = pytest.mark.e2e

UID = "pipeline-wikipedia-rules-test"
LEAD = "Jan Pamuła (ur. 24 czerwca 1951 w Bielsku-Białej) – polski polityk."


def notes_as(uid: str, **claims) -> RestNotes:
    return RestNotes(
        PROJECT, DATABASE, id_token(uid, **claims), origin=f"http://{FIRESTORE_HOST}"
    )


def document(node_id: str, text: str = LEAD, model: str = UID, **overrides) -> dict:
    note = PersonNote(
        node_id=node_id,
        name=node_id,
        url=f"https://pl.wikipedia.org/wiki/{node_id}",
        note=text,
        model=model,
        **overrides,
    )
    return note_document(note, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00")


class TestDatascienceMember:
    def test_writes_reads_and_retracts_a_pipelines_notes(self):
        notes = notes_as("analyst", datascience=True)

        notes.apply(UID, [("n1", document("n1")), ("n2", document("n2"))], [])
        assert set(notes.notes(UID)) == {"n1", "n2"}

        notes.apply(UID, [], ["n1", "n2"])
        assert notes.notes(UID) == {}

    def test_cannot_write_a_note_in_a_persons_name(self):
        # The claim buys the right to write a pipeline's own note, not to put
        # words on the site under somebody else's uid.
        notes = notes_as("analyst", datascience=True)
        human = "aB3xYzHumanLookingUid"

        with pytest.raises(PermissionError):
            notes.apply(human, [("n1", document("n1", model=human))], [])

    def test_cannot_disguise_a_note_as_another_document(self):
        # The document id has to spell out the nodeId and uid it carries, or a
        # write could land on the note a person wrote themselves.
        notes = notes_as("analyst", datascience=True)
        forged = {
            "writes": [
                {
                    "update": {
                        "name": notes.document_name(
                            note_id("n1", "aB3xYzHumanLookingUid")
                        ),
                        "fields": encode_note(document("n1")),
                    }
                }
            ]
        }

        response = notes.session.post(f"{notes.documents}:commit", json=forged)

        assert response.status_code == 403, response.text

    def test_cannot_file_work_for_somebody_else(self):
        # „Do poprawy" and „Brakuje danych" put an entry on a queue a person has
        # to work through. A pipeline writes things to read, not tasks to do.
        notes = notes_as("analyst", datascience=True)

        with pytest.raises(PermissionError):
            notes.apply(UID, [("n1", document("n1", kind="change_request"))], [])

    def test_cannot_triage_its_own_note(self):
        # `adminStatus` is the site's own bookkeeping about an entry, and a
        # writer that could set it would be closing its own note. `encode_note`
        # cannot express one, so the payload is built by hand - which is what
        # somebody bypassing the uploader would do too.
        notes = notes_as("analyst", datascience=True)
        fields = encode_note(document("n1"))
        entry = fields["sources"]["arrayValue"]["values"][0]["mapValue"]["fields"]
        entry["adminStatus"] = {"stringValue": "resolved"}
        triaged = {
            "writes": [
                {
                    "update": {
                        "name": notes.document_name(note_id("n1", UID)),
                        "fields": fields,
                    }
                }
            ]
        }

        response = notes.session.post(f"{notes.documents}:commit", json=triaged)

        assert response.status_code == 403, response.text


class TestEveryoneElse:
    def test_a_signed_in_user_without_the_claim_is_refused(self):
        notes = notes_as("passer-by")

        with pytest.raises(PermissionError, match="datascience"):
            notes.apply(UID, [("n1", document("n1"))], [])

    def test_a_person_can_still_write_their_own_note(self):
        # The branch the site itself writes through, kept alongside the new one
        # so a change to either is checked against the same emulator.
        human = "aB3xYzHumanLookingUid"
        notes = notes_as(human)
        own = {
            "writes": [
                {
                    "update": {
                        "name": notes.document_name(note_id("n1", human)),
                        "fields": encode_note(document("n1", model=human)),
                    }
                }
            ]
        }

        response = notes.session.post(f"{notes.documents}:commit", json=own)

        assert response.status_code == 200, response.text


class TestLocalStack:
    """The other way in: the Admin SDK, which the emulator asks nothing of."""

    def test_writes_reads_and_retracts_a_pipelines_notes(self):
        os.environ["FIRESTORE_EMULATOR_HOST"] = FIRESTORE_HOST
        notes = AdminNotes(PROJECT, DATABASE)
        uid = f"{UID}-admin"

        notes.apply(uid, [("n1", document("n1", model=uid))], [])
        assert set(notes.notes(uid)) == {"n1"}

        notes.apply(uid, [], ["n1"])
        assert notes.notes(uid) == {}
