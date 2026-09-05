"""Writing a pipeline's notes onto people's pages: what changes, and what goes.

`test_score_upload` covers the same reconciliation for votes. Notes get their
own file because two things about them are different, and both are visible to a
reader rather than only to the aggregate: the note carries a date, so a rewrite
that changed nothing would still say the page was revised today, and the note
carries prose, so what goes on the wire is what somebody ends up reading.
"""

import types

import pytest

from entities.composite import PersonNote
from uploader import NoteUploader
from util.firestore import (
    Firestore,
    RestNotes,
    encode_note,
    note_document,
    note_entry,
    note_id,
)

UID = "pipeline-wikipedia"


class FakeNotes:
    """Stands in for the store, whichever way in it was opened.

    `Firestore` decides what to write and what to take back; both backends only
    carry that out, so the decisions are what these tests hold onto.
    """

    def __init__(self, documents: dict[str, dict]):
        self.documents = documents
        self.log: list[tuple[str, str]] = []

    def notes(self, model: str) -> dict[str, dict]:
        return {
            data["nodeId"]: data
            for data in self.documents.values()
            if data["userUid"] == model
        }

    def apply(self, model, changed, stale):
        for node_id, document in changed:
            document_id = note_id(node_id, model)
            self.documents[document_id] = document
            self.log.append(("set", document_id))
        for node_id in stale:
            document_id = note_id(node_id, model)
            self.documents.pop(document_id, None)
            self.log.append(("delete", document_id))


def note(node_id: str, text: str, model: str = UID) -> PersonNote:
    return PersonNote(
        node_id=node_id,
        name=node_id,
        url=f"https://pl.wikipedia.org/wiki/{node_id}",
        note=text,
        model=model,
    )


def stored(
    node_id: str,
    text: str,
    model: str = UID,
    created_at: str = "2026-01-01T00:00:00+00:00",
) -> tuple[str, dict]:
    document = note_document(note(node_id, text, model), created_at, created_at)
    return (note_id(node_id, model), document)


def firestore_with(*documents: tuple[str, dict]) -> Firestore:
    return Firestore(None, notes=FakeNotes(dict(documents)))


class TestReplaceNotes:
    def test_writes_only_what_changed(self):
        # Every note written fires `onNoteWritten`, which recounts the node's
        # notes - and moves the note's date, which a reader is shown. Restating
        # an unchanged paragraph would date every page today.
        client = firestore_with(
            stored("n1", "Jan Pamuła (ur. 1951) – polski polityk."),
            stored("n2", "Stara treść."),
        )

        written, retracted = client.replace_notes(
            UID,
            [
                note("n1", "Jan Pamuła (ur. 1951) – polski polityk."),
                note("n2", "Nowa treść."),
            ],
        )

        assert (written, retracted) == (1, 0)
        assert client.notes.log == [("set", f"n2_{UID}")]

    def test_a_rewrite_keeps_the_date_the_note_was_first_written(self):
        # What a reader is shown, and what the admin queue orders by. An edit
        # is an edit, not a new note.
        client = firestore_with(
            stored("n1", "Stara treść.", created_at="2026-01-01T00:00:00+00:00")
        )

        client.replace_notes(UID, [note("n1", "Nowa treść.")])

        document = client.notes.documents[f"n1_{UID}"]
        assert document["createdAt"] == "2026-01-01T00:00:00+00:00"
        assert document["updatedAt"] != document["createdAt"]

    def test_a_page_that_no_longer_qualifies_loses_the_note(self):
        # The Wikipedia link was corrected, or the dates of birth stopped
        # agreeing. A claim the pipeline can no longer make must not stay
        # readable on somebody's page.
        client = firestore_with(stored("gone", "Cudza biografia."))

        written, retracted = client.replace_notes(UID, [note("kept", "Właściwa.")])

        assert (written, retracted) == (1, 1)
        assert f"gone_{UID}" not in client.notes.documents

    def test_nobody_elses_note_on_the_page_is_touched(self):
        client = firestore_with(
            stored("n1", "Z Wikipedii."),
            stored("n1", "Ktoś to napisał.", model="aB3xYzHumanLookingUid"),
        )

        client.replace_notes(UID, [])

        documents = client.notes.documents
        assert f"n1_{UID}" not in documents
        assert "n1_aB3xYzHumanLookingUid" in documents

    def test_a_partial_upload_retracts_nothing(self):
        client = firestore_with(stored("n1", "Pierwsza."))

        written, retracted = client.replace_notes(
            UID, [note("n2", "Druga.")], retract=False
        )

        assert (written, retracted) == (1, 0)
        assert f"n1_{UID}" in client.notes.documents

    def test_a_note_is_one_entry_of_kind_source(self):
        # `firestore.rules` refuses anything else, and the reason is in the
        # shape: a correction or a gap is an entry somebody has to act on, and
        # a robot does not get to file work for a person that way.
        client = firestore_with()

        client.replace_notes(UID, [note("n1", "Jan Pamuła – polski polityk.")])

        (entry,) = client.notes.documents[f"n1_{UID}"]["sources"]
        assert entry == {
            "url": "https://pl.wikipedia.org/wiki/n1",
            "note": "Jan Pamuła – polski polityk.",
            "kind": "source",
        }


class TestModelOf:
    """A note filed under a human-looking uid would be counted as review."""

    def uploader(self, model: str | None = None) -> NoteUploader:
        # Built without `__init__`, which would log in to something.
        # `uploader.Args` is a bare annotated class rather than a dataclass, so
        # it takes no keywords and a namespace stands in for it.
        uploader = NoteUploader.__new__(NoteUploader)
        uploader.args = types.SimpleNamespace(  # type: ignore[assignment]
            endpoint="http://localhost:3000",
            submit=True,
            type="note",
            database="koryta-pl",
            limit=None,
            offset=None,
            model=model,
        )
        return uploader

    def test_refuses_a_uid_that_does_not_read_as_a_pipeline(self):
        with pytest.raises(ValueError, match="pipeline"):
            self.uploader().model_of([note("n1", "treść", model="aB3xYz")])

    def test_refuses_a_run_carrying_two_uids(self):
        with pytest.raises(ValueError, match="one uid"):
            self.uploader().model_of(
                [note("n1", "a"), note("n2", "b", model="pipeline-other")]
            )

    def test_the_flag_overrides_what_the_rows_carry(self):
        assert (
            self.uploader("pipeline-other").model_of(
                [note("n1", "a"), note("n2", "b", model="pipeline-else")]
            )
            == "pipeline-other"
        )


class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = str(payload)

    def json(self):
        return self.payload


class FakeSession:
    """Records what the REST backend puts on the wire."""

    def __init__(self, *responses: FakeResponse):
        self.headers: dict[str, str] = {}
        self.responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json))
        return self.responses.pop(0) if self.responses else FakeResponse({})


def rest_with(session: FakeSession) -> RestNotes:
    notes = RestNotes.__new__(RestNotes)
    notes.collection = "projects/p/databases/d/documents"
    notes.documents = f"https://firestore.example/v1/{notes.collection}"
    notes.session = session  # type: ignore[assignment]
    return notes


class TestRestNotes:
    """The wire format, which is the part `firestore.rules` is judging."""

    def test_writes_a_note_under_the_pipelines_uid(self):
        session = FakeSession()
        document = note_document(
            note("n1", "Jan Pamuła – polski polityk."), "2026-01-01", "2026-02-01"
        )

        rest_with(session).apply(UID, [("n1", document)], [])

        url, body = session.calls[0]
        assert url.endswith(":commit")
        (write,) = body["writes"]
        # The document id spells out the node and the uid, which is what stops
        # this branch from writing a note in somebody else's name.
        assert write["update"]["name"].endswith(f"/notes/n1_{UID}")
        assert write["update"]["fields"]["sources"] == {
            "arrayValue": {
                "values": [
                    {
                        "mapValue": {
                            "fields": {
                                "url": {
                                    "stringValue": "https://pl.wikipedia.org/wiki/n1"
                                },
                                "note": {"stringValue": "Jan Pamuła – polski polityk."},
                                "kind": {"stringValue": "source"},
                            }
                        }
                    }
                ]
            }
        }
        # Every field, so a rewrite replaces the note rather than merging into
        # it - `sources` is one field, and an entry the previous version held
        # and this one does not has to go with it.
        assert set(write["updateMask"]["fieldPaths"]) == {
            "nodeId",
            "userUid",
            "createdAt",
            "updatedAt",
            "sources",
        }

    def test_reads_back_what_the_uid_already_holds(self):
        document = note_document(
            note("n1", "Zapisana treść."), "2026-01-01", "2026-01-01"
        )
        session = FakeSession(
            FakeResponse(
                [
                    # The stream opens with a result that carries no document.
                    {"readTime": "2026-08-16T00:00:00Z"},
                    {
                        "document": {
                            "name": f".../notes/n1_{UID}",
                            "fields": encode_note(document),
                        }
                    },
                ]
            )
        )

        stored_notes = rest_with(session).notes(UID)

        # Round-trips to the same thing `replace_notes` compares against, which
        # is what keeps an unchanged note from being rewritten every night.
        assert note_entry(stored_notes["n1"]) == note_entry(document)
        assert stored_notes["n1"]["createdAt"] == "2026-01-01"
        condition = session.calls[0][1]["structuredQuery"]["where"]["fieldFilter"]
        assert condition["field"]["fieldPath"] == "userUid"
        assert condition["value"]["stringValue"] == UID
