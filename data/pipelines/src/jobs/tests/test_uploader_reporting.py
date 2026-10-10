"""What `koryta_uploader --submit` tells /admin/procesy, and how it signs in.

Here rather than next to the uploader because the uploader is a top-level
module, and its tests in src/tests run with the pipeline suite.
"""

import argparse
import io
import json
import sys

import pytest
import requests

import uploader
from entities.composite import PersonScore
from stores.koryta_login import TokenError
from util.firestore import Firestore, vote_document, vote_id

ENDPOINT = "https://koryta.test"
PERSON_URL = f"{ENDPOINT}/api/ingest/person"
COMPANY_URL = f"{ENDPOINT}/api/ingest/company"


@pytest.fixture(autouse=True)
def no_sleeping(monkeypatch):
    monkeypatch.setattr(uploader.time, "sleep", lambda seconds: None)


class Response:
    def __init__(self, status_code: int = 200, body: object = None, text: str = ""):
        self.status_code = status_code
        self.body = body
        self.text = text or (json.dumps(body) if body is not None else "")

    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body


def person(outcome="updated", created=0, unplaced=0, dropped=()) -> Response:
    """What `/api/ingest/person` answers for a person it took."""
    body: dict = {
        "personId": "p1",
        "person": outcome,
        "companies": [
            {"nodeId": f"c{n}", "krs": f"{n:010d}", "created": n < created}
            for n in range(max(created, 1))
        ],
        "elections": [],
        "status": "ok",
    }
    if unplaced:
        body["unplacedElections"] = [
            {"election_type": "Sejm", "election_year": "1993", "expected": True}
        ] * unplaced
    if dropped:
        body["droppedChanges"] = list(dropped)
    return Response(200, body)


#: A job end the site kept its own of, as `/api/ingest/person` reports it.
KEPT_END = {
    "edgeId": "e1",
    "krs": "0000073772",
    "field": "end_date",
    "stored": "2026-07-01",
    "sent": "2026-08-25",
    "reason": "kept",
}


def missing(*krs: str) -> Response:
    return Response(404, {"message": "Missing companies", "data": list(krs)})


class Session:
    """The site, answering each URL from a script, one answer per request."""

    def __init__(self, **by_path: list):
        self.by_path = {f"{ENDPOINT}/api/ingest/{p}": a for p, a in by_path.items()}
        self.sent: list[tuple[str, dict | None, str]] = []

    def post(self, url, data=None, headers=None, timeout=None):
        body = json.loads(data) if data else None
        self.sent.append((url, body, (headers or {}).get("Authorization", "")))
        answer = self.by_path[url].pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    def names(self, url: str) -> list:
        return [body and body.get("name") for sent, body, _ in self.sent if sent == url]


class Tokens:
    """A token source whose token changes on every refresh."""

    who = "a test"
    interactive = False

    def __init__(self, refuse: bool = False):
        self.refuse = refuse
        self.refreshed = 0

    def token(self) -> str:
        return f"t{self.refreshed + 1}"

    def refresh(self) -> str:
        self.refreshed += 1
        if self.refuse:
            raise TokenError("cannot be renewed")
        return self.token()


class RecordingRun:
    """Stands in for `JobRun`, keeping what the uploader told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def __enter__(self):
        self.calls.append(("start", {}))
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.calls.append(("exit", {"raised": exc_type}))

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end

    def done(self) -> list:
        return [args["done"] for call, args in self.calls if call == "progress"]


@pytest.fixture
def runs(monkeypatch) -> list[RecordingRun]:
    made: list[RecordingRun] = []

    def record(job_id, **kwargs):
        made.append(RecordingRun(job_id, **kwargs))
        return made[-1]

    monkeypatch.setattr(uploader, "JobRun", record)
    return made


def args_for(kind: str, **overrides) -> argparse.Namespace:
    values = dict(
        endpoint=ENDPOINT,
        type=kind,
        submit=True,
        database="koryta-pl",
        limit=None,
        offset=0,
        model=None,
    )
    values.update(overrides)
    return argparse.Namespace(**values)


def submit(kind: str, entities: list, session: Session, tokens=None) -> None:
    uploader.submit(
        args_for(kind),  # type: ignore[arg-type]
        entities,
        tokens=tokens or Tokens(),
        session=session,  # type: ignore[arg-type]
    )


def people(*names: str) -> list[dict]:
    return [{"name": name, "companies": [], "elections": []} for name in names]


@pytest.fixture
def companies_on_file(monkeypatch):
    """`Companies`, which the uploader reads when a person names a company
    the site has no page for, without running it."""
    on_file = {
        krs: {"krs": krs, "name": f"Spółka {krs}", "parents": []}
        for krs in ("0000000001", "0000000002")
    }
    monkeypatch.setattr(
        uploader.CompanyUploader, "company_payloads", property(lambda self: on_file)
    )


# ---------------------------------------------------------------------------
# --type person


def test_a_person_run_counts_what_the_site_did_with_each_person(runs):
    session = Session(
        person=[person("created", created=2), person("updated", unplaced=1)]
        + [person("unchanged")]
    )
    rows = [*people("Anna Nowak", "Jan Kowalski", "Ewa Lis"), {"companies": []}]

    submit("person", rows, session)

    [run] = runs
    assert (run.job, run.kwargs) == ("people_import", {"unit": "osób", "total": 4})
    assert run.done() == [0, 1, 2, 3, 4]
    assert run.ending() == {
        "state": "succeeded",
        "stop_reason": None,
        "errors": [],
        "exit_code": 0,
        "counters": {
            "created": 1,
            "updated": 1,
            "unchanged": 1,
            "employments_created": 2,
            "companies_created": 0,
            "unplaced": 1,
            "dropped_changes": 0,
            "failed": 0,
            "skipped": 1,
        },
        "done": 4,
    }


def test_a_change_the_site_did_not_write_is_counted_and_printed(runs, capsys):
    """Every one printed as it comes, so the run's log says which and why."""
    removed = dict(KEPT_END, edgeId="e2", stored=None, reason="removed")
    session = Session(person=[person(dropped=[KEPT_END, removed]), person()])

    submit("person", people("Anna Konieczyńska", "Jan Kowalski"), session)

    [run] = runs
    assert run.ending()["counters"]["dropped_changes"] == 2
    assert run.ending()["state"] == "succeeded"
    err = capsys.readouterr().err
    assert (
        "Anna Konieczyńska: 0000073772 end_date: site 2026-07-01, payload "
        "2026-08-25 (the site's is kept; edge e1)"
    ) in err
    assert (
        "Anna Konieczyńska: 0000073772 end_date: site -, payload 2026-08-25 "
        "(the job is removed; edge e2)"
    ) in err


def test_a_site_from_before_the_field_reports_no_dropped_change(runs):
    session = Session(person=[Response(200, {"personId": "p1", "person": "updated"})])

    submit("person", people("Anna Nowak"), session)

    [run] = runs
    assert run.ending()["counters"]["dropped_changes"] == 0


def test_a_missing_company_is_created_first_and_the_person_sent_again(
    companies_on_file,
):
    session = Session(
        person=[missing("0000000002", "0000000001", "0000000002"), person("created")],
        company=[Response(200, {"company": "created"})] * 2,
    )
    instance = uploader.PersonUploader(
        args_for("person"),  # type: ignore[arg-type]
        tokens=Tokens(),
        session=session,  # type: ignore[arg-type]
    )

    result = instance.upload_person(people("Anna Nowak")[0])

    assert result == uploader.PersonResult(
        "created", status=200, companies_created=2, person_id="p1"
    )
    assert [url for url, _, _ in session.sent] == [
        PERSON_URL,
        COMPANY_URL,
        COMPANY_URL,
        PERSON_URL,
    ]
    assert [body["krs"] for url, body, _ in session.sent if url == COMPANY_URL] == [
        "0000000001",
        "0000000002",
    ]


def test_a_company_that_cannot_be_created_fails_the_person(companies_on_file):
    session = Session(
        person=[missing("0000000001")],
        company=[Response(500, text="Internal Server Error")],
    )
    instance = uploader.PersonUploader(
        args_for("person"),  # type: ignore[arg-type]
        tokens=Tokens(),
        session=session,  # type: ignore[arg-type]
    )

    result = instance.upload_person(people("Anna Nowak")[0])

    assert result == uploader.PersonResult(
        "failed", status=500, error="firma 0000000001: 500 Internal Server Error"
    )
    assert session.names(PERSON_URL) == ["Anna Nowak"]


def test_a_person_the_site_never_answered_is_a_failure_with_the_reason(capsys):
    session = Session(person=[requests.ConnectionError("connection reset")])
    instance = uploader.PersonUploader(
        args_for("person"),  # type: ignore[arg-type]
        tokens=Tokens(),
        session=session,  # type: ignore[arg-type]
    )

    instance.submit_results(people("Anna Nowak"))

    assert instance.counts["failed"] == 1
    assert instance.errors == ["Anna Nowak: ConnectionError: connection reset"]
    # Printed, as an exception always was: no answer printed it already.
    assert "[1] None Anna Nowak: ConnectionError" in capsys.readouterr().err


def test_some_refusals_make_the_run_partial_and_say_who(runs):
    page = "<html>" + "x" * 400
    session = Session(person=[person(), Response(500, text=page), person()])

    submit("person", people("Anna Nowak", "Jan Kowalski", "Ewa Lis"), session)

    end = runs[0].ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "nieudane: 1 z 3")
    assert end["errors"] == [f"Jan Kowalski: 500 {page[:300]}"]
    assert end["counters"]["failed"] == 1


def test_every_person_refused_is_the_site_refusing_the_run(runs):
    forbidden = Response(403, {"message": "You need to be a member of datascience"})
    session = Session(person=[forbidden, forbidden])

    submit("person", people("Anna Nowak", "Jan Kowalski"), session)

    end = runs[0].ending()
    assert (end["state"], end["stop_reason"]) == (
        "failed",
        "strona odrzuciła wszystkie wysyłki (2)",
    )


def test_only_the_first_twenty_errors_are_kept(runs):
    names = [f"Osoba {n}" for n in range(25)]
    session = Session(person=[Response(500, text="boom")] * 25)

    submit("person", people(*names), session)

    end = runs[0].ending()
    assert end["errors"] == [f"Osoba {n}: 500 boom" for n in range(20)]
    assert end["counters"]["failed"] == 25


def test_the_closing_line_counts_each_person_once(capsys):
    session = Session(person=[person(), Response(500, text="boom"), person()])
    instance = uploader.PersonUploader(
        args_for("person"),  # type: ignore[arg-type]
        tokens=Tokens(),
        session=session,  # type: ignore[arg-type]
    )

    instance.submit_results(people("Anna Nowak", "Jan Kowalski", "Ewa Lis"))

    assert "Upload complete. Success: 2, Failed: 1" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Signing in


def test_a_401_renews_the_token_once_and_sends_the_person_again(runs):
    tokens = Tokens()
    session = Session(person=[Response(401, text="token expired"), person()])

    submit("person", people("Anna Nowak"), session, tokens)

    assert tokens.refreshed == 1
    assert [auth for _, _, auth in session.sent] == ["Bearer t1", "Bearer t2"]
    assert runs[0].ending()["state"] == "succeeded"


def test_a_token_that_cannot_be_renewed_fails_the_person_and_is_asked_once(runs):
    tokens = Tokens(refuse=True)
    expired = Response(401, text="token expired")
    session = Session(person=[expired, expired])

    submit("person", people("Anna Nowak", "Jan Kowalski"), session, tokens)

    assert tokens.refreshed == 1
    end = runs[0].ending()
    assert end["state"] == "failed"
    assert end["errors"] == [
        "Anna Nowak: TokenError: cannot be renewed",
        "Jan Kowalski: 401 token expired",
    ]


def test_a_renewed_token_refused_too_is_not_renewed_again(runs):
    tokens = Tokens()
    expired = Response(401, text="no")
    session = Session(person=[expired, expired, expired])

    submit("person", people("Anna Nowak", "Jan Kowalski"), session, tokens)

    assert tokens.refreshed == 1
    assert len(session.sent) == 3


def test_a_sign_in_that_cannot_work_is_a_run_that_raised(monkeypatch, runs):
    def no_key(endpoint):
        raise TokenError("needs FIREBASE_WEB_API_KEY")

    monkeypatch.setattr(uploader, "token_source", no_key)

    with pytest.raises(TokenError):
        uploader.submit(args_for("person"), people("Anna Nowak"))  # type: ignore[arg-type]

    # Raised inside the `with`, which JobRun reports as failed.
    assert runs[0].calls[-1] == ("exit", {"raised": TokenError})


# ---------------------------------------------------------------------------
# The other types


def test_a_company_run_counts_uploads_refusals_and_skipped_rows(runs):
    session = Session(
        company=[Response(200, {"company": "updated"}), Response(500, text="boom")]
    )
    rows = [
        {"krs": "0000000001", "name": "Spółka 1", "owners": [], "owner_teryts": []},
        {"krs": "0000000002", "name": "Spółka 2", "owners": [], "owner_teryts": []},
        {"krs": "0000000003"},
    ]

    submit("company", rows, session)

    [run] = runs
    assert (run.job, run.kwargs) == ("company_import", {"unit": "firm", "total": 3})
    end = run.ending()
    assert end["counters"] == {"uploaded": 1, "failed": 1, "skipped": 1}
    assert (end["state"], end["stop_reason"]) == ("partial", "nieudane: 1 z 2")
    assert end["errors"] == ["0000000002: 500 boom"]


class Votes:
    def __init__(self, documents: dict[str, dict]):
        self.documents = documents

    def scores(self, model: str) -> dict[str, int]:
        return {
            d["nodeId"]: d["categoryVotes"]["interesting"]
            for d in self.documents.values()
        }

    def apply(self, model, changed, stale):
        pass


def test_a_score_run_counts_what_it_wrote_retracted_and_left(monkeypatch, runs):
    stored = {
        vote_id(node, "pipeline-x"): vote_document(node, "pipeline-x", 3)
        for node in ("same", "gone")
    }
    monkeypatch.setattr(
        uploader, "Firestore", lambda args, login=None: Firestore(None, Votes(stored))
    )
    rows = [
        PersonScore(node_id="same", name="A", score=3, model="pipeline-x").__dict__,
        PersonScore(node_id="new", name="B", score=2, model="pipeline-x").__dict__,
    ]

    submit("score", rows, Session())

    [run] = runs
    assert (run.job, run.kwargs) == ("score_import", {"unit": "ocen", "total": 2})
    end = run.ending()
    assert end["counters"] == {"written": 1, "retracted": 1, "unchanged": 1}
    assert (end["state"], end["done"]) == ("succeeded", 2)


def test_an_extraction_run_counts_articles_and_facts(runs):
    articles = [
        {"url": "a", "extracted_facts": [{}, {}]},
        {"url": "b", "extracted_facts": [{}]},
    ]
    session = Session(extraction=[Response(200, {"count": 3})])

    submit("extraction", articles, session)

    [run] = runs
    assert (run.job, run.kwargs["unit"]) == ("extraction_import", "artykułów")
    assert run.ending()["counters"] == {"articles": 2, "facts": 3}


def test_an_extraction_the_site_refuses_raises_out_of_the_reported_run(runs):
    session = Session(extraction=[Response(500, text="boom")])

    with pytest.raises(Exception, match="API error: 500"):
        submit("extraction", [{"url": "a", "extracted_facts": [{}]}], session)

    assert runs[0].calls[-1] == ("exit", {"raised": Exception})
    assert [call for call, _ in runs[0].calls].count("finish") == 0


def test_a_recount_reports_nothing(runs):
    session = Session()
    session.by_path[f"{ENDPOINT}/api/stats/computeNodes"] = [Response(200, {})]

    submit("computeNodes", [{}], session)

    assert runs == []
    assert len(session.sent) == 1


def run_main(monkeypatch, argv: list[str], rows: list[dict]) -> None:
    monkeypatch.setattr(sys, "argv", ["koryta_uploader", *argv])
    lines = "".join(json.dumps(row) + "\n" for row in rows)
    monkeypatch.setattr(sys, "stdin", io.StringIO(lines))
    uploader.main()


def test_a_preview_reports_nothing(monkeypatch, runs):
    run_main(monkeypatch, ["--type", "person"], people("Anna Nowak"))

    assert runs == []


def test_a_submitted_run_is_reported_under_its_type(monkeypatch, runs):
    session = Session(person=[person(), person()])
    monkeypatch.setattr(uploader, "token_source", lambda endpoint: Tokens())
    monkeypatch.setattr(uploader.requests, "Session", lambda: session)

    run_main(
        monkeypatch,
        ["--type", "person", "--submit", "--endpoint", ENDPOINT, "--offset", "1"],
        people("Anna Nowak", "Jan Kowalski", "Ewa Lis"),
    )

    [run] = runs
    assert (run.job, run.kwargs) == ("people_import", {"unit": "osób", "total": 2})
    assert session.names(PERSON_URL) == ["Jan Kowalski", "Ewa Lis"]
