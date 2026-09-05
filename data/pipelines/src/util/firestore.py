"""Where a pipeline's own writes to Firestore go, and what is allowed to make them.

Two collections, and both are the same problem: a robot holds an opinion about
a set of people, and the run has to make what is stored match it. Votes are a
score per person (`VoteStore`); notes are a paragraph per person
(`NoteStore`). Everything else the pipelines write is a fact about somebody and
goes through an ingest endpoint as a revision instead.

Two ways in, because the two contexts hold different credentials:

* Against a local stack the emulator trusts anybody, so the Admin SDK writes
  straight through and `firestore.rules` never runs.
* Against a deployed site the uploader is a person - whoever is running
  `submit_scores.sh` - and the credentials at hand are the Firebase id token
  from the same browser login every other `--type` uses. A person's Google
  account holds no Firestore IAM role, only the deploy service accounts do, so
  the Admin SDK's application-default path answers `403 Missing or insufficient
  permissions`. The REST API given an id token is evaluated against
  `firestore.rules` instead, and those admit a member of the datascience group
  writing a pipeline's votes and a pipeline's notes.

Set `KORYTA_ID_TOKEN` to skip the browser login and present an id token
directly - what a service holding its own datascience account would do, and
what the tests do against the emulator. The login itself is passed in by the
caller: it lives in `stores.auth`, which this layer may not import.
"""

import os
import sys
import typing
from datetime import datetime, timezone

import firebase_admin
import requests
from firebase_admin import firestore

from entities.composite import PersonNote, PersonScore

#: Asks whoever is running the upload to sign in, and returns their id token.
Login = typing.Callable[[], str]

#: Firestore takes at most 500 operations in one batch, REST commit included.
BATCH_LIMIT = 500

FIRESTORE_ORIGIN = "https://firestore.googleapis.com"

#: A full reconciliation reads back every document the uid holds, tens of
#: thousands of them in one response.
QUERY_TIMEOUT_S = 300
COMMIT_TIMEOUT_S = 120


class VoteStore(typing.Protocol):
    """The two operations reconciling a model's scores needs of Firestore."""

    def scores(self, model: str) -> dict[str, int]:
        """Node id -> the score this model last wrote, for the whole model."""
        ...

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        """Write these scores and retract the scores on these node ids."""
        ...


class NoteStore(typing.Protocol):
    """The two operations reconciling a pipeline's notes needs of Firestore.

    Documents rather than entities, because unlike a score a note carries
    bookkeeping the store has no opinion about - when it was first written,
    which has to survive an edit. `Firestore.replace_notes` builds them; this
    only carries them.
    """

    def notes(self, model: str) -> dict[str, dict]:
        """Node id -> the note document this uid last wrote, for the whole uid."""
        ...

    def apply(
        self, model: str, changed: list[tuple[str, dict]], stale: list[str]
    ) -> None:
        """Write these (node id, document) pairs, delete the notes on these ids."""
        ...


def batched(items: list, size: int = BATCH_LIMIT):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def vote_id(node_id: str, user_uid: str) -> str:
    return f"{node_id}_{user_uid}"


def vote_document(node_id: str, model: str, score: float) -> dict:
    return {
        "nodeId": node_id,
        "userUid": model,
        "categoryVotes": {"interesting": score},
    }


def note_id(node_id: str, user_uid: str) -> str:
    """The one note each author may hold on a page.

    The same `<nodeId>_<uid>` the browser writes under - see `saveNote` in
    `frontend/app/composables/notes.ts` - which is what makes "one note per
    person per page" a property of the key rather than something a query has to
    enforce, and what `firestore.rules` checks the payload against.
    """
    return f"{node_id}_{user_uid}"


def note_document(note: PersonNote, created_at: str, updated_at: str) -> dict:
    """A `PersonNote` in the shape the site stores and the card draws.

    One entry in `sources`, because a pipeline says one thing about a person; a
    second thing would be a second uid. `kind` is deliberately stated rather
    than left to default: an entry with no kind reads as a source anyway, but
    the value is what keeps the note off the admin queue and that should be
    visible in the document rather than inferred from its absence.

    `createdAt` is passed in rather than taken as "now" so that rewriting a
    note keeps the date it was first written, the way a contributor editing
    theirs does.
    """
    return {
        "nodeId": note.node_id,
        "userUid": note.model,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "sources": [{"url": note.url, "note": note.note, "kind": note.kind}],
    }


def note_entry(document: dict) -> tuple[str, str, str]:
    """What a note actually says, for telling two versions of one apart.

    The timestamps are excluded on purpose: an unchanged paragraph re-stated by
    tonight's run is not an edit, and writing it would fire `onNoteWritten` and
    move the note's date for nothing.
    """
    sources = document.get("sources") or [{}]
    first = sources[0] if sources else {}
    return (
        str(first.get("url") or ""),
        str(first.get("note") or ""),
        str(first.get("kind") or "source"),
    )


def admin_client(project_id: str | None, database_id: str):
    """The Admin SDK pointed at a database, under one app for the whole run.

    Named rather than default, and reused rather than re-initialised: a run
    that uploads scores and notes opens this twice, and `initialize_app` raises
    on a name it already knows.
    """
    options = {"projectId": project_id} if project_id else {}
    try:
        app = firebase_admin.get_app("uploader")
    except ValueError:
        app = firebase_admin.initialize_app(options=options, name="uploader")
    return firestore.client(app=app, database_id=database_id)


class AdminVotes:
    """Writes as the project itself, bypassing rules. Local stacks only.

    The emulator asks for no credentials at all, which is what makes this the
    path for a dev stack: no browser login in the middle of a pipeline run.
    """

    def __init__(self, project_id: str | None, database_id: str):
        self.db = admin_client(project_id, database_id)

    def scores(self, model: str) -> dict[str, int]:
        query = self.db.collection("votes").where(
            filter=firestore.FieldFilter("userUid", "==", model)
        )
        existing = {}
        for doc in query.stream():
            data = doc.to_dict() or {}
            node_id = data.get("nodeId")
            interesting = (data.get("categoryVotes") or {}).get("interesting")
            if node_id and interesting is not None:
                existing[node_id] = interesting
        return existing

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        collection = self.db.collection("votes")
        writes: list = [(score.node_id, score.score) for score in changed]
        writes += [(node_id, None) for node_id in stale]

        written = 0
        for chunk in batched(writes):
            batch = self.db.batch()
            for node_id, score in chunk:
                reference = collection.document(vote_id(node_id, model))
                if score is None:
                    batch.delete(reference)
                else:
                    batch.set(
                        reference, vote_document(node_id, model, score), merge=True
                    )
            batch.commit()
            written += len(chunk)
            if written < len(writes):
                print(f"  committed {written}...", file=sys.stderr)


class AdminNotes:
    """`AdminVotes`, for the notes collection. Local stacks only.

    Shares its app so a run that uploads both does not initialise the SDK
    twice.
    """

    def __init__(self, project_id: str | None, database_id: str):
        self.db = admin_client(project_id, database_id)

    def notes(self, model: str) -> dict[str, dict]:
        query = self.db.collection("notes").where(
            filter=firestore.FieldFilter("userUid", "==", model)
        )
        stored = {}
        for doc in query.stream():
            data = doc.to_dict() or {}
            node_id = data.get("nodeId")
            if node_id:
                stored[node_id] = data
        return stored

    def apply(
        self, model: str, changed: list[tuple[str, dict]], stale: list[str]
    ) -> None:
        collection = self.db.collection("notes")
        writes: list[tuple[str, dict | None]] = list(changed)
        writes += [(node_id, None) for node_id in stale]

        written = 0
        for chunk in batched(writes):
            batch = self.db.batch()
            for node_id, document in chunk:
                reference = collection.document(note_id(node_id, model))
                if document is None:
                    batch.delete(reference)
                else:
                    # Not merged: the document is this uid's whole opinion of
                    # the page, so a field an earlier version wrote and this
                    # one does not is meant to go.
                    batch.set(reference, document)
            batch.commit()
            written += len(chunk)
            if written < len(writes):
                print(f"  committed {written}...", file=sys.stderr)


class RestCollection:
    """One Firestore collection, addressed over REST as the signed-in person.

    The id token is what the rules see, and going through them rather than
    around them is the point: `request.auth.token.datascience` has to be true,
    and each document has to read as the pipeline's own. Nothing written this
    way can be filed under a person's uid.

    Subclasses set `collection_id` and say what a document of theirs means.
    """

    #: The collection under `documents/` this speaks to.
    collection_id: str

    def __init__(
        self,
        project_id: str,
        database_id: str,
        id_token: str,
        origin: str = FIRESTORE_ORIGIN,
    ):
        # A write names its document by resource path, which is not the URL the
        # request goes to - Firestore refuses one given in place of the other.
        self.collection = f"projects/{project_id}/databases/{database_id}/documents"
        self.documents = f"{origin}/v1/{self.collection}"
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {id_token}"

    def document_name(self, document_id: str) -> str:
        return f"{self.collection}/{self.collection_id}/{document_id}"

    def by_uid(self, model: str) -> list[dict]:
        """Every document in the collection filed under this uid, as REST fields.

        One equality query on `userUid`, which the automatic single-field index
        covers, so it never reads another uid's documents.
        """
        query: dict[str, typing.Any] = {
            "structuredQuery": {
                "from": [{"collectionId": self.collection_id}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": "userUid"},
                        "op": "EQUAL",
                        "value": {"stringValue": model},
                    }
                },
            }
        }
        response = self.session.post(
            f"{self.documents}:runQuery", json=query, timeout=QUERY_TIMEOUT_S
        )
        self.check(response, f"reading {model}'s {self.collection_id}")

        documents = []
        for result in response.json():
            fields = (result.get("document") or {}).get("fields")
            # A result carrying no document is a keep-alive from the streamed
            # response, not a stored document.
            if fields:
                documents.append(fields)
        return documents

    def commit(self, writes: list[dict], what: str) -> None:
        """Send the writes in batches Firestore will accept."""
        written = 0
        for chunk in batched(writes):
            response = self.session.post(
                f"{self.documents}:commit",
                json={"writes": chunk},
                timeout=COMMIT_TIMEOUT_S,
            )
            self.check(response, f"writing {len(chunk)} of {what}")
            written += len(chunk)
            if written < len(writes):
                print(f"  committed {written}...", file=sys.stderr)

    @staticmethod
    def check(response: requests.Response, what: str) -> None:
        if response.ok:
            return
        if response.status_code == 403:
            raise PermissionError(
                f"Firestore refused {what}: {response.text}\n"
                "Uploading a pipeline's own writes needs the `datascience` "
                "claim on the account you logged in as - the same one "
                "/ekstrakcje requires."
            )
        raise RuntimeError(
            f"Firestore failed {what}: {response.status_code} {response.text}"
        )


class RestVotes(RestCollection):
    """A scoring model's votes, written as the signed-in person.

    Each document has to read as a model's own vote, which is what stops this
    from being a way to vote in somebody else's name.
    """

    collection_id = "votes"

    def scores(self, model: str) -> dict[str, int]:
        existing = {}
        for fields in self.by_uid(model):
            node_id = fields.get("nodeId", {}).get("stringValue")
            categories = fields.get("categoryVotes", {}).get("mapValue", {})
            interesting = categories.get("fields", {}).get("interesting")
            if node_id and interesting is not None:
                existing[node_id] = number(interesting)
        return existing

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        writes: list[dict] = [
            {
                "update": {
                    "name": self.document_name(vote_id(score.node_id, model)),
                    "fields": {
                        "nodeId": {"stringValue": score.node_id},
                        "userUid": {"stringValue": model},
                        "categoryVotes": {
                            "mapValue": {
                                "fields": {
                                    "interesting": {
                                        "integerValue": str(int(score.score))
                                    }
                                }
                            }
                        },
                    },
                },
                # The Admin SDK's `merge=True`, spelled out: naming the leaf
                # rather than `categoryVotes` leaves a vote in another category
                # on the same document alone.
                "updateMask": {
                    "fieldPaths": [
                        "nodeId",
                        "userUid",
                        "categoryVotes.interesting",
                    ]
                },
            }
            for score in changed
        ]
        writes += [
            {"delete": self.document_name(vote_id(node_id, model))} for node_id in stale
        ]

        self.commit(writes, f"{model}'s votes")


class RestNotes(RestCollection):
    """A pipeline's notes, written as the signed-in person.

    The rules ask the same two things of a note as of a vote: the uid reads as
    a pipeline's, and the document id spells out the node and uid it carries.
    A note also carries prose onto somebody's page, which is why the payload is
    checked as well - see `isPipelineNote` in `firestore.rules`.
    """

    collection_id = "notes"

    def notes(self, model: str) -> dict[str, dict]:
        stored = {}
        for fields in self.by_uid(model):
            node_id = fields.get("nodeId", {}).get("stringValue")
            if node_id:
                stored[node_id] = decode_note(fields)
        return stored

    def apply(
        self, model: str, changed: list[tuple[str, dict]], stale: list[str]
    ) -> None:
        writes: list[dict] = [
            {
                "update": {
                    "name": self.document_name(note_id(node_id, model)),
                    "fields": encode_note(document),
                },
                # Every field the document has, so a rewrite replaces the note
                # rather than merging into it - `sources` is one field, and an
                # entry the previous version held and this one does not has to
                # go with it.
                "updateMask": {"fieldPaths": list(document)},
            }
            for node_id, document in changed
        ]
        writes += [
            {"delete": self.document_name(note_id(node_id, model))} for node_id in stale
        ]

        self.commit(writes, f"{model}'s notes")


#: The keys of a note entry that are written, in the order they are encoded.
#: Nothing else on a `NoteSource` belongs to the author - `articleNodeId` and
#: the `admin*` fields are written by the site after the fact, and a pipeline
#: that set them would be triaging its own note.
NOTE_ENTRY_FIELDS = ("url", "note", "kind")


def encode_note(document: dict) -> dict:
    """A note document as Firestore REST values."""
    return {
        "nodeId": {"stringValue": document["nodeId"]},
        "userUid": {"stringValue": document["userUid"]},
        "createdAt": {"stringValue": document["createdAt"]},
        "updatedAt": {"stringValue": document["updatedAt"]},
        "sources": {
            "arrayValue": {
                "values": [
                    {
                        "mapValue": {
                            "fields": {
                                field: {"stringValue": str(source.get(field) or "")}
                                for field in NOTE_ENTRY_FIELDS
                            }
                        }
                    }
                    for source in document["sources"]
                ]
            }
        },
    }


def decode_note(fields: dict) -> dict:
    """A note document read back off the REST API, as the Admin SDK returns it.

    Only what `note_entry` compares and the `createdAt` a rewrite has to keep;
    a document read back is never written out again as it stands.
    """
    values = fields.get("sources", {}).get("arrayValue", {}).get("values", []) or []
    return {
        "nodeId": fields.get("nodeId", {}).get("stringValue"),
        "userUid": fields.get("userUid", {}).get("stringValue"),
        "createdAt": fields.get("createdAt", {}).get("stringValue"),
        "sources": [
            {
                field: entry.get("mapValue", {})
                .get("fields", {})
                .get(field, {})
                .get("stringValue")
                for field in NOTE_ENTRY_FIELDS
            }
            for entry in values
        ],
    }


def number(value: dict) -> int:
    """A Firestore REST value back into the integer a score is stored as."""
    if "integerValue" in value:
        return int(value["integerValue"])
    return int(float(value["doubleValue"]))


def emulator_project_id() -> str:
    """The project the running emulator serves, so writes land in its data."""
    try:
        response = requests.get("http://127.0.0.1:4000/api/config", timeout=2)
        if response.status_code == 200:
            project_id = response.json().get("projectId")
            if project_id:
                return project_id
    except Exception as e:
        print(f"Warning: Could not detect emulator project ID: {e}", file=sys.stderr)
    return "demo-koryta-pl"


def open_store(args, admin, rest, login: Login | None = None):
    """The way in that suits the endpoint this run is uploading to.

    A local stack gets the Admin SDK, which the emulator lets through without
    credentials; anything else gets the REST client and is judged by
    `firestore.rules`.
    """
    database_id = getattr(args, "database", "koryta-pl")
    project_id = getattr(args, "project", None)

    if args.endpoint.startswith("http://localhost"):
        os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"
        return admin(project_id or emulator_project_id(), database_id)

    id_token = os.environ.get("KORYTA_ID_TOKEN")
    if not id_token:
        if login is None:
            raise ValueError(
                f"Writing to {args.endpoint} needs a Firebase id token: set "
                "KORYTA_ID_TOKEN, or hand this call a way to log in."
            )
        id_token = login()
    return rest(project_id or "koryta-pl", database_id, id_token)


def open_votes(args, login: Login | None = None) -> VoteStore:
    return open_store(args, AdminVotes, RestVotes, login)


def open_notes(args, login: Login | None = None) -> NoteStore:
    return open_store(args, AdminNotes, RestNotes, login)


def now_iso() -> str:
    """The stamp a note carries, as the site writes its own.

    An ISO string in UTC rather than a Firestore timestamp: the browser writes
    `serverTimestamp()` and reads it back through `normalizeUpdateTime`, which
    accepts either, and the REST path has no server timestamp to ask for
    without a second round trip.
    """
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Firestore:
    def __init__(
        self,
        args,
        votes: VoteStore | None = None,
        login: Login | None = None,
        notes: NoteStore | None = None,
    ):
        # Opened lazily, and only the one a run needs: a `--type score` upload
        # should not have to hold credentials for the notes collection, and a
        # test standing in for one store should not have to stand in for both.
        self._votes = votes
        self._notes = notes
        self._args = args
        self._login = login

    @property
    def votes(self) -> VoteStore:
        if self._votes is None:
            self._votes = open_votes(self._args, self._login)
        return self._votes

    @property
    def notes(self) -> NoteStore:
        if self._notes is None:
            self._notes = open_notes(self._args, self._login)
        return self._notes

    def existing_scores(self, model: str) -> dict[str, int]:
        """Node id -> the score this model last wrote, for the whole model.

        One equality query on `userUid`, which the automatic single-field index
        covers, and it returns only this model's own documents.
        """
        return self.votes.scores(model)

    def replace_scores(
        self, model: str, scores: list[PersonScore], retract: bool = True
    ) -> tuple[int, int]:
        """Make this model's stored opinion match the run that just finished.

        Written as a diff against what the model wrote last time rather than as
        a blind overwrite, for two reasons. Every vote document written fires
        `onVoteWritten`, which re-reads every vote on that node and rewrites the
        node's aggregate, so a run that re-states 40k unchanged scores costs 40k
        function invocations to change nothing. And a person the model no longer
        rates has to lose the score rather than keep a stale one - deleting the
        document says "this model has no opinion", which is what the site should
        show, whereas writing a zero leaves a vote nobody cast.

        `retract` is off when the caller only uploaded part of the run: a
        partial upload cannot tell a dropped score from one that was never sent.
        """
        existing = self.existing_scores(model)
        wanted = {s.node_id: s for s in scores}

        changed = [
            s for node_id, s in wanted.items() if existing.get(node_id) != s.score
        ]
        stale = (
            [node_id for node_id in existing if node_id not in wanted]
            if retract
            else []
        )

        print(
            f"{model}: {len(wanted)} scores, {len(existing)} already stored -> "
            f"{len(changed)} to write, {len(stale)} to retract"
            + ("" if retract else " (retraction skipped for a partial upload)"),
            file=sys.stderr,
        )

        self.votes.apply(model, changed, stale)
        return len(changed), len(stale)

    def existing_notes(self, model: str) -> dict[str, dict]:
        """Node id -> the note document this uid last wrote, for the whole uid."""
        return self.notes.notes(model)

    def replace_notes(
        self, model: str, notes: list[PersonNote], retract: bool = True
    ) -> tuple[int, int]:
        """Make this pipeline's stored notes match the run that just finished.

        A diff, for the reasons `replace_scores` is one and for a third that is
        this collection's own: a note carries a date, and it is shown. Writing
        an unchanged paragraph would fire `onNoteWritten`, recount the node's
        notes and move the note's `updatedAt` - so a nightly run would date
        every note today and the page would claim somebody had just revised it.

        A page that no longer qualifies - the Wikipedia link was corrected, the
        dates of birth stopped agreeing - has the note deleted rather than left
        standing. A note is a claim about a person, and one the pipeline can no
        longer make should not be readable on their page.

        `retract` is off when the caller only uploaded part of the run: a
        partial upload cannot tell a dropped note from one that was never sent.
        """
        existing = self.existing_notes(model)
        wanted = {note.node_id: note for note in notes}
        written_at = now_iso()

        changed: list[tuple[str, dict]] = []
        for node_id, note in wanted.items():
            stored = existing.get(node_id)
            document = note_document(
                note,
                # Kept from the note being replaced, so an edited note keeps
                # the date it was first written - what a reader is shown, and
                # what the admin queue orders by.
                created_at=(stored or {}).get("createdAt") or written_at,
                updated_at=written_at,
            )
            if stored is not None and note_entry(stored) == note_entry(document):
                continue
            changed.append((node_id, document))

        stale = (
            [node_id for node_id in existing if node_id not in wanted]
            if retract
            else []
        )

        print(
            f"{model}: {len(wanted)} notes, {len(existing)} already stored -> "
            f"{len(changed)} to write, {len(stale)} to retract"
            + ("" if retract else " (retraction skipped for a partial upload)"),
            file=sys.stderr,
        )

        self.notes.apply(model, changed, stale)
        return len(changed), len(stale)
