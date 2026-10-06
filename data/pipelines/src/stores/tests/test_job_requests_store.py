"""Runs asked for on the site: what a request says, and taking one on once."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from google.api_core.exceptions import FailedPrecondition

from stores.job_requests import (
    PEOPLE_REQUEST,
    RequestError,
    claim,
    end_open_run,
    padded_krs,
    parse_request,
    queued_requests,
    read_request,
    register_number,
    running_on,
)

T0 = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


class Snapshot:
    def __init__(self, doc_id: str, data: dict | None, version: int):
        self.id = doc_id
        self.exists = data is not None
        self._data = deepcopy(data)
        self.update_time = version

    def to_dict(self):
        return deepcopy(self._data)


class Ref:
    def __init__(self, db: "Db", doc_id: str):
        self.db, self.id = db, doc_id

    def get(self):
        return Snapshot(
            self.id, self.db.docs.get(self.id), self.db.versions.get(self.id, 0)
        )

    def update(self, data: dict, option=None):
        if self.id not in self.db.docs:
            raise AssertionError(f"update of missing {self.id}")
        if option is not None and option != self.db.versions[self.id]:
            raise FailedPrecondition("the document changed since it was read")
        if self.db.before_update:
            hook, self.db.before_update = self.db.before_update, None
            hook()
            if option is not None and option != self.db.versions[self.id]:
                raise FailedPrecondition("the document changed since it was read")
        self.db.docs[self.id].update(deepcopy(data))
        self.db.versions[self.id] += 1
        self.db.updates.append((self.id, deepcopy(data)))


class Query:
    def __init__(self, db: "Db", filters=(), limit=None):
        self.db, self.filters, self._limit = db, list(filters), limit

    def where(self, *, filter):
        return Query(self.db, [*self.filters, filter], self._limit)

    def limit(self, n):
        return Query(self.db, self.filters, n)

    def stream(self):
        found = [
            Snapshot(doc_id, data, self.db.versions[doc_id])
            for doc_id, data in self.db.docs.items()
            if all(
                f.op_string == "==" and data.get(f.field_path) == f.value
                for f in self.filters
            )
        ]
        return iter(found[: self._limit] if self._limit else found)


class Collection(Query):
    def __init__(self, db: "Db", name: str):
        assert name == "jobRuns"
        super().__init__(db)

    def document(self, doc_id: str) -> Ref:
        return Ref(self.db, doc_id)


class Db:
    """The ops database's `jobRuns`, with a version per document standing in
    for its update time."""

    def __init__(self, **docs: dict):
        self.docs = {doc_id: deepcopy(data) for doc_id, data in docs.items()}
        self.versions = dict.fromkeys(self.docs, 1)
        self.updates: list[tuple[str, dict]] = []
        #: Runs once, just before the next update lands - a second worker.
        self.before_update = None

    def collection(self, name: str) -> Collection:
        return Collection(self, name)

    def write_option(self, *, last_update_time):
        return last_update_time


def queued(**request) -> dict:
    return {
        "job": PEOPLE_REQUEST,
        "state": "queued",
        "trigger": "request",
        "startedAt": T0,
        "request": {
            "target": "company",
            "nodeId": "place-1",
            "name": "Wodociągi Miejskie",
            "krs": "123456",
            "dryRun": False,
            "by": "uid-1",
            **request,
        },
    }


# ---------------------------------------------------------------------------
# What a request says


def test_a_company_request_reads_with_its_krs_padded():
    request = parse_request("run-1", queued())

    assert request.run_id == "run-1"
    assert request.job == PEOPLE_REQUEST
    assert (request.target, request.node_id) == ("company", "place-1")
    assert request.krs == "0000123456"
    assert (request.dry_run, request.by) == (False, "uid-1")
    assert "KRS 0000123456" in request.describe()


def test_a_person_request_carries_the_pages_register_number():
    request = parse_request(
        "run-1",
        queued(
            target="person",
            nodeId="person-1",
            name="Jan Kowalski",
            krs=None,
            rejestrIo="https://rejestr.io/osoby/383093/jan-kowalski",
            dryRun=True,
        ),
    )

    assert (request.target, request.krs) == ("person", None)
    assert request.register_number == "383093"
    assert request.dry_run is True


@pytest.mark.parametrize(
    "change, message",
    [
        ({"job": "people_import"}, "not a job the site can ask for"),
        ({"request": None}, "no request"),
        ({"request": {"target": "region", "nodeId": "x"}}, "unknown target"),
        ({"request": {"target": "person", "nodeId": " "}}, "no page"),
        ({"request": {"target": "company", "nodeId": "p", "krs": "brak"}}, "no KRS"),
    ],
)
def test_a_run_that_asks_for_nothing_doable_is_refused(change, message):
    with pytest.raises(RequestError, match=message):
        parse_request("run-1", {**queued(), **change})


def test_a_run_that_is_not_there_is_refused():
    with pytest.raises(RequestError, match="no run"):
        read_request("missing", Db())


def test_read_request_reads_the_runs_document():
    db = Db(**{"run-1": queued()})

    assert read_request("run-1", db).krs == "0000123456"


@pytest.mark.parametrize(
    "link, number",
    [
        ("https://rejestr.io/osoby/383093", "383093"),
        ("https://rejestr.io/osoby/383093/jan-kowalski", "383093"),
        ("https://rejestr.io/krs/123/firma", None),
        (None, None),
        (float("nan"), None),
    ],
)
def test_register_number(link, number):
    assert register_number(link) == number


@pytest.mark.parametrize(
    "value, padded",
    [
        ("123456", "0000123456"),
        ("0000123456", "0000123456"),
        (" 0000 123 456 ", "0000123456"),
        (123456, "0000123456"),
        ("", None),
        (None, None),
        ("12345678901", None),
    ],
)
def test_padded_krs(value, padded):
    assert padded_krs(value) == padded


# ---------------------------------------------------------------------------
# The queue


def test_the_queue_is_the_asked_for_runs_oldest_first():
    db = Db(
        later={**queued(), "startedAt": T0 + timedelta(minutes=5)},
        first=queued(),
        going={**queued(), "state": "running"},
        nightly={"job": "nightly", "state": "queued", "startedAt": T0},
    )

    assert [run_id for run_id, _ in queued_requests(db)] == ["first", "later"]


def test_a_queued_run_is_claimed_once():
    db = Db(**{"run-1": queued()})

    assert claim(db, "run-1", host="koryta@vm", now=T0) is True
    assert claim(db, "run-1", host="other@vm", now=T0) is False

    run = db.docs["run-1"]
    assert (run["state"], run["host"], run["claimedAt"]) == ("running", "koryta@vm", T0)
    # The request stays: it is what the job reads next.
    assert run["request"]["nodeId"] == "place-1"


def test_two_workers_at_once_get_one_claim_between_them():
    db = Db(**{"run-1": queued()})
    others: list[bool] = []
    # The other worker's claim lands between this one's read and its write.
    db.before_update = lambda: others.append(
        claim(db, "run-1", host="other@vm", now=T0)
    )

    assert claim(db, "run-1", host="koryta@vm", now=T0) is False
    assert others == [True]
    assert db.docs["run-1"]["host"] == "other@vm"


def test_an_open_run_is_ended_and_an_ended_one_left_alone():
    db = Db(**{"run-1": {**queued(), "state": "running"}})

    assert end_open_run(db, "run-1", reason="kod wyjścia 1", exit_code=1, now=T0)
    run = db.docs["run-1"]
    assert (run["state"], run["stopReason"], run["exitCode"]) == (
        "failed",
        "kod wyjścia 1",
        1,
    )
    assert run["finishedAt"] == T0

    assert not end_open_run(db, "run-1", state="succeeded", reason="x", now=T0)
    assert db.docs["run-1"]["state"] == "failed"
    assert not end_open_run(db, "missing", reason="x", now=T0)


def test_running_on_names_this_hosts_asked_for_runs():
    db = Db(
        mine={**queued(), "state": "running", "host": "koryta@vm"},
        theirs={**queued(), "state": "running", "host": "szymon@predator"},
        nightly={"job": "nightly", "state": "running", "host": "koryta@vm"},
        done={**queued(), "state": "succeeded", "host": "koryta@vm"},
    )

    assert running_on(db, "koryta@vm") == ["mine"]
