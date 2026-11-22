"""koryta_region_import: the regions and the urzędy table, sent with a cap on
how many regions the site creates, and the run's ending as the night reads it."""

import json
import sys
from unittest.mock import MagicMock

import pandas as pd
import pytest

import jobs.region_import as job
from uploader import RegionUploader

GMINA = {
    "node_id": "teryt1406113",
    "type": "region",
    "name": "Gmina Warka",
    "teryt": "1406113",
    "edge": {
        "edge_id": "edge_teryt1406_teryt1406113_owns",
        "source": "teryt1406",
        "target": "teryt1406113",
        "type": "owns",
    },
}
URZAD = {
    "teryt": "1406113",
    "region": "Warka",
    "name": "Urząd Miejski w Warce",
    "regon": "000526624",
    "nip": "7971385756",
}
ROWS = [
    {"entity_id": 1406113, "krs": None, "payload": json.dumps(GMINA)},
    URZAD,
]


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, phase=None):
        self.calls.append(("start", {"phase": phase}))
        return self

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


class World:
    """What the job reads and the site's answer, faked."""

    def __init__(self):
        self.rows: list[dict] | BaseException = list(ROWS)
        self.status = 200
        self.answer: dict = {
            "regions": {
                "sent": 1,
                "unchanged": 0,
                "edges": 1,
                "created": {"count": 1, "named": ["1406113 Gmina Warka"]},
                "waiting": {"count": 0, "named": []},
            },
            "offices": {"regions": 1, "updated": 1, "unchanged": 0},
        }
        self.runs: list[RecordingRun] = []
        self.signed_in: list[str] = []
        self.posts: list[tuple[str, dict]] = []

    def run(self) -> RecordingRun:
        [run] = self.runs
        return run


@pytest.fixture
def world(monkeypatch) -> World:
    w = World()

    def read_tables():
        if isinstance(w.rows, BaseException):
            raise w.rows
        return w.rows

    def sign_in(endpoint):
        w.signed_in.append(endpoint)
        return MagicMock()

    real = job.make_uploader

    def make_uploader(endpoint, tokens, max_new) -> RegionUploader:
        uploader = real(endpoint, tokens, max_new)

        def post(url, data, *args, **kwargs):
            w.posts.append((url, json.loads(data)))
            response = MagicMock(status_code=w.status, text="refused")
            response.json.return_value = w.answer
            return response

        uploader.post = post  # type: ignore[method-assign,assignment]
        return uploader

    def record(job_id, **kwargs):
        w.runs.append(RecordingRun(job_id, **kwargs))
        return w.runs[-1]

    monkeypatch.setattr(job, "read_tables", read_tables)
    monkeypatch.setattr(job, "sign_in", sign_in)
    monkeypatch.setattr(job, "make_uploader", make_uploader)
    monkeypatch.setattr(job, "JobRun", record)
    monkeypatch.setattr(sys, "argv", ["koryta_region_import"])
    return w


def test_an_output_s_missing_values_go_as_none_not_nan():
    frame = pd.DataFrame(
        [
            {"teryt": "1465058", "nip": None, "parents": ["14"]},
            {"teryt": "02", "nip": "8961003245", "parents": []},
        ]
    ).astype({"teryt": "string", "nip": "string"})

    assert job.records(frame) == [
        {"teryt": "1465058", "nip": None, "parents": ["14"]},
        {"teryt": "02", "nip": "8961003245", "parents": []},
    ]


def test_the_regions_and_the_table_go_in_one_request_with_the_cap(world):
    assert job.main([]) == 0

    [(url, body)] = world.posts
    assert url == "https://autopush.koryta.pl/api/ingest/region"
    assert body == {"regions": [GMINA], "offices": [URZAD], "maxCreated": 100}
    assert world.signed_in == ["https://autopush.koryta.pl"]


def test_max_new_reaches_the_site(world):
    job.main(["--max-new", "300"])

    [(_, body)] = world.posts
    assert body["maxCreated"] == 300


def test_a_negative_cap_is_refused(world):
    with pytest.raises(SystemExit):
        job.main(["--max-new", "-1"])
    assert world.posts == []


def test_a_run_with_nothing_left_to_create_succeeds(world):
    assert job.main([]) == 0

    ending = world.run().ending()
    assert ending["state"] == "succeeded"
    assert ending["counters"] == {
        "created": 1,
        "renamed": 0,
        "waiting": 0,
        "updated": 1,
        "unchanged": 0,
    }
    assert world.run().job == "region_import"


def test_regions_left_for_the_next_run_make_it_partial(world):
    world.answer["regions"]["waiting"] = {"count": 1404, "named": ["1406123 Gmina"]}

    assert job.main([]) == job.EXIT_TRY_LATER

    ending = world.run().ending()
    assert ending["state"] == "partial"
    assert ending["stop_reason"] == job.STOP_WAITING
    assert ending["counters"]["waiting"] == 1404
    assert ending["exit_code"] == job.EXIT_TRY_LATER


def test_what_is_worth_a_look_becomes_a_warning_and_the_rest_does_not(world):
    world.answer["regions"]["orphaned"] = {"count": 1, "named": ["0201011"]}
    world.answer["offices"]["unnamed"] = {"count": 2, "named": ["02 A", "04 B"]}
    # Regions with no urząd of their own, a delegatura say: expected.
    world.answer["offices"]["without"] = {"count": 5, "named": ["1261019"]}

    job.main([])

    assert world.run().ending()["warnings"] == [
        "1 regions created without an edge, their parent missing: 0201011",
        "2 urzędy whose name the „Urząd” chip would not know: 02 A, 04 B",
    ]


def test_a_refused_upload_fails_the_run(world):
    world.status = 403

    assert job.main([]) == job.EXIT_FAILED

    ending = world.run().ending()
    assert ending["state"] == "failed"
    assert ending["errors"]


def test_outputs_it_cannot_read_fail_it_before_anything_is_sent(world):
    world.rows = FileNotFoundError("versioned/region_payloads/region_payloads.jsonl")

    assert job.main([]) == job.EXIT_FAILED

    assert world.posts == []
    assert world.run().ending()["state"] == "failed"


def test_a_dry_run_signs_in_nowhere_and_sends_nothing(world):
    assert job.main(["--dry-run"]) == 0

    assert world.signed_in == []
    assert world.posts == []
    ending = world.run().ending()
    assert ending["state"] == "succeeded"
    assert ending["stop_reason"] == job.STOP_DRY_RUN
    assert ending["counters"] == {"planned": 1}
