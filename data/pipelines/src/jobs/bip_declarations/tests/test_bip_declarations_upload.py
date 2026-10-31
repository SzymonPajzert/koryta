"""What goes to /api/ingest/declarations, and when: no site, no Postgres."""

from __future__ import annotations

import base64
import copy
from dataclasses import replace
from typing import Any

import pytest
import requests

from jobs.bip_declarations.upload import (
    INGEST,
    MAX_EXTRACTS_PER_REQUEST,
    SWEEP,
    Extract,
    Site,
    SiteError,
    SiteUnavailable,
    batches,
    plan,
    upload,
)
from scrapers.stores import (
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    DeclarationLink,
    PersonRow,
)
from stores.bip_declarations import MemoryBipDeclarationStore

SHA_ONE = "a" * 64  # Jan Testowy's own declaration
SHA_COUNCIL = "c" * 64  # a council's file: Anna's, a stranger's, Ewa's blank one
SHA_NOTHING = "f" * 64  # Jan's other file, where no label was found
PNG = b"\x89PNG\r\n\x1a\n made up"


def person(
    key: str, first: str, last: str, year: int, age: int, kids: list[str]
) -> PersonRow:
    return PersonRow(
        key=key,
        unit="021704",
        priority=0 if kids else 2,
        election_year=year,
        first_name=first,
        last_name=last,
        person={
            "koryta_ids": kids,
            "teryt": "021704",
            "unit_level": "gmina",
            "unit_name": "Testowo (gmina wiejska)",
            "office": "Rada gminy",
            "pkw_age": age,
        },
        status="found",
        reason="named",
        docs=1,
    )


# Jan was born on 1965-03-12: 60 on 2025-03-17, 53 on 2018-10-21.
JAN_2024 = person("1" * 16, "Jan", "Testowy", 2024, 60, ["jan-page"])
JAN_2018 = person("2" * 16, "Jan", "Testowy", 2018, 53, ["jan-page"])
ANNA = person("3" * 16, "Anna", "Przykladowa", 2024, 50, ["anna-page"])
EWA = person("4" * 16, "Ewa", "Probna", 2024, 45, ["ewa-page"])
NOT_ON_SITE = person("5" * 16, "Adam", "Nieobecny", 2024, 40, [])


def link(key: str, sha: str, named: bool) -> DeclarationLink:
    return DeclarationLink(
        key,
        sha,
        f"https://bip.testowo.example/{sha[:4]}.pdf",
        "https://bip.testowo.example/oswiadczenia",
        "Oświadczenie majątkowe",
        "",
        named,
    )


def crop(sha: str, page: int, sort: str, born: str, name: str) -> DeclarationCropRow:
    return DeclarationCropRow(
        sha,
        page,
        sort=sort,
        birth_date=born,
        score=1.0 if born else 0.4,
        name=name,
        declaration_year=2023,
        date_png=b"" if sort == "blank" else PNG,
        name_png=PNG,
    )


@pytest.fixture
def store() -> MemoryBipDeclarationStore:
    people = [JAN_2024, JAN_2018, ANNA, EWA, NOT_ON_SITE]
    links = [
        link(JAN_2024.key, SHA_ONE, True),
        link(JAN_2018.key, SHA_ONE, True),
        # A council's file the crawler kept for Ewa too, as one of the unit's
        # unnamed files: Jan's own file is not Ewa's.
        link(EWA.key, SHA_ONE, False),
        link(ANNA.key, SHA_COUNCIL, False),
        link(EWA.key, SHA_COUNCIL, False),
        link(NOT_ON_SITE.key, SHA_COUNCIL, False),
        link(JAN_2024.key, SHA_NOTHING, True),
    ]
    files = [
        DeclarationFile(sha, "bip.testowo.example", "", "b.tar.gz", "x.pdf")
        for sha in (SHA_ONE, SHA_COUNCIL, SHA_NOTHING)
    ]
    store = MemoryBipDeclarationStore(
        people, files, links, roots={"021704": ["https://bip.testowo.example/"]}
    )
    store.record_cut(
        DeclarationCutRow(SHA_ONE, 1, "cut"),
        [crop(SHA_ONE, 0, "text_layer", "1965-03-12", "Jan Testowy")],
    )
    store.record_cut(
        DeclarationCutRow(SHA_COUNCIL, 1, "cut"),
        [
            crop(SHA_COUNCIL, 0, "handwritten", "", "Anna Przykladowa"),
            crop(SHA_COUNCIL, 1, "ocr", "1970-01-01", "Ktos Obcy"),
            crop(SHA_COUNCIL, 2, "blank", "", "Ewa Probna"),
        ],
    )
    store.record_cut(DeclarationCutRow(SHA_NOTHING, 1, "no_label"), [])
    return store


def by_id(extracts: list[Extract]) -> dict[str, dict[str, Any]]:
    return {e.id: e.record for e in extracts}


def test_only_candidacies_with_a_page_on_the_site_go(store):
    candidacies, _ = plan(store)

    records = {record["key"]: record for record, _ in candidacies}
    assert set(records) == {JAN_2024.key, JAN_2018.key, ANNA.key, EWA.key}
    assert records[JAN_2024.key] == {
        "key": JAN_2024.key,
        "kids": ["jan-page"],
        "teryt": "021704",
        "level": "gmina",
        "office": "Rada gminy",
        "year": 2024,
        "status": "found",
        "reason": "named",
        "files": 1,
        "unitName": "Testowo (gmina wiejska)",
        "bipUrls": ["https://bip.testowo.example/"],
    }


def test_a_typed_date_in_every_pkw_window_settles_without_readers(store):
    _, extracts = plan(store)

    one = by_id(extracts)[f"{SHA_ONE}-p0"]
    # Jan's two candidacies, not Ewa's: Jan's own file is no council's.
    assert one["candidacies"] == [JAN_2024.key, JAN_2018.key]
    assert one["linkNamed"] is True
    assert one["outcome"] == "read"
    assert one["machine"] == {
        "birthDate": "1965-03-12",
        "confidence": "high",
        "method": "text_layer",
        "inPkwWindow": "yes",
        "name": "Jan Testowy",
        "nameMatches": True,
    }
    assert one["declarationYear"] == 2023
    assert one["pageUrl"] == "https://bip.testowo.example/oswiadczenia"


def test_a_typed_date_outside_a_window_goes_to_readers(store):
    store.people[1] = replace(JAN_2018, person={**JAN_2018.person, "pkw_age": 40})

    _, extracts = plan(store)

    one = by_id(extracts)[f"{SHA_ONE}-p0"]
    assert one["outcome"] == "crop"
    assert one["machine"]["confidence"] == "medium"
    assert one["machine"]["inPkwWindow"] == "no"


def test_a_councils_page_goes_to_the_candidacy_whose_name_is_on_it(store):
    _, extracts = plan(store)
    records = by_id(extracts)

    anna = records[f"{SHA_COUNCIL}-p0"]
    assert anna["candidacies"] == [ANNA.key]
    assert anna["linkNamed"] is False
    assert anna["machine"]["nameMatches"] is True
    assert anna["outcome"] == "crop"
    # A stranger's page goes to nobody; Ewa's blank one says so.
    assert f"{SHA_COUNCIL}-p1" not in records
    ewa = records[f"{SHA_COUNCIL}-p2"]
    assert (ewa["candidacies"], ewa["outcome"], ewa["reason"]) == (
        [EWA.key],
        "failed",
        "blank_field",
    )


def test_a_file_that_gave_no_crop_is_a_failed_extract(store):
    _, extracts = plan(store)

    nothing = by_id(extracts)[f"{SHA_NOTHING}-p0"]
    assert (nothing["candidacies"], nothing["outcome"], nothing["reason"]) == (
        [JAN_2024.key],
        "failed",
        "no_label",
    )


class FakeSite:
    """Takes every request, skipping what `skip` names, and keeps them all."""

    def __init__(self, skip: dict[str, str] | None = None):
        self.posts: list[tuple[str, dict[str, Any]]] = []
        self.skip = skip or {}

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        self.posts.append((path, copy.deepcopy(body)))
        if path == SWEEP:
            return {"compared": 0}
        return {
            "status": "ok",
            "candidacies": {
                "skipped": [
                    {"key": c["key"], "reason": self.skip[c["key"]]}
                    for c in body.get("candidacies", [])
                    if c["key"] in self.skip
                ]
            },
            "extracts": {
                "skipped": [
                    {
                        "id": f"{e['sha256']}-p{e['page']}",
                        "reason": self.skip[e["sha256"]],
                    }
                    for e in body.get("extracts", [])
                    if e["sha256"] in self.skip
                ]
            },
        }


def test_upload_sends_candidacies_then_extracts_then_sweeps(store):
    site = FakeSite()

    result = upload(store, site, tag="t", run_id="r", log=lambda _: None)

    paths = [path for path, _ in site.posts]
    assert paths == [INGEST, INGEST, SWEEP]
    first, second = site.posts[0][1], site.posts[1][1]
    assert len(first["candidacies"]) == 4 and "extracts" not in first
    assert {e["outcome"] for e in second["extracts"]} == {"read", "crop", "failed"}
    picture = next(e for e in second["extracts"] if e["outcome"] == "crop")["images"]
    assert base64.b64decode(picture["date"]) == PNG
    assert result.candidacies == {"stored": 4}
    assert result.extracts == {"stored": 4}


def test_a_second_upload_sends_only_what_changed(store):
    upload(store, FakeSite(), tag="t", run_id="r1", log=lambda _: None)
    unchanged = FakeSite()
    upload(store, unchanged, tag="t", run_id="r2", log=lambda _: None)
    assert unchanged.posts == []

    store.people[2] = replace(ANNA, status="not_found", reason="not_listed")
    changed = FakeSite()
    upload(store, changed, tag="t", run_id="r3", log=lambda _: None)
    assert [c["key"] for c in changed.posts[0][1]["candidacies"]] == [ANNA.key]
    assert [path for path, _ in changed.posts] == [INGEST, SWEEP]


def test_a_skip_the_site_may_not_repeat_is_tried_again(store):
    upload(
        store,
        FakeSite(
            skip={SHA_COUNCIL: "unknown_candidacy", SHA_NOTHING: "no_site_person"}
        ),
        tag="t",
        run_id="r1",
        log=lambda _: None,
    )
    again = FakeSite()
    upload(store, again, tag="t", run_id="r2", log=lambda _: None)

    sent = {f"{e['sha256']}-p{e['page']}" for e in again.posts[0][1]["extracts"]}
    assert sent == {f"{SHA_COUNCIL}-p0", f"{SHA_COUNCIL}-p2"}
    assert store.sent("extract")[f"{SHA_NOTHING}-p0"].reason == "no_site_person"


def test_priority_keeps_its_candidacies_and_the_extracts_serving_them(store):
    store.people[2] = replace(ANNA, priority=1)  # a draft with a birth date

    candidacies, extracts = plan(store, priorities={1})

    assert [r["key"] for r, _ in candidacies] == [ANNA.key]
    assert [e.id for e in extracts] == [f"{SHA_COUNCIL}-p0"]


def test_priority_leaves_a_councils_file_a_councils(store):
    # The council's file names Anna and Ewa. With only Anna's candidacies kept
    # it still holds two people's declarations, so the stranger's page and
    # Ewa's go nowhere rather than to Anna.
    store.people[2] = replace(ANNA, priority=1)
    store.link_rows = [
        replace(link, named=True)
        if link.sha256 == SHA_COUNCIL and link.key in (ANNA.key, EWA.key)
        else link
        for link in store.link_rows
    ]

    _, extracts = plan(store, priorities={1})

    assert [e.id for e in extracts] == [f"{SHA_COUNCIL}-p0"]
    assert extracts[0].record["candidacies"] == [ANNA.key]


def test_a_sample_is_that_many_crops_and_the_candidacies_they_serve(store):
    candidacies, extracts = plan(store, sample=1)

    # By id, Jan's own file comes first; a failed extract is no crop.
    assert [e.id for e in extracts] == [f"{SHA_ONE}-p0"]
    assert [r["key"] for r, _ in candidacies] == [JAN_2024.key, JAN_2018.key]


def test_the_next_sample_takes_the_crops_not_sent_yet(store):
    upload(store, FakeSite(), tag="t", run_id="r1", sample=1, log=lambda _: None)

    candidacies, extracts = plan(store, sample=5)

    assert [e.id for e in extracts] == [f"{SHA_COUNCIL}-p0"]
    assert [r["key"] for r, _ in candidacies] == [ANNA.key]


def test_batches_keep_to_the_sites_limits():
    small = [Extract(str(i), {}, "", image_bytes=1000) for i in range(30)]
    assert [len(b) for b in batches(small)] == [MAX_EXTRACTS_PER_REQUEST, 5]
    big = [Extract(str(i), {}, "", image_bytes=3_000_000) for i in range(4)]
    assert [len(b) for b in batches(big)] == [2, 2]


class Tokens:
    who = "test"
    interactive = False

    def __init__(self):
        self.refreshed = 0

    def token(self) -> str:
        return f"token-{self.refreshed}"

    def refresh(self) -> str:
        self.refreshed += 1
        return self.token()


class Response:
    def __init__(self, status: int, body: Any = None):
        self.status_code = status
        self.ok = status < 400
        self._body = body
        self.text = str(body)

    def json(self) -> Any:
        return self._body


class Session:
    def __init__(self, *answers: Response | Exception):
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> Response:
        self.calls.append({"url": url, **kwargs})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_site_signs_in_again_once_on_a_401():
    tokens = Tokens()
    session = Session(Response(401), Response(200, {"status": "ok"}))
    site = Site("https://autopush.example/", tokens, session, sleep=lambda _: None)

    assert site.post(INGEST, {}) == {"status": "ok"}
    assert session.calls[0]["url"] == "https://autopush.example/api/ingest/declarations"
    assert [c["headers"]["Authorization"] for c in session.calls] == [
        "Bearer token-0",
        "Bearer token-1",
    ]


def test_site_waits_out_an_outage_and_gives_up_after_a_while():
    waits: list[float] = []
    site = Site(
        "https://autopush.example",
        Tokens(),
        Session(
            Response(503), requests.ConnectionError("down"), Response(200, {"ok": 1})
        ),
        sleep=waits.append,
    )
    assert site.post(INGEST, {}) == {"ok": 1}
    assert waits == [5, 15]

    down = Site(
        "https://a", Tokens(), Session(*[Response(502)] * 4), sleep=lambda _: None
    )
    with pytest.raises(SiteUnavailable):
        down.post(INGEST, {})


def test_site_stops_on_a_request_it_refuses():
    site = Site("https://a", Tokens(), Session(Response(400, "kids: too small")))
    with pytest.raises(SiteError, match="400 kids: too small"):
        site.post(INGEST, {})
