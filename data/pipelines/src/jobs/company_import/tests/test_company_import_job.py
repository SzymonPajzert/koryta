"""The company import: what of the night's company payloads it sends, what it
holds back, and when it stops."""

import argparse
import gzip
import json
import sys
import typing
from datetime import UTC, date, datetime, time, timedelta

import pandas as pd
import pytest

import jobs.company_import as job
import jobs.people_import as people
from analysis.payloads.site import COMPANY_FIELDS, NEW_OWNER, SiteSnapshot
from jobs.nightly import Export
from scrapers.koryta.download import CURRENT_DATE
from stores.storage import SHARED_BUCKET, warsaw_tz
from uploader import Args, CompanyUploader

ENDPOINT = "https://autopush.koryta.pl"
TODAY = CURRENT_DATE


def warsaw(day: str, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(
        date.fromisoformat(day), time(hour, minute), tzinfo=warsaw_tz
    )


#: This morning's export, as Firestore stamps it, done three minutes later.
MORNING = warsaw(TODAY, 4)
FRESH = Export(MORNING.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.242Z"), MORNING)
YESTERDAY = MORNING - timedelta(days=1)
STALE = Export(YESTERDAY.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.242Z"), None)

PUBLIC_KRS = "0000000101"
PRIVATE_KRS = "0000000102"
OWNER_KRS = "0000000103"


def node(krs: str, node_id: str, **fields) -> dict:
    """A company page as the export has it."""
    return {
        "id": node_id,
        "type": "place",
        "name": f"FIRMA {krs}",
        "krsNumber": krs,
        "activity": ["49.31.Z"],
        "categories": ["koleje"],
        "supervisoryBody": "rada_nadzorcza",
        "revision_id": f"rev-{node_id}",
        **fields,
    }


def payload(krs: str, **fields) -> dict:
    """The payload that restates `node(krs, ...)`, changed by `fields`."""
    return {
        "krs": krs,
        "name": f"FIRMA {krs}",
        "activity": ["49.31.Z"],
        "categories": ["koleje"],
        "supervisory_body": "rada_nadzorcza",
        "owners": [],
        "owner_teryts": [],
        "owner_skarb_panstwa": False,
        "founders": [],
        "founder_teryts": [],
        "founder_skarb_panstwa": False,
        **fields,
    }


def site(*nodes: dict, edges: tuple[dict, ...] = ()) -> SiteSnapshot:
    rows = list(nodes) or [node(PUBLIC_KRS, "place-1", isPublic=True)]
    return SiteSnapshot(
        pd.DataFrame.from_records(rows),
        pd.DataFrame.from_records(list(edges)) if edges else pd.DataFrame(),
    )


#: The site most tests send to: a public company, a private one, and a third
#: that can own either.
SITE = (
    node(PUBLIC_KRS, "place-1", isPublic=True),
    node(PRIVATE_KRS, "place-2"),
    node(OWNER_KRS, "place-3"),
)


class Response:
    def __init__(self, status_code: int = 200, body: object = None, text: str = ""):
        self.status_code = status_code
        self.body = body
        self.text = text or json.dumps(body)

    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body


def answer(outcome: str = "updated") -> Response:
    return Response(200, {"id": "place-x", "code": 200, "company": outcome})


REFUSED = Response(500, text="Internal Server Error")


class Tokens:
    who = "a test"
    interactive = False

    def __init__(self, events: list[str]):
        self.events = events

    def token(self) -> str:
        self.events.append("token")
        return "id-token"

    def refresh(self) -> str:
        return "id-token"


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, phase=None):
        self.calls.append(("start", {"phase": phase}))

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


class World:
    """Everything the job touches, faked: the build, the export, the bucket,
    the site and the clock."""

    def __init__(self):
        self.clock = warsaw(TODAY, 6)
        self.export: Export | None = FRESH
        #: What the build returns: every company's payload, and the export.
        self.payloads: list[dict] = []
        self.site = site(*SITE)
        #: Frames of the export on disk not built from it.
        self.stale: list[str] = []
        self.built: list[dict] = []
        #: What the site answers each company, in order.
        self.answers: list = []
        self.events: list[str] = []
        self.posted: list[dict] = []
        self.objects: dict[str, bytes] = {}
        self.failing_writes: tuple[str, ...] = ()
        self.runs: list[RecordingRun] = []
        self.tokens = Tokens(self.events)

    def run(self) -> RecordingRun:
        [run] = self.runs
        return run

    def sent(self) -> list[str]:
        return [str(company["krs"]) for company in self.posted]

    def summary(self) -> dict:
        [name] = [name for name in self.objects if name.startswith(job.RUNS_PREFIX)]
        return json.loads(self.objects[name])

    def part(self) -> list[dict]:
        [name] = [n for n in self.objects if n.startswith(job.PAYLOADS_PREFIX)]
        lines = gzip.decompress(self.objects[name]).decode("utf-8").splitlines()
        return [json.loads(line) for line in lines]


@pytest.fixture
def world(monkeypatch) -> World:
    w = World()

    def build_payloads(koryta_date, policy):
        w.events.append("build")
        w.built.append({"date": koryta_date, "policy": policy})
        return [dict(p) for p in w.payloads], w.site

    def stale_frames(frames, finished):
        w.events.append("frames")
        return list(w.stale)

    class Bucket:
        def create_object(self, bucket, name, data, content_type):
            w.events.append(f"write {name.split('/')[2]}")
            if name.startswith(w.failing_writes):
                raise OSError("403 Forbidden")
            assert name not in w.objects, f"{name} written twice"
            w.objects[name] = data
            return f"gs://{bucket}/{name}"

    class Site:
        def post(self, url, data=None, headers=None, timeout=None):
            assert url == f"{ENDPOINT}/api/ingest/company"
            company = json.loads(data)
            w.events.append(f"send {company['krs']}")
            w.posted.append(company)
            found = w.answers.pop(0)
            if isinstance(found, BaseException):
                raise found
            return found

    def make_uploader(endpoint, tokens):
        args = argparse.Namespace(endpoint=endpoint, type="company", limit=None)
        return CompanyUploader(
            typing.cast(Args, args),
            tokens=tokens,
            session=Site(),  # type: ignore[arg-type]
        )

    def record(job_id, **kwargs):
        w.runs.append(RecordingRun(job_id, **kwargs))
        return w.runs[-1]

    def latest_export(client):
        w.events.append("export")
        return w.export

    monkeypatch.setattr(job, "warsaw_now", lambda: w.clock)
    monkeypatch.setattr(job, "latest_export", latest_export)
    monkeypatch.setattr(job, "stale_frames", stale_frames)
    monkeypatch.setattr(job, "build_payloads", build_payloads)
    monkeypatch.setattr(job, "Client", Bucket)
    monkeypatch.setattr(job, "make_uploader", make_uploader)
    monkeypatch.setattr(job, "JobRun", record)
    monkeypatch.setattr(people, "token_source", lambda endpoint: w.tokens)
    monkeypatch.setattr(job.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(sys, "argv", ["koryta_company_import"])
    return w


# ---------------------------------------------------------------------------
# A run that goes as planned


def test_a_run_sends_the_companies_whose_page_would_change_and_exits_0(world):
    world.payloads = [
        payload(PUBLIC_KRS),  # restates the page
        payload(OWNER_KRS, categories=["koleje", "energetyka"]),
        payload(PRIVATE_KRS, is_public=True),
    ]
    world.answers = [answer("updated"), answer("unchanged")]

    assert job.main([]) == 0

    # The one turning public first, then the rest as they came.
    assert world.sent() == [PRIVATE_KRS, OWNER_KRS]
    run = world.run()
    assert (run.job, run.kwargs["unit"]) == ("company_import", "firm")
    assert run.calls[0] == ("start", {"phase": "paczki"})
    end = run.ending()
    assert end["state"] == "succeeded"
    assert (end["stop_reason"], end["exit_code"], end["done"]) == (None, 0, 2)
    assert (end["errors"], end["warnings"]) == ([], [])
    assert end["counters"] == {
        "planned": 2,
        "updated": 1,
        "unchanged": 1,
        "created": 0,
        "failed": 0,
        "held": 0,
        "renames_held": 0,
    }
    assert end["summary_path"].startswith(f"gs://{SHARED_BUCKET}/{job.RUNS_PREFIX}")


def test_what_is_sent_is_written_first_and_the_summary_says_what_came_of_it(world):
    world.payloads = [
        payload(
            PRIVATE_KRS, is_public=True, wikipedia="https://pl.wikipedia.org/wiki/Ż"
        )
    ]
    world.answers = [answer("updated")]

    job.main([])

    assert world.events.index("write payloads") < world.events.index(
        f"send {PRIVATE_KRS}"
    )
    assert world.part() == world.payloads
    summary = world.summary()
    run_id = world.run().kwargs["run_id"]
    assert summary["run"] == run_id
    assert summary["payloads"].endswith(
        f"{job.PAYLOADS_PREFIX}date={summary['started'][:10]}/{run_id}.jsonl.gz"
    )
    assert (summary["export"], summary["endpoint"]) == (FRESH.stamp, ENDPOINT)
    assert (summary["planned"], summary["state"], summary["exit_code"]) == (
        1,
        "succeeded",
        0,
    )
    assert summary["reasons"] == {COMPANY_FIELDS: 1}
    assert summary["companies"] == [
        {
            "krs": PRIVATE_KRS,
            "name": f"FIRMA {PRIVATE_KRS}",
            "reasons": [COMPANY_FIELDS],
            "outcome": "updated",
        }
    ]


def test_an_owner_link_goes_up_with_the_company(world):
    world.payloads = [payload(PRIVATE_KRS, owners=[OWNER_KRS])]
    world.answers = [answer("unchanged")]

    job.main([])

    [sent] = world.posted
    assert sent["owners"] == [OWNER_KRS]
    assert world.summary()["companies"][0]["reasons"] == [NEW_OWNER]


def test_a_day_with_nothing_to_change_says_so_and_sends_nothing(world):
    world.payloads = [payload(PUBLIC_KRS), payload(PRIVATE_KRS)]

    assert job.main([]) == 0

    assert world.posted == []
    assert not [n for n in world.objects if n.startswith(job.PAYLOADS_PREFIX)]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == (
        "succeeded",
        "nic do wysłania - strona ma już te dane",
    )


def test_an_answer_that_does_not_say_what_it_did_counts_as_an_update(world):
    world.payloads = [payload(PRIVATE_KRS, is_public=True)]
    world.answers = [Response(200, {"id": "place-2", "code": 200})]

    assert job.main([]) == 0

    assert world.run().ending()["counters"]["updated"] == 1


# ---------------------------------------------------------------------------
# What it holds back


def test_a_public_company_is_never_made_private(world):
    """Every hand upload was checked for 0 isPublic true->false first; the
    night holds such a payload back and names it for somebody to look at."""
    world.payloads = [
        payload(PUBLIC_KRS, is_public=False, categories=[]),
        payload(OWNER_KRS, categories=[]),
    ]
    world.answers = [answer()]

    assert job.main([]) == 0

    assert world.sent() == [OWNER_KRS]
    end = world.run().ending()
    assert end["counters"]["held"] == 1
    assert end["warnings"] == [f"{PUBLIC_KRS} FIRMA {PUBLIC_KRS}: stałaby się prywatna"]
    assert world.summary()["held"] == [
        {
            "krs": PUBLIC_KRS,
            "name": f"FIRMA {PUBLIC_KRS}",
            "why": "stałaby się prywatna",
        }
    ]


def test_a_flag_a_person_set_is_theirs_and_holds_nothing(world):
    world.site = site(
        node(PUBLIC_KRS, "place-1", isPublic=True, isPublicSource="manual")
    )
    world.payloads = [payload(PUBLIC_KRS, is_public=False)]

    assert job.main([]) == 0

    assert world.posted == []
    assert world.run().ending()["warnings"] == []


def test_the_companies_left_to_a_hand_upload_are_never_sent(world):
    krs = next(iter(job.HAND_ONLY))
    world.site = site(node(krs, "place-9"))
    world.payloads = [payload(krs, is_public=True)]

    assert job.main([]) == 0

    assert world.posted == []
    [warning] = world.run().ending()["warnings"]
    assert warning == f"{krs} FIRMA {krs}: tylko ręcznie, {job.HAND_ONLY[krs]}"


def test_a_company_with_no_page_under_its_krs_is_never_created(world):
    """`CompaniesPayloads` builds for the companies the export has; one the
    snapshot cannot find - stored without its leading zeros, say - the ingest
    would not find either, and would make a second page for."""
    world.payloads = [payload("0000999999", is_public=True)]

    assert job.main([]) == 0

    assert world.posted == []
    assert world.run().ending()["warnings"] == [
        "0000999999 FIRMA 0000999999: brak strony o tym KRS w kopii bazy"
    ]


def test_the_site_keeps_its_name_and_the_rest_goes_up(world):
    """Of the 3 renames waiting on 2026-11-11, 2 were the pipelines' slips."""
    world.payloads = [
        payload(PRIVATE_KRS, name="FIRMA (Łoszczowa)", is_public=True),
        payload(OWNER_KRS, name="FIRMA W LIKWIDACJI"),
    ]
    world.answers = [answer()]

    assert job.main([]) == 0

    # The rename was all the second would change, so it does not go at all.
    [sent] = world.posted
    assert (sent["krs"], sent["name"], sent["is_public"]) == (
        PRIVATE_KRS,
        f"FIRMA {PRIVATE_KRS}",
        True,
    )
    end = world.run().ending()
    assert end["counters"]["renames_held"] == 2
    assert end["warnings"] == [
        f"{PRIVATE_KRS}: nazwa „FIRMA {PRIVATE_KRS}” zostaje, "
        "rejestr: „FIRMA (Łoszczowa)”",
        f"{OWNER_KRS}: nazwa „FIRMA {OWNER_KRS}” zostaje, "
        "rejestr: „FIRMA W LIKWIDACJI”",
    ]
    assert world.summary()["names_kept"][1] == {
        "krs": OWNER_KRS,
        "site": f"FIRMA {OWNER_KRS}",
        "register": "FIRMA W LIKWIDACJI",
    }


def test_max_renames_lets_the_first_renames_in(world):
    world.payloads = [
        payload(PRIVATE_KRS, name="FIRMA W LIKWIDACJI"),
        payload(OWNER_KRS, name="INNA FIRMA"),
    ]
    world.answers = [answer()]

    assert job.main(["--max-renames", "1"]) == 0

    assert [(c["krs"], c["name"]) for c in world.posted] == [
        (PRIVATE_KRS, "FIRMA W LIKWIDACJI")
    ]
    assert world.run().ending()["counters"]["renames_held"] == 1


def test_a_name_a_person_gave_is_no_rename(world):
    world.site = site(node(PRIVATE_KRS, "place-2", name="Firma", nameSource="manual"))
    world.payloads = [payload(PRIVATE_KRS, name="FIRMA (Gdynia)", is_public=True)]
    world.answers = [answer()]

    job.main([])

    # Sent as built: the ingest keeps the stored name itself.
    assert world.posted[0]["name"] == "FIRMA (Gdynia)"
    assert world.run().ending()["counters"]["renames_held"] == 0


def test_the_plan_leaves_the_payloads_it_was_given_as_they_were():
    given = [payload(PRIVATE_KRS, name="INNA FIRMA", is_public=True)]

    plan = job.plan_uploads(given, site(*SITE))

    assert plan.send[0].payload["name"] == f"FIRMA {PRIVATE_KRS}"
    assert given[0]["name"] == "INNA FIRMA"


# ---------------------------------------------------------------------------
# Where it stops


def test_a_page_the_site_creates_stops_the_run_as_failed(world):
    world.payloads = [
        payload(PRIVATE_KRS, is_public=True),
        payload(OWNER_KRS, categories=[]),
    ]
    world.answers = [answer("created"), answer()]

    assert job.main([]) == job.EXIT_FAILED

    assert world.sent() == [PRIVATE_KRS]
    end = world.run().ending()
    assert end["state"] == "failed"
    assert end["stop_reason"] == (
        f"utworzył stronę firmy {PRIVATE_KRS}, którą kopia bazy już miała"
    )
    assert end["counters"]["created"] == 1


def test_a_few_refused_leave_the_run_partial_and_named(world):
    world.payloads = [
        payload(PRIVATE_KRS, is_public=True),
        payload(OWNER_KRS, categories=[]),
    ]
    world.answers = [REFUSED, answer()]

    assert job.main([]) == job.EXIT_TRY_LATER

    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "nieudane: 1 z 2")
    assert end["errors"] == [f"firma {PRIVATE_KRS}: 500 Internal Server Error"]
    assert world.summary()["companies"][0]["error"] == end["errors"][0]


def test_every_company_refused_fails_the_run(world):
    world.payloads = [payload(PRIVATE_KRS, is_public=True)]
    world.answers = [REFUSED]

    assert job.main([]) == job.EXIT_FAILED

    assert world.run().ending()["stop_reason"] == (
        "strona odrzuciła wszystkie wysyłki (1)"
    )


def test_refusals_in_a_row_stop_the_run(world):
    n = job.MAX_REFUSED_IN_A_ROW
    world.site = site(*[node(f"{k:010d}", f"place-{k}") for k in range(1, n + 3)])
    world.payloads = [payload(f"{k:010d}", is_public=True) for k in range(1, n + 3)]
    world.answers = [answer()] + [REFUSED] * (n + 1)

    assert job.main([]) == job.EXIT_FAILED

    assert len(world.posted) == n + 1
    assert world.run().ending()["stop_reason"] == f"{n} żądań z rzędu odrzuconych"


def test_the_cap_leaves_the_rest_to_the_next_run(world):
    world.payloads = [
        payload(OWNER_KRS, categories=[]),
        payload(PRIVATE_KRS, is_public=True),
    ]
    world.answers = [answer()]

    assert job.main(["--max-uploads", "1"]) == job.EXIT_TRY_LATER

    # What turns public goes first, so it is what a cap keeps.
    assert world.sent() == [PRIVATE_KRS]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "limit")


def test_sigterm_stops_the_run_after_the_company_in_hand(world):
    world.payloads = [
        payload(PRIVATE_KRS, is_public=True),
        payload(OWNER_KRS, categories=[]),
    ]
    world.answers = [answer(), answer()]
    asked = iter(["", "SIGTERM"])
    args = job.parse_args([])

    code = job.CompanyImport(args, lambda: next(asked)).run()

    assert code == job.EXIT_TRY_LATER
    assert world.sent() == [PRIVATE_KRS]
    assert world.run().ending()["stop_reason"] == "SIGTERM"


def test_a_part_that_cannot_be_written_sends_nothing(world):
    world.payloads = [payload(PRIVATE_KRS, is_public=True)]
    world.failing_writes = (job.PAYLOADS_PREFIX,)

    assert job.main([]) == job.EXIT_FAILED

    assert world.posted == []
    assert world.run().ending()["stop_reason"] == "nie zapisano paczek"


# ---------------------------------------------------------------------------
# The export, the build and the flags


def test_an_export_that_is_not_todays_is_refused_before_anything_is_built(world):
    world.export = STALE

    assert job.main([]) == job.EXIT_FAILED

    assert "build" not in world.events
    assert world.run().ending()["stop_reason"].startswith("brak dzisiejszej kopii bazy")


def test_the_export_the_night_took_stands_in_for_the_rule(world):
    """A night forced after midnight takes the export its export step took,
    as the people import does."""
    world.export = STALE
    world.clock = warsaw(TODAY, 3)
    world.payloads = [payload(PRIVATE_KRS, is_public=True)]
    world.answers = [answer()]

    assert job.main(["--export", STALE.stamp, "--koryta-date", STALE.stamp[:10]]) == 0

    assert world.built[0]["date"] == STALE.stamp[:10]


def test_the_build_holds_companies_and_rebuilds_only_the_stale_frames(world):
    world.stale = ["KorytaEdges"]

    job.main(["--dry-run"])

    policy = world.built[0]["policy"]
    assert policy.refresh_pipelines == {"KorytaEdges"}
    assert policy.exclude_refresh == {"Companies"}
    assert world.built[0]["date"] == TODAY


def test_companies_is_rebuilt_only_when_named():
    policy = job.build_policy(["Companies"], [])

    assert (policy.refresh_pipelines, policy.exclude_refresh) == ({"Companies"}, set())


def test_a_misspelt_refresh_is_refused():
    with pytest.raises(SystemExit):
        job.parse_args(["--refresh", "Compnies"])


def test_a_dry_run_signs_in_to_nothing_and_sends_and_writes_nothing(world):
    world.payloads = [
        payload(PRIVATE_KRS, is_public=True),
        payload(PUBLIC_KRS, is_public=False),
    ]

    assert job.main(["--dry-run"]) == 0

    assert "token" not in world.events
    assert world.posted == [] and world.objects == {}
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == (
        "succeeded",
        "próba - nic nie wysłano",
    )
    assert end["counters"]["planned"] == 1
    assert end["warnings"] == [f"{PUBLIC_KRS} FIRMA {PUBLIC_KRS}: stałaby się prywatna"]
