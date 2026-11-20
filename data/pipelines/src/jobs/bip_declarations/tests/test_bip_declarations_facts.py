"""The declarations in people: the facts predator writes for each candidacy,
and what the night hands the site. No Postgres, no bucket and no site: a
memory store, a fake shared cache and a fake site."""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
import requests

import jobs.bip_declarations as job
from analysis.utils.names import FirstNameFreq, NamesCountByRegion
from jobs.bip_declarations.facts import read_facts, site_rows
from jobs.bip_declarations.names import Names, read_names
from jobs.bip_declarations.tests.test_bip_declarations_upload import (
    Response,
    Session,
    Tokens,
)
from jobs.bip_declarations.upload import Site, SiteUnavailable, UploadResult, plan
from scrapers.stores import (
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationLink,
    PersonRow,
    SentRow,
)
from stores.bip_declaration_facts import FACTS_PREFIX, CandidacyFacts, FactsPart
from stores.bip_declarations import MemoryBipDeclarationStore
from stores.koryta_login import TokenError
from stores.storage import warsaw_tz
from stores.tests.test_bip_found import Shared

PNG = b"\x89PNG\r\n\x1a\n made up"
URL = "https://bip.testowo.example/oswiadczenia"
NAMES = Names(
    surnames={"M": {"KOWALSKI": 30_000, "RZADKI": 10}, "K": {"NOWAK": 6_000}},
    first_names={"M": {"JAN": 100}, "K": {"ANNA": 100}},
)


def candidacy(
    key: str,
    *,
    status: str = "found",
    reason: str = "named",
    first: str = "Jan",
    last: str = "Kowalski",
    pages: list[str] | None = None,
) -> PersonRow:
    return PersonRow(
        key=key,
        unit="021704",
        priority=0,
        election_year=2024,
        first_name=first,
        last_name=last,
        person={
            "koryta_ids": [f"page-{key}"] if pages is None else pages,
            "teryt": "021704",
            "unit_level": "gmina",
            "unit_name": "Testowo (gmina wiejska)",
            "office": "Rada gminy",
            "pkw_age": 55,
        },
        status=status,
        reason=reason,
        docs=1,
    )


def link(key: str, sha: str, named: bool = True) -> DeclarationLink:
    return DeclarationLink(key, sha, f"{URL}/{sha[:4]}.pdf", URL, "", "", named)


def crop(sha: str, page: int = 0, name: str = "") -> DeclarationCropRow:
    return DeclarationCropRow(
        sha, page, sort="ocr", birth_date="", name=name, date_png=PNG, name_png=PNG
    )


(
    CROPPED,
    SENT,
    NOT_CUT,
    OLD_CUT,
    NO_LABEL,
    COUNCIL,
    FOR_GOOD,
    AGAIN,
    NO_PAGE,
    CHANGED,
) = (c * 64 for c in "abcdef0123")

CANDIDACIES = [
    candidacy("k-cropped"),
    candidacy("k-sent"),
    candidacy("k-not-cut"),
    candidacy("k-old-cut"),
    candidacy("k-no-label"),
    # Only a council's file came down for him, and no page of it is his.
    candidacy("k-council", status="unconfirmed", reason="unnamed"),
    # Her name is on a page of the same file.
    candidacy(
        "k-on-council",
        status="unconfirmed",
        reason="unnamed",
        first="Anna",
        last="Nowak",
    ),
    candidacy("k-for-good"),
    candidacy("k-again"),
    candidacy("k-changed"),
    candidacy("k-no-page", pages=[]),
    candidacy("k-blocked", status="not_found", reason="unreachable"),
    candidacy("k-never", status="pending", reason=""),
]


@pytest.fixture
def store() -> MemoryBipDeclarationStore:
    store = MemoryBipDeclarationStore(
        [*CANDIDACIES],
        links=[
            link("k-cropped", CROPPED),
            link("k-sent", SENT),
            link("k-not-cut", NOT_CUT),
            link("k-old-cut", OLD_CUT),
            link("k-no-label", NO_LABEL),
            link("k-council", COUNCIL, named=False),
            link("k-on-council", COUNCIL, named=False),
            link("k-for-good", FOR_GOOD),
            link("k-again", AGAIN),
            link("k-changed", CHANGED),
            link("k-no-page", NO_PAGE),
            # Somebody the list no longer looks for.
            link("k-gone", NOT_CUT),
        ],
    )
    for sha in (CROPPED, SENT, FOR_GOOD, AGAIN, NO_PAGE, CHANGED):
        store.record_cut(DeclarationCutRow(sha, 1, "cut"), [crop(sha)])
    store.record_cut(DeclarationCutRow(OLD_CUT, 0, "cut"), [crop(OLD_CUT)])
    store.record_cut(DeclarationCutRow(NO_LABEL, 1, "no_label"), [])
    store.record_cut(
        DeclarationCutRow(COUNCIL, 1, "cut"),
        [crop(COUNCIL, 0, "Anna Nowak"), crop(COUNCIL, 1, "Ktos Obcy")],
    )
    # Each extract's record as the upload would send it now.
    now = {extract.id: extract.digest for extract in plan(store)[1]}
    store.record_sent(
        [
            # Sent before the crop was cut again: the site holds a crop of it.
            SentRow("extract", f"{SENT}-p0", "older", "stored"),
            SentRow(
                "extract",
                f"{FOR_GOOD}-p0",
                now[f"{FOR_GOOD}-p0"],
                "skipped",
                "no_site_person",
            ),
            SentRow(
                "extract",
                f"{AGAIN}-p0",
                now[f"{AGAIN}-p0"],
                "skipped",
                "unknown_candidacy",
            ),
            SentRow("extract", f"{CHANGED}-p0", "older", "skipped", "no_site_person"),
        ],
        "run",
    )
    return store


def test_each_candidacy_has_its_search_and_what_was_done_with_its_files(store):
    facts = read_facts(store, version=1)

    said = {f.key: (f.status, f.reason, f.uncut, f.cut_named, f.waiting) for f in facts}
    assert said == {
        # A crop cut and not sent: waiting for the upload.
        "k-cropped": ("found", "named", False, True, True),
        "k-sent": ("found", "named", False, True, False),
        "k-not-cut": ("found", "named", True, False, False),
        # Cut by an older cutter: due a cut again, its crop going up meanwhile.
        "k-old-cut": ("found", "named", True, False, True),
        # Cut, with no date's line: nothing to send but the failure.
        "k-no-label": ("found", "named", False, True, False),
        # A council's page counts only for whose name is read on it, and the
        # file names neither of them.
        "k-council": ("unconfirmed", "unnamed", False, False, False),
        "k-on-council": ("unconfirmed", "unnamed", False, False, True),
        # Skipped for good, the crop will not come; skipped for want of its
        # candidacy, or changed since it was skipped, the upload sends it again.
        "k-for-good": ("found", "named", False, True, False),
        "k-again": ("found", "named", False, True, True),
        "k-changed": ("found", "named", False, True, True),
        # No page on the site: the upload sends none of their crops.
        "k-no-page": ("found", "named", False, True, False),
        "k-blocked": ("not_found", "unreachable", False, False, False),
        "k-never": ("pending", "", False, False, False),
    }
    assert [f.key for f in facts] == sorted(said)


def test_a_new_cutter_leaves_every_file_uncut(store):
    facts = read_facts(store, version=2)

    linked = {f.key for f in facts} - {"k-blocked", "k-never"}
    assert {f.key for f in facts if f.uncut} == linked
    assert not any(f.cut_named for f in facts)


def test_the_part_holds_no_name_date_hash_url_or_page(store):
    shared = Shared()

    url = job.publish_facts(store, shared, datetime(2026, 11, 17, 6, 5, 4, tzinfo=UTC))  # type: ignore[arg-type]

    [(name, part)] = shared.objects.items()
    assert url == f"gs://koryta-pl-sharedcache/{name}"
    text = gzip.decompress(part).decode("utf-8")
    lines = [json.loads(line) for line in text.splitlines()]
    assert len(lines) == len(CANDIDACIES)
    assert {tuple(sorted(line)) for line in lines} == {
        ("cutNamed", "key", "reason", "status", "uncut", "waiting")
    }
    for secret in ("Jan", "Kowalski", "Anna", "Nowak", "Ktos", "Testowo", "page-"):
        assert secret not in text
    for secret in ("http", "bip.", "021704", "2024", "1970", "a" * 64, "c" * 64):
        assert secret not in text


# --- the hooks ----------------------------------------------------------------


@pytest.fixture
def shared(monkeypatch, store) -> Shared:
    shared = Shared()
    monkeypatch.setattr(job, "Client", lambda: shared)
    monkeypatch.setattr(job, "store_with_list", lambda: store)
    monkeypatch.setattr(job, "token_source", lambda endpoint: Tokens())
    return shared


def test_a_cut_writes_a_part_and_keeps_its_exit_code(shared, monkeypatch):
    monkeypatch.setattr(job, "run_cut", lambda *a, **k: job.EXIT_TRY_LATER)

    assert job.main(["cut"]) == job.EXIT_TRY_LATER

    [name] = shared.objects
    assert name.startswith(FACTS_PREFIX)


def test_an_interrupted_cut_writes_none(shared, monkeypatch):
    monkeypatch.setattr(job, "run_cut", lambda *a, **k: job.EXIT_INTERRUPTED)

    assert job.main(["cut"]) == job.EXIT_INTERRUPTED

    assert shared.objects == {}


def test_a_part_not_written_is_said_and_changes_nothing(shared, monkeypatch, capsys):
    def no_bucket() -> Shared:
        raise RuntimeError("no credentials")

    monkeypatch.setattr(job, "Client", no_bucket)
    monkeypatch.setattr(job, "run_cut", lambda *a, **k: 0)

    assert job.main(["cut"]) == 0

    assert "declaration facts: not written: no credentials" in capsys.readouterr().err


def test_a_real_upload_writes_a_part_and_a_dry_run_none(shared, monkeypatch):
    monkeypatch.setattr(job, "upload", lambda *a, **k: UploadResult())

    assert job.main(["upload", "--dry-run"]) == 0
    assert shared.objects == {}

    assert job.main(["upload"]) == 0
    assert len(shared.objects) == 1


def test_an_upload_the_site_did_not_take_still_writes_a_part(shared, monkeypatch):
    def down(*args: Any, **kwargs: Any) -> UploadResult:
        raise SiteUnavailable("down")

    monkeypatch.setattr(job, "upload", down)

    assert job.main(["upload"]) == job.EXIT_TRY_LATER
    assert len(shared.objects) == 1


# --- the night ----------------------------------------------------------------


def key(n: int) -> str:
    return f"{n:016x}"


def listed(n: int, pages: list[str], **kwargs: Any) -> PersonRow:
    return candidacy(key(n), pages=pages, **kwargs)


PEOPLE = [
    listed(4, ["anna"], first="Anna", last="Nowak"),
    listed(1, ["jan"]),
    listed(2, ["a", "b", "c", "d", "e", "f"], last="Rzadki"),
    listed(3, []),
]
FACTS = {
    key(1): CandidacyFacts(key(1), "not_found", "unreachable", uncut=True),
    key(2): CandidacyFacts(key(2), "found", "named", cut_named=True, waiting=True),
    key(3): CandidacyFacts(key(3), "found", "named"),
}


def test_the_night_sends_a_row_a_candidacy_with_a_page():
    built = site_rows(PEOPLE, FACTS, NAMES)

    base = {"teryt": "021704", "unitName": "Testowo (gmina wiejska)", "year": 2024}
    assert built.rows == [
        {
            "key": key(1),
            "kids": ["jan"],
            **base,
            "status": "not_found",
            "reason": "unreachable",
            "uncut": True,
            "cutNamed": False,
            "waiting": False,
            "bearers": 30_000,
        },
        {
            "key": key(2),
            # The site takes five pages at most.
            "kids": ["a", "b", "c", "d", "e"],
            **base,
            "status": "found",
            "reason": "named",
            "uncut": False,
            "cutNamed": True,
            "waiting": True,
            "bearers": 10,
        },
        # New on the list since predator's part: nothing done for it yet.
        {
            "key": key(4),
            "kids": ["anna"],
            **base,
            "status": "pending",
            "reason": "",
            "uncut": False,
            "cutNamed": False,
            "waiting": False,
            "bearers": 6_000,
        },
    ]
    assert (built.not_in_part, built.left_out) == (1, 0)
    # A candidacy listed twice is one row.
    assert site_rows([*PEOPLE, PEOPLE[1]], FACTS, NAMES).rows == built.rows


def test_a_row_the_site_would_refuse_is_left_out_and_a_new_status_is_pending():
    odd = [
        listed(5, ["p"], status="found"),
        PersonRow(
            "not-hex", "021704", 0, 2024, "Jan", "Kowalski", {"koryta_ids": ["q"]}
        ),
        PersonRow(key(6), "0217", 0, 2024, "Jan", "Kowalski", {"koryta_ids": ["r"]}),
    ]
    facts = {key(5): CandidacyFacts(key(5), "searching", "x", waiting=True)}

    built = site_rows(odd, facts, NAMES)

    [row] = built.rows
    assert (row["status"], row["reason"], row["waiting"]) == ("pending", "", True)
    assert built.unknown_status == {"searching": 1}
    assert built.left_out == 2


PART = FactsPart(
    f"gs://koryta-pl-sharedcache/{FACTS_PREFIX}date=2026-11-17/2026-11-17T060504Z.jsonl.gz",
    datetime(2026, 11, 17, 6, 5, 4, tzinfo=UTC),
    FACTS,
)
NOW = datetime(2026, 11, 17, 5, 40, 1, 234_000, tzinfo=UTC)
COUNTED = {
    "status": "ok",
    "people": 3,
    "stages": {"published": 0, "searching": 3},
    "unknownReasons": {"error": 1},
}


def site(*answers: Response | Exception) -> tuple[Site, Session]:
    session = Session(*answers)
    to = Site("https://autopush.example", Tokens(), session, sleep=lambda _: None)
    return to, session


def send(to: Site | None, list_at: datetime | None = None, force: bool = False) -> int:
    return job.send_facts(
        to, PART, PEOPLE, NAMES, list_at=list_at, now=NOW, force=force
    )


def test_send_facts_hands_the_site_the_rows_and_where_they_came_from(capsys):
    to, session = site(Response(200, COUNTED))
    list_at = datetime(2026, 11, 17, 5, 20, 31, tzinfo=warsaw_tz)

    assert send(to, list_at=list_at) == 0

    [call] = session.calls
    assert call["url"] == "https://autopush.example/api/ingest/declarations/facts"
    body = call["json"]
    assert {k: v for k, v in body.items() if k != "candidacies"} == {
        "generation": "2026-11-17T05:40:01.234Z",
        "listAt": "2026-11-17T04:20:31.000Z",
        "part": PART.url,
        "partAt": "2026-11-17T06:05:04.000Z",
    }
    assert [row["key"] for row in body["candidacies"]] == [key(1), key(2), key(4)]
    out = capsys.readouterr().out
    # A reason the site counted as pending is said, never left silent.
    assert "3 people: published 0, searching 3" in out
    assert "{'error': 1}" in out


def test_send_facts_forced_and_dry():
    to, session = site(Response(200, COUNTED))

    assert send(to, force=True) == 0
    assert session.calls[0]["json"]["force"] is True
    assert session.calls[0]["json"]["listAt"] is None
    assert send(None) == 0


@pytest.mark.parametrize(
    ("answers", "code"),
    [
        # The endpoint not deployed yet: the next night tries again.
        ([Response(404, "Page not found")], job.EXIT_TRY_LATER),
        ([Response(503)] * 2, job.EXIT_TRY_LATER),
        ([Response(400, "candidacies: too big")], 1),
        ([Response(409, "a newer count")], 1),
        # The count's own error again after a wait: a bug, shown on the night.
        ([Response(500)] * 2, 1),
        ([Response(500), Response(503)], job.EXIT_TRY_LATER),
        ([Response(500), Response(200, COUNTED)], 0),
    ],
)
def test_send_facts_exit_codes(answers, code):
    to, session = site(*answers)

    assert send(to) == code
    # No try past the answers given: the site counts on every one.
    assert session.answers == []


def test_the_facts_get_two_tries_that_end_inside_the_nights_step() -> None:
    waits: list[float] = []
    session = Session(requests.ReadTimeout("read"), requests.ReadTimeout("read"))
    to = Site("https://autopush.example", Tokens(), session, sleep=waits.append)

    assert send(to) == job.EXIT_TRY_LATER

    # Two counts of 5 minutes at most and one wait: the night stops the step
    # at 15 minutes, and a step it stops fails the night.
    assert [call["timeout"] for call in session.calls] == [300, 300]
    assert waits == [30]


def test_send_facts_with_no_token_or_nobody_with_a_page_fails():
    class NoToken(Tokens):
        def token(self) -> str:
            raise TokenError("exchange refused")

    to = Site("https://a", NoToken(), Session(), sleep=lambda _: None)
    assert send(to) == 1

    to, session = site(Response(200, COUNTED))
    nobody = [listed(9, [])]
    assert job.send_facts(to, PART, nobody, NAMES, list_at=None, now=NOW) == 1
    assert session.calls == []


class Bucket(Shared):
    """The shared cache, with the night's list backed up at 05:20 Warsaw."""

    def latest_backup_datetime(self, filename: str) -> str:
        assert filename == "bip_people_of_interest"
        return "2026-11-17T05:20:31"


def test_the_lists_time_is_its_backups_in_warsaw_or_none():
    assert job.list_built_at(Bucket()) == datetime(  # type: ignore[arg-type]
        2026, 11, 17, 5, 20, 31, tzinfo=warsaw_tz
    )
    assert job.list_built_at(Shared()) is None  # type: ignore[arg-type]


@pytest.fixture
def night(monkeypatch) -> Bucket:
    """send-facts as the night runs it, with its sources faked."""
    bucket = Bucket()
    monkeypatch.setattr(job, "Client", lambda: bucket)
    monkeypatch.setattr(job, "token_source", lambda endpoint: Tokens())
    monkeypatch.setattr(job, "setup_context", lambda policy: (SimpleNamespace(), None))
    monkeypatch.setattr(job, "read_list", lambda ctx: PEOPLE)
    monkeypatch.setattr(job, "read_names", lambda ctx: NAMES)
    return bucket


def test_send_facts_without_a_part_tries_later_and_without_a_list_fails(
    night, monkeypatch
):
    assert job.main(["send-facts"]) == job.EXIT_TRY_LATER

    job.publish_facts(
        MemoryBipDeclarationStore(PEOPLE), night, datetime(2026, 11, 17, tzinfo=UTC)
    )  # type: ignore[arg-type]

    def no_list(ctx: object) -> list[PersonRow]:
        raise FileNotFoundError("bip_people_of_interest")

    monkeypatch.setattr(job, "read_list", no_list)
    assert job.main(["send-facts"]) == 1


def test_send_facts_tries_later_when_the_bucket_gives_no_part(
    night, monkeypatch, capsys
):
    # A part that does not read waits for predator's next.
    night.objects[f"{FACTS_PREFIX}date=2026-11-17/2026-11-17T060504Z.jsonl.gz"] = (
        b"not gzip"
    )

    assert job.main(["send-facts"]) == job.EXIT_TRY_LATER
    assert "declaration facts: not read: " in capsys.readouterr().err

    def down(prefix: str, fields: str | None = None) -> list[object]:
        raise ConnectionError("the bucket is down")

    monkeypatch.setattr(night, "list_blobs", down)

    assert job.main(["send-facts"]) == job.EXIT_TRY_LATER
    assert "declaration facts: not read: the bucket is down" in capsys.readouterr().err


def test_send_facts_without_pesels_tables_tries_later(night, monkeypatch, capsys):
    job.publish_facts(
        MemoryBipDeclarationStore(PEOPLE), night, datetime(2026, 11, 17, tzinfo=UTC)
    )  # type: ignore[arg-type]

    def no_tables(ctx: object) -> Names:
        raise ConnectionError("dane.gov.pl did not answer")

    monkeypatch.setattr(job, "read_names", no_tables)

    assert job.main(["send-facts"]) == job.EXIT_TRY_LATER
    assert "PESEL's name tables: not read: dane.gov.pl" in capsys.readouterr().err


def test_send_facts_sends_the_newest_part(night, monkeypatch, capsys):
    job.publish_facts(
        MemoryBipDeclarationStore(PEOPLE), night, datetime(2026, 11, 17, tzinfo=UTC)
    )  # type: ignore[arg-type]
    posts: list[tuple[str, dict[str, Any]]] = []

    class Posted:
        endpoint = "https://autopush.example"

        def __init__(self, endpoint: str, tokens: object) -> None:
            pass

        def post(
            self, path: str, body: dict[str, Any], **kwargs: Any
        ) -> dict[str, Any]:
            posts.append((path, body))
            return COUNTED

    monkeypatch.setattr(job, "Site", Posted)

    assert job.main(["send-facts"]) == 0

    [(path, body)] = posts
    assert path == job.FACTS_INGEST
    assert body["listAt"] == "2026-11-17T04:20:31.000Z"
    assert body["partAt"] == "2026-11-17T00:00:00.000Z"
    assert [row["status"] for row in body["candidacies"]] == ["found"] * 3


# --- names --------------------------------------------------------------------


def test_bearers_go_by_the_sex_that_carries_the_first_name():
    assert NAMES.bearers("Jan", "Kowalski") == 30_000
    assert NAMES.bearers("jan maria", " kowalski ") == 30_000
    assert NAMES.bearers("Anna", "Nowak") == 6_000
    # A first name PESEL does not list is a woman's when it ends in a.
    assert (NAMES.sex("Kunegunda"), NAMES.sex("Bogumił")) == ("K", "M")
    assert NAMES.bearers("Jan", "Kowalski-Nowak") == 0


def test_the_pesel_tables_are_read_from_the_download_cache():
    surnames = "Województwo zameldowania na pobyt stały,Nazwisko aktualne,Liczba\n"
    first = "IMIĘ_PIERWSZE,PŁEĆ,LICZBA_WYSTĄPIEŃ\n"
    tables = {
        id(NamesCountByRegion.surnames[0]): surnames
        + "DOLNOŚLĄSKIE,KOWALSKI,4043\nMAZOWIECKIE,KOWALSKI,9000\n",
        id(NamesCountByRegion.surnames[1]): surnames + "MAZOWIECKIE,NOWAK,6000\n",
        # A byte order mark, as Excel saves one.
        id(FirstNameFreq.firstnames[0]): "﻿" + first + "JAN,MĘŻCZYZNA,470073\n",
        id(FirstNameFreq.firstnames[1]): first + "ANNA,KOBIETA,500000\n",
    }
    ctx = SimpleNamespace(
        io=SimpleNamespace(
            read_data=lambda ref: SimpleNamespace(
                read_bytes=lambda: tables[id(ref)].encode("utf-8")
            )
        )
    )

    names = read_names(ctx)  # type: ignore[arg-type]

    assert names.bearers("Jan", "Kowalski") == 13_043
    assert names.bearers("Anna", "Nowak") == 6_000
    assert names.first_names["M"] == {"JAN": 470_073}
