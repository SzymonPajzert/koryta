"""The NIP job: what it reads, what it asks, what it files, and what it exits with.

Nothing here reaches the ministry or a bucket: the service is a table, the
bucket a dict.
"""

import contextlib
import json
import sys
from dataclasses import asdict

import pytest

import jobs.krs_nip as job
from jobs.krs_odpis import plan as odpis_plan
from jobs.krs_odpis.search import SearchHit
from scrapers.krs import nip_answers
from scrapers.stores.file import DownloadableFile

# Checksum-valid NIPs.
N1, N2, N3 = "7743261776", "5250001090", "1010000019"
TODAY = "2026-10-09"
HUCK = SearchHit("0000183608", "HUCK POLSKA SP. Z O.O.", "WROCŁAW", "P")
EMITEL_OLD = SearchHit("0000482636", "EMITEL SP. Z O.O.", "WARSZAWA", "P")
EMITEL = SearchHit("0000716108", "EMITEL S.A.", "WARSZAWA", "P")


def answer(nip, *hits):
    """An answer's body, as the job files it."""
    return json.dumps({"nip": nip, "hits": [asdict(h) for h in hits]})


# ------------------------------------------------------------------ the input
def test_a_nip_needs_its_checksum():
    assert [job.nip_valid(n) for n in (N1, N2, N3)] == [True] * 3
    assert [job.nip_valid(n) for n in ("7743261775", "774326177", "77432617760")] == [
        False
    ] * 3


def test_a_nip_file_reads_tables_dashes_and_comments(tmp_path):
    path = tmp_path / "nips.txt"
    path.write_text(f"# from BIPs\n{N1}\n\n774-326-17-76\t3\n{N2} \n 101 000 00 19\n")
    assert job.read_nip_file(path) == [N1, N2, N3]


def test_a_nip_file_refuses_what_is_not_a_nip(tmp_path):
    path = tmp_path / "nips.txt"
    path.write_text(f"{N1}\n7743261775\n")
    with pytest.raises(SystemExit, match="nips.txt:2"):
        job.read_nip_file(path)


# ------------------------------------------------------------------- the plan
def test_what_is_on_file_is_not_asked_and_the_cap_defers():
    the_plan = job.make_plan([N1, N2, N3], {N2: []}, limit=1)
    assert (the_plan.asks, the_plan.deferred) == ([N1], 1)
    assert "1 answered already - 0 in the register" in job.report(the_plan)


class File:
    def __init__(self, body):
        self.body = body

    def read_string(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


class Bucket:
    """A listing and the bodies behind it, by blob name."""

    def __init__(self, bodies, sizes=None):
        self.bodies = bodies
        self.sizes = sizes or {}

    def list_files(self, ref):
        for name in self.bodies:
            yield DownloadableFile(
                f"gs://koryta-pl-crawled/{name}",
                size=self.sizes.get(name, len(str(self.bodies[name]))),
            )

    def read_data(self, ref):
        return File(self.bodies[ref.url.split("koryta-pl-crawled/", 1)[1]])


class Ctx:
    def __init__(self, bucket):
        self.io = bucket


def test_answers_on_file_are_read_and_the_unusable_ones_asked_again():
    empty = nip_answers.blob_name(N2, "2026-09-27")
    bodies = {
        nip_answers.blob_name(N1, "2026-09-14"): answer(N1),
        nip_answers.blob_name(N1, "2026-09-27"): answer(N1, HUCK),  # the newest
        empty: "",  # a write that never finished
        nip_answers.blob_name(N3, "2026-09-27"): OSError("503"),
    }
    known = job.answers_on_file(Ctx(Bucket(bodies, {empty: 0})), [N1, N2, N3])
    assert known == {N1: [asdict(HUCK)]}


# ------------------------------------------------------------------ the asking
class Service:
    """Each NIP's replies in turn, the last one repeating: hits, or an exception."""

    def __init__(self, replies):
        self.replies = {nip: list(r) for nip, r in replies.items()}
        self.asked = []

    def __call__(self, nip):
        self.asked.append(nip)
        queue = self.replies[nip]
        reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(reply, BaseException):
            raise reply
        return reply


def ask(replies, nips, should_stop=lambda: False):
    service = Service(replies)
    filed = {}
    result = job.ask_all(
        nips,
        service,
        lambda name, data: filed.__setitem__(name, json.loads(data)),
        lambda: TODAY,
        interval=0,
        result=job.Result(),
        should_stop=should_stop,
        sleep=lambda s: None,
        say=lambda s: None,
    )
    return result, filed, service


def test_every_answer_is_filed_as_the_crawl_filed_it():
    result, filed, _ = ask({N1: [[HUCK]], N2: [[]]}, [N1, N2])
    assert filed == {
        nip_answers.blob_name(N1, TODAY): json.loads(answer(N1, HUCK)),
        nip_answers.blob_name(N2, TODAY): {"nip": N2, "hits": []},
    }
    assert result.counters() == {job.FOUND: 1, job.ABSENT: 1, job.FAILED: 0}
    assert job.run_state(result) == "succeeded"


def test_one_that_got_no_answer_is_asked_once_more_at_the_end():
    result, _, service = ask({N1: [OSError("504"), [HUCK]], N2: [[EMITEL]]}, [N1, N2])
    assert service.asked == [N1, N2, N1]
    assert result.counters() == {job.FOUND: 2, job.ABSENT: 0, job.FAILED: 0}


def test_twenty_failures_in_a_row_stop_the_run_without_a_second_pass():
    nips = [f"{n:010d}" for n in range(25)]
    result, filed, service = ask({n: [OSError("refused")] for n in nips}, nips)
    assert len(service.asked) == job.MAX_CONSECUTIVE_FAILURES
    assert filed == {} and job.run_state(result) == "failed"


def test_a_failed_write_is_no_answer():
    def refuse(name, data):
        raise OSError("403 writing")

    result = job.ask_all(
        [N1],
        Service({N1: [[HUCK]]}),
        refuse,
        lambda: TODAY,
        0,
        job.Result(),
        sleep=lambda s: None,
        say=lambda s: None,
    )
    assert N1 not in result.answers and N1 in result.failed
    assert job.run_state(result) == "partial"


def test_asked_to_stop_stops_before_the_next_nip():
    stops = iter([False, True])
    result, _, service = ask({N1: [[HUCK]], N2: [[]]}, [N1, N2], lambda: next(stops))
    assert service.asked == [N1] and result.stopped == "asked to stop"
    assert job.run_state(result) == "partial"


# ------------------------------------------------------------------ the output
def test_the_table_reads_as_a_krs_file(tmp_path):
    out = tmp_path / "bip1.krs.tsv"
    hits = {
        N1: [asdict(EMITEL), asdict(EMITEL_OLD)],
        N2: [],
        N3: [{"krs": "183608", "register": "S", "name": "A\tB\nC", "city": None}],
    }
    assert job.write_table(out, [N3, N2, N1], hits) == 3
    assert out.read_text().splitlines()[1:] == [
        f"0000183608\tS\t{N3}\tA B C\t",
        f"0000716108\tP\t{N1}\tEMITEL S.A.\tWARSZAWA",
        f"0000482636\tP\t{N1}\tEMITEL SP. Z O.O.\tWARSZAWA",
    ]
    assert odpis_plan.read_krs_file(out) == [
        odpis_plan.Candidate("0000183608", odpis_plan.REASON_FILE, hint="S"),
        odpis_plan.Candidate("0000716108", odpis_plan.REASON_FILE, hint="P"),
        odpis_plan.Candidate("0000482636", odpis_plan.REASON_FILE, hint="P"),
    ]


# ------------------------------------------------- what /admin/procesy is told
class FakeClient:
    def __init__(self):
        self.objects = {}

    def create_object(self, bucket, blob_name, data, content_type):
        self.objects[(bucket, blob_name)] = (data, content_type)
        return f"gs://{bucket}/{blob_name}"


class RecordingRun:
    """Stands in for `stores.job_runs.JobRun`, keeping what the run told it."""

    def __init__(self):
        self.calls = []

    def start(self, **kwargs):
        self.calls.append(("start", kwargs))
        return self

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self):
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


def serve(monkeypatch, replies):
    service = Service(replies)
    monkeypatch.setattr(
        job.search, "search_nip_confirmed", lambda nip, session=None: service(nip)
    )
    monkeypatch.setattr(job, "warsaw_day", lambda: TODAY)
    return service


def run(monkeypatch, replies, asks):
    serve(monkeypatch, replies)
    client, status = FakeClient(), RecordingRun()
    result, code = job.run(asks, 0, client=client, session=object(), status=status)
    return result, code, client, status


def test_a_clean_run_files_json_and_exits_zero(monkeypatch):
    _, code, client, status = run(monkeypatch, {N1: [[HUCK]], N2: [[]]}, [N1, N2])
    assert code == 0
    assert set(client.objects) == {
        ("koryta-pl-crawled", nip_answers.blob_name(N1, TODAY)),
        ("koryta-pl-crawled", nip_answers.blob_name(N2, TODAY)),
    }
    assert {kind for _, kind in client.objects.values()} == {"application/json"}
    end = status.ending()
    assert (end["state"], end["exit_code"], end["done"]) == ("succeeded", 0, 2)
    assert end["counters"] == {job.FOUND: 1, job.ABSENT: 1, job.FAILED: 0}


def test_what_is_left_without_an_answer_is_for_the_next_run(monkeypatch):
    refused = [OSError("504"), OSError("504")]
    _, code, _, status = run(monkeypatch, {N1: [[HUCK]], N2: refused}, [N1, N2])
    end = status.ending()
    assert code == job.EXIT_UPSTREAM_REFUSING
    assert (end["state"], end["errors"]) == ("partial", [f"{N2}: OSError: 504"])


def test_ctrl_c_keeps_what_was_answered(monkeypatch):
    _, code, client, status = run(
        monkeypatch, {N1: [[HUCK]], N2: [KeyboardInterrupt()]}, [N1, N2]
    )
    assert code == job.EXIT_INTERRUPTED
    assert len(client.objects) == 1
    assert status.ending()["state"] == "partial"


# -------------------------------------------------------------------- the job
@pytest.fixture
def offline(monkeypatch, tmp_path):
    """main() against a bucket holding N2's answer, a fake client and no lock file."""
    bodies = {nip_answers.blob_name(N2, "2026-09-27"): answer(N2)}
    client = FakeClient()
    monkeypatch.setattr(job, "setup_context", lambda: (Ctx(Bucket(bodies)), None))
    monkeypatch.setattr(job, "Client", lambda: client)
    monkeypatch.setattr(job, "one_crawler", contextlib.nullcontext)
    monkeypatch.setattr(sys, "argv", ["koryta_krs_nip"])
    nips = tmp_path / "bip1.nips.txt"
    nips.write_text(f"{N1}\n{N2}\n{N3}\n")
    return nips, client


def test_a_run_asks_what_is_not_on_file_and_writes_the_table(monkeypatch, offline):
    nips, client = offline
    service = serve(monkeypatch, {N1: [[]], N3: [[HUCK]]})
    assert job.main([str(nips), "--interval", "0"]) == 0
    assert service.asked == [N1, N3]
    assert len(client.objects) == 2
    table = nips.with_suffix(".krs.tsv").read_text().splitlines()
    assert table[1:] == [f"0000183608\tP\t{N3}\tHUCK POLSKA SP. Z O.O.\tWROCŁAW"]


def test_a_dry_run_asks_nothing_and_writes_nothing(monkeypatch, offline):
    nips, client = offline
    service = serve(monkeypatch, {})
    assert job.main([str(nips), "--dry-run"]) == 0
    assert service.asked == [] and client.objects == {}
    assert not nips.with_suffix(".krs.tsv").exists()
