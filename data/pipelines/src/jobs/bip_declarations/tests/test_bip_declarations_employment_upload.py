"""What `upload --employment` sends to /api/ingest/declarations/employment, and
when: made-up declarations, people, bodies and towns; no site, no Postgres."""

from __future__ import annotations

import base64
import copy
import json
import os
import re
from collections import Counter
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import pytest

import jobs.bip_declarations as job
from jobs.bip_declarations.employment import EMPLOYMENT_CUT_VERSION
from jobs.bip_declarations.suggest import ROLES_FILE, BodyIndex
from jobs.bip_declarations.upload import (
    EMPLOYMENT,
    EMPLOYMENT_INGEST,
    MAX_IMAGE_BYTES,
    MAX_LINE_Y,
    MAX_LINES,
    MAX_STRIP_PAGE,
    MAX_STRIPS,
    SWEEP,
    DatePage,
    ListTooOld,
    _with_pictures,
    date_pages,
    employment_plan,
    upload_employment,
)
from scrapers.map.offices import GMINA_OFFICE, POWIAT_OFFICE
from scrapers.stores import (
    DeclarationBandRow,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    DeclarationLink,
    DeclarationStrip,
    PersonRow,
)
from stores.bip_declarations import MemoryBipDeclarationStore

FRONTEND = ROLES_FILE.parents[1]
#: The body this upload sends, as frontend/tests/shared/declarationEmployment.test.ts
#: parses it with the site's schema: a change here is a change there.
SENT = Path(__file__).with_name("employment_upload.json")
#: Set to write SENT from what the upload sends now, instead of comparing.
WRITE_SENT = "KORYTA_WRITE_EMPLOYMENT_UPLOAD"

SHA_NEW = "a" * 64  # Anna's start-of-term declaration, printed
SHA_OLD = "b" * 64  # Anna's annual one before it, handwritten
SHA_JAN = "c" * 64  # Jan's: his page holds a paid public post
SHA_EWA = "d" * 64  # Ewa's: readers have not agreed on its birth date yet
SHA_COUNCIL = "e" * 64  # a council's file: three date pages that are not read
NEW, OLD = f"{SHA_NEW}-p0", f"{SHA_OLD}-p0"
RUN = "20261120T120000Z"
RUN_DAY = date(2026, 11, 20)


def regon(n: int) -> str:
    """Nine digits with their check digit."""
    stem = f"{n:08d}"
    remainder = sum(int(d) * w for d, w in zip(stem, (8, 9, 2, 3, 4, 5, 6, 7))) % 11
    return stem + str(0 if remainder == 10 else remainder)


# Powiat 0101 and its gmina Przykładowo (0101023) do not exist.
URZAD, STAROSTWO = regon(10_000_001), regon(10_000_002)
BODIES = BodyIndex(
    [
        {
            "regon": URZAD,
            "name": "Urząd Miejski w Przykładowie",
            "kind": GMINA_OFFICE,
            "teryt": "0101023",
            "seat": "0101023",
            "ownership": "113",
        },
        {
            "regon": STAROSTWO,
            "name": "Starostwo Powiatowe w Przykładowie",
            "kind": POWIAT_OFFICE,
            "teryt": "0101",
            "seat": "0101023",
            "ownership": "113",
        },
    ]
)
NACZELNIK = "Urząd Miejski w Przykładowie - Naczelnik Wydziału Testów"


def candidacy(
    key: str, first: str, last: str, page: str, post: bool | None, year: int = 2024
) -> PersonRow:
    return PersonRow(
        key=key,
        unit="010102",
        priority=1,
        election_year=year,
        first_name=first,
        last_name=last,
        person={
            "koryta_ids": [page],
            "teryt": "010102",
            "unit_level": "gmina",
            "office": "Rada gminy",
            "public_post": post,
        },
        status="found",
        reason="named",
        docs=1,
    )


ANNA = candidacy("1" * 16, "Anna", "Testowa", "anna", False)
ANNA_2018 = candidacy("2" * 16, "Anna", "Testowa", "anna", False, year=2018)
JAN = candidacy("3" * 16, "Jan", "Testowy", "jan", True)
EWA = candidacy("4" * 16, "Ewa", "Probna", "ewa", False)

# The site's export: whose birth date readers agreed on, and whose page it is.
PAGES = {
    page.id: page
    for page in (
        DatePage(NEW, True, ("anna",)),
        DatePage(OLD, True, ("anna",)),
        DatePage(f"{SHA_JAN}-p0", True, ("jan",)),
        DatePage(f"{SHA_EWA}-p0", False, ()),
        # Two pages born that day: held, neither the declarant's for sure.
        DatePage(f"{SHA_COUNCIL}-p0", True, ()),
        # A page merged away since the night's list.
        DatePage(f"{SHA_COUNCIL}-p6", True, ("gone",)),
    )
}


def picture(label: str, height: int = 180) -> bytes:
    """A PNG's signature and size, which is all the site reads of one, and a
    label of its own after them."""
    size = (1654).to_bytes(4, "big") + height.to_bytes(4, "big")
    return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + size + label.encode("ascii")


def band(
    sha: str,
    page: int,
    name: str,
    *,
    text: str = "",
    typed: bool = True,
    pages: int = 1,
    status: str = "cut",
    label: str = "",
    **fields: Any,
) -> DeclarationBandRow:
    """A band as cut-employment keeps it: a strip a page it runs across."""
    strips = tuple(
        DeclarationStrip(
            page + k,
            100 if k == 0 else 0,
            280,
            picture(f"{sha[0]}{page}{name}{k}{label}"),
        )
        for k in range(pages if status == "cut" else 0)
    )
    return DeclarationBandRow(
        sha,
        page,
        name,
        EMPLOYMENT_CUT_VERSION,
        status,
        dpi=200 if typed else 300,
        width=1654 if typed else 2480,
        strips=strips,
        lines=tuple((k, 12, 64) for k in range(len(strips))),
        ocr_text=text,
        score=0.97 if typed else 0.41,
        typed=typed,
        source="ocr",
        **fields,
    )


def bands(
    sha: str, page: int, employer: str, *, typed: bool = True, **header: Any
) -> list[DeclarationBandRow]:
    return [
        band(
            sha,
            page,
            "header",
            text="OŚWIADCZENIE MAJĄTKOWE radnego",
            typed=typed,
            **header,
        ),
        band(
            sha, page, "employer", text=employer, typed=typed, pages=1 if typed else 2
        ),
        band(sha, page, "vii", text="nie dotyczy", typed=typed),
        band(sha, page, "viii", text="dieta radnego 12 000 zł", typed=typed),
    ]


def link(key: str, sha: str, named: bool = True) -> DeclarationLink:
    return DeclarationLink(
        key, sha, f"https://bip.przykladowo.example/{sha[:4]}.pdf", named=named
    )


@pytest.fixture
def store() -> MemoryBipDeclarationStore:
    shas = (SHA_NEW, SHA_OLD, SHA_JAN, SHA_EWA, SHA_COUNCIL)
    files = [
        DeclarationFile(sha, "bip.przykladowo.example", "", "b.tar.gz", "o.pdf")
        for sha in shas
    ]
    links = [
        link(ANNA.key, SHA_NEW),
        link(ANNA.key, SHA_OLD),
        link(ANNA_2018.key, SHA_OLD),
        link(JAN.key, SHA_JAN),
        link(EWA.key, SHA_EWA),
        link(ANNA.key, SHA_COUNCIL, named=False),
        link(EWA.key, SHA_COUNCIL, named=False),
    ]
    store = MemoryBipDeclarationStore([ANNA, ANNA_2018, JAN, EWA], files, links)
    years = {SHA_NEW: 2024, SHA_OLD: 2023}
    council = (0, 3, 6)
    for sha in shas:
        pages = council if sha == SHA_COUNCIL else (0,)
        store.record_cut(
            DeclarationCutRow(sha, job.CUT_VERSION, "cut"),
            [
                DeclarationCropRow(sha, p, declaration_year=years.get(sha))
                for p in pages
            ],
        )
    dates: dict[str, Any] = {
        "stan_na": "2024-05-07",
        "stan_na_score": 0.97,
        "dnia": "2024-05-20",
        "dnia_score": 0.91,
    }
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, bands(SHA_NEW, 0, NACZELNIK, **dates)
    )
    # Handwriting the job read nothing of but what OCR guessed.
    store.record_bands(
        SHA_OLD, 0, EMPLOYMENT_CUT_VERSION, bands(SHA_OLD, 0, NACZELNIK, typed=False)
    )
    for sha in (SHA_JAN, SHA_EWA):
        store.record_bands(sha, 0, EMPLOYMENT_CUT_VERSION, bands(sha, 0, NACZELNIK))
    for page in council:
        store.record_bands(
            SHA_COUNCIL, page, EMPLOYMENT_CUT_VERSION, bands(SHA_COUNCIL, page, "")
        )
    return store


class FakeSite:
    """Takes every request, skipping what `skip` names, and keeps them all."""

    def __init__(self, skip: dict[str, str] | None = None) -> None:
        self.posts: list[tuple[str, dict[str, Any]]] = []
        self.skip = skip or {}

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        self.posts.append((path, copy.deepcopy(body)))
        items = body.get("items", [])
        return {
            "status": "ok",
            "bands": {"created": len(items), "updated": 0, "kept": 0, "unchanged": 0},
            "skipped": [
                {"id": item["id"], "reason": self.skip[item["id"]]}
                for item in items
                if item["id"] in self.skip
            ],
        }


def send(store: MemoryBipDeclarationStore, site: FakeSite, run: str = RUN, **kw: Any):
    return upload_employment(
        store,
        site,  # type: ignore[arg-type]
        PAGES,
        BODIES,
        tag=job.EMPLOYMENT_TAG,
        run_id=run,
        log=lambda _: None,
        **kw,
    )


def items_of(site: FakeSite) -> dict[str, dict[str, Any]]:
    return {i["id"]: i for _, body in site.posts for i in body.get("items", [])}


# -- what goes, and what waits ------------------------------------------------------


def test_the_newest_declaration_of_a_page_goes_open_and_an_older_one_later(store):
    plan = employment_plan(store, PAGES, BODIES)

    assert [(i.id, i.person, i.status) for i in plan.items] == [
        (NEW, "anna", "open"),
        (OLD, "anna", "later"),
    ]
    assert plan.statuses() == {"open": 1, "later": 1}
    assert plan.unchanged == 0


def test_every_other_date_page_waits_and_says_why(store):
    plan = employment_plan(store, PAGES, BODIES)

    assert plan.left_out == {
        # Jan's page holds a paid public post: the site would not hold it.
        "public_post": 1,
        "date_not_agreed": 1,
        "not_one_page": 1,
        # The council's page 3 never reached the site.
        "no_date_page": 1,
        "page_not_listed": 1,
    }


def test_the_newest_is_the_latest_stan_na_else_the_day_signed_else_the_year(store):
    # Anna's other declaration names the day it was signed, a year after.
    store.record_bands(
        SHA_OLD,
        0,
        EMPLOYMENT_CUT_VERSION,
        bands(SHA_OLD, 0, NACZELNIK, typed=False, dnia="2025-04-28", dnia_score=0.93),
    )

    statuses = {
        i.id: i.status
        for i in employment_plan(store, PAGES, BODIES, today=RUN_DAY).items
    }

    assert statuses == {NEW: "later", OLD: "open"}


@pytest.mark.parametrize(
    "dnia, score",
    [
        # Signed in 2024 and read as 2029, surely: no declaration is signed
        # after the run.
        ("2029-05-31", 0.95),
        # A day after Anna's other one, read off its line at 0.55.
        ("2025-04-28", 0.55),
    ],
)
def test_a_day_misread_or_read_unsurely_does_not_make_a_declaration_newest(
    store, dnia, score
):
    store.record_bands(
        SHA_OLD,
        0,
        EMPLOYMENT_CUT_VERSION,
        bands(SHA_OLD, 0, NACZELNIK, typed=False, dnia=dnia, dnia_score=score),
    )

    statuses = {
        i.id: i.status
        for i in employment_plan(store, PAGES, BODIES, today=RUN_DAY).items
    }

    # Its date crop's year, 2023, goes as its 31 December.
    assert statuses == {NEW: "open", OLD: "later"}


def test_a_newer_declaration_s_unsure_dates_fall_back_to_its_year(store):
    # Anna's 2024 declaration with both dates misread as 2023 days, unsurely.
    unsure = {"stan_na_score": 0.62, "dnia_score": 0.58}
    store.record_bands(
        SHA_NEW,
        0,
        EMPLOYMENT_CUT_VERSION,
        bands(SHA_NEW, 0, NACZELNIK, stan_na="2023-01-07", dnia="2023-02-20", **unsure),
    )

    statuses = {
        i.id: i.status
        for i in employment_plan(store, PAGES, BODIES, today=RUN_DAY).items
    }

    # 31 December 2024 against the 2023 one's 31 December 2023.
    assert statuses == {NEW: "open", OLD: "later"}


def test_a_year_to_come_on_a_date_crop_is_no_year(store):
    # Anna's handwritten declaration's crop read 2029 for its year, and its
    # header no date at all.
    store.record_cut(
        DeclarationCutRow(SHA_OLD, job.CUT_VERSION, "cut"),
        [DeclarationCropRow(SHA_OLD, 0, declaration_year=2029)],
    )

    statuses = {
        i.id: i.status
        for i in employment_plan(store, PAGES, BODIES, today=RUN_DAY).items
    }

    assert statuses == {NEW: "open", OLD: "later"}


def test_a_page_with_no_readable_band_lets_the_next_newest_open(store):
    store.record_bands(
        SHA_NEW,
        0,
        EMPLOYMENT_CUT_VERSION,
        [
            band(SHA_NEW, 0, "header", stan_na="2024-05-07"),
            band(SHA_NEW, 0, "employer", status="no_caption"),
        ],
    )

    plan = employment_plan(store, PAGES, BODIES)

    assert [(i.id, i.status) for i in plan.items] == [(OLD, "open")]
    assert plan.left_out["employer_no_caption"] == 1


def test_the_record_is_the_header_and_the_employer_line(store):
    [new, old] = employment_plan(store, PAGES, BODIES).items

    assert set(new.record) == {"id", "cutVersion", "later", "header", "employer"}
    assert (new.record["id"], new.record["cutVersion"], new.record["later"]) == (
        NEW,
        EMPLOYMENT_CUT_VERSION,
        False,
    )
    assert new.record["header"] == {
        "typed": True,
        "strips": [{"page": 0}],
        "lines": [{"strip": 0, "top": 12, "bottom": 64}],
        "asOf": {"value": "2024-05-07", "score": 0.97},
        "filedOn": {"value": "2024-05-20", "score": 0.91},
    }
    # Handwriting across a page break, its dates not read.
    assert old.record["employer"]["strips"] == [{"page": 0}, {"page": 1}]
    assert old.record["header"]["asOf"] is None
    assert old.record["header"]["filedOn"] is None
    assert len(new.record["employer"]["imageHash"]) == 64
    assert new.record["employer"]["imageHash"] != old.record["employer"]["imageHash"]


def test_suggestions_go_only_with_a_printed_line(store):
    [new, old] = employment_plan(store, PAGES, BODIES).items

    assert new.record["employer"]["typed"] is True
    assert new.record["employer"]["suggestions"] == [
        {"employer": {"regon": URZAD}, "role": "naczelnik"}
    ]
    # The same words in handwriting are OCR's guess: nothing is suggested.
    assert old.record["employer"]["typed"] is False
    assert old.record["employer"]["suggestions"] == []


def test_the_header_s_picture_is_part_of_what_a_band_shows(store):
    [before, _] = employment_plan(store, PAGES, BODIES).items
    header = band(SHA_NEW, 0, "header", label="again", stan_na="2024-05-07")
    rows = bands(SHA_NEW, 0, NACZELNIK)
    store.record_bands(SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [header, *rows[1:]])

    [after, _] = employment_plan(store, PAGES, BODIES).items

    assert (
        after.record["employer"]["imageHash"] != before.record["employer"]["imageHash"]
    )


def test_a_band_the_site_would_refuse_whole_stays_here(store):
    many = band(SHA_NEW, 0, "employer", pages=MAX_STRIPS + 1)
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [bands(SHA_NEW, 0, "")[0], many]
    )
    lines = replace(
        band(SHA_OLD, 0, "employer"),
        lines=tuple((0, 2 * k, 2 * k + 1) for k in range(MAX_LINES + 1)),
    )
    store.record_bands(
        SHA_OLD, 0, EMPLOYMENT_CUT_VERSION, [bands(SHA_OLD, 0, "")[0], lines]
    )

    plan = employment_plan(store, PAGES, BODIES)

    assert plan.items == []
    assert (plan.left_out["too_many_strips"], plan.left_out["too_many_lines"]) == (1, 1)


def test_a_line_the_site_would_refuse_is_left_off_the_band(store):
    odd = replace(
        band(SHA_NEW, 0, "employer", text=NACZELNIK),
        lines=((0, 12, 64), (0, 70, 70), (1, 0, 40), (0, 10, MAX_LINE_Y + 1)),
    )
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [bands(SHA_NEW, 0, "")[0], odd]
    )

    [new, _] = employment_plan(store, PAGES, BODIES).items

    assert new.record["employer"]["lines"] == [{"strip": 0, "top": 12, "bottom": 64}]


@pytest.mark.parametrize("day", ["2024-02-30", "1890-12-31", "20240507", "2024"])
def test_a_date_the_site_would_not_take_as_a_day_goes_as_none(store, day):
    header = band(SHA_NEW, 0, "header", stan_na=day, stan_na_score=1.4, dnia=day)
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [header, *bands(SHA_NEW, 0, NACZELNIK)[1:]]
    )

    [new, _] = employment_plan(store, PAGES, BODIES).items

    assert (new.record["header"]["asOf"], new.record["header"]["filedOn"]) == (
        None,
        None,
    )


def test_a_score_past_one_goes_as_one(store):
    header = band(SHA_NEW, 0, "header", stan_na="2024-05-07", stan_na_score=1.0000001)
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [header, *bands(SHA_NEW, 0, NACZELNIK)[1:]]
    )

    [new, _] = employment_plan(store, PAGES, BODIES).items

    assert new.record["header"]["asOf"] == {"value": "2024-05-07", "score": 1.0}


def test_a_list_that_does_not_say_who_holds_a_post_is_refused(store):
    store.people = [
        replace(p, person={**p.person, "public_post": None}) for p in store.people
    ]

    with pytest.raises(ListTooOld):
        employment_plan(store, PAGES, BODIES)


def test_a_page_has_no_post_when_any_candidacy_of_it_has_none(store):
    # A candidacy linked to two pages has a post through one of them: Anna's
    # own candidacy without one still says hers has none.
    twins = candidacy("5" * 16, "Anna", "Testowa", "anna", True)
    store.people.append(
        replace(twins, person={**twins.person, "koryta_ids": ["anna", "jan"]})
    )

    assert len(employment_plan(store, PAGES, BODIES).items) == 2


def test_the_export_s_documents_read_as_date_pages():
    docs = [
        {
            "id": NEW,
            "status": "agreed",
            "agreed": {"value": "1979-07-15", "kind": "date", "readers": 2},
            "pageOutcomes": {"anna": "queued", "ewa": "different", "ola": "no_date"},
        },
        # A year alone compares with no page.
        {"id": OLD, "status": "agreed", "agreed": {"value": "1979", "kind": "year"}},
        # Fields a document never had come out of the export as NaN.
        {"id": f"{SHA_EWA}-p0", "status": "open", "agreed": float("nan")},
        {
            "id": f"{SHA_JAN}-p0",
            "status": "agreed",
            "agreed": {"value": "1960-01-02", "kind": "date"},
            "pageOutcomes": {"jan": "confirmed", "jan-twin": "held"},
        },
    ]

    assert date_pages(docs) == {
        NEW: DatePage(NEW, True, ("anna",)),
        OLD: DatePage(OLD, False, ()),
        f"{SHA_EWA}-p0": DatePage(f"{SHA_EWA}-p0", False, ()),
        f"{SHA_JAN}-p0": DatePage(f"{SHA_JAN}-p0", True, ("jan",)),
    }


# -- sending ---------------------------------------------------------------------------


def test_the_upload_sends_the_pictures_and_keeps_the_site_s_answer(store):
    site = FakeSite(skip={OLD: "too_large"})

    result = send(store, site)

    [(path, body)] = site.posts
    assert path == EMPLOYMENT_INGEST
    assert (body["tag"], body["runId"]) == ("bip-declarations-employment-1", RUN)
    sent = items_of(site)
    pictures = store.band_pictures(EMPLOYMENT_CUT_VERSION, [(SHA_OLD, 0)])
    assert [
        base64.b64decode(s["png"]) for s in sent[OLD]["employer"]["strips"]
    ] == list(pictures[(SHA_OLD, 0, "employer")])
    assert result.items == {"stored": 1, "too_large": 1}
    assert result.bands == {"created": 2, "updated": 0, "kept": 0, "unchanged": 0}
    assert result.requests == 1
    kept = store.sent(EMPLOYMENT)
    assert (kept[NEW].result, kept[OLD].result, kept[OLD].reason) == (
        "stored",
        "skipped",
        "too_large",
    )
    # Nothing is swept: the site placed each band as it stored it.
    assert SWEEP not in [p for p, _ in site.posts]


def test_a_second_upload_sends_nothing_new(store):
    send(store, FakeSite())
    again = FakeSite()

    result = send(store, again, run="r2")

    assert again.posts == []
    assert result.requests == 0
    assert employment_plan(store, PAGES, BODIES).unchanged == 2


def test_a_band_cut_again_is_sent_again(store):
    first = FakeSite()
    send(store, first)
    rows = bands(SHA_NEW, 0, NACZELNIK, stan_na="2024-05-07", dnia="2024-05-20")
    recut = replace(
        band(SHA_NEW, 0, "employer", text=NACZELNIK, label="wider"), widen=1
    )
    store.record_bands(SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [rows[0], recut, *rows[2:]])

    again = FakeSite()
    send(store, again, run="r2")

    sent = items_of(again)
    assert list(sent) == [NEW]
    before = items_of(first)[NEW]["employer"]["imageHash"]
    assert sent[NEW]["employer"]["imageHash"] != before


def test_a_newer_declaration_puts_the_one_before_it_off(store):
    send(store, FakeSite())
    newer = "f" * 64
    store.files[newer] = DeclarationFile(newer, "h", "", "b.tar.gz", "n.pdf")
    store.link_rows.append(link(ANNA.key, newer))
    store.record_cut(
        DeclarationCutRow(newer, job.CUT_VERSION, "cut"), [DeclarationCropRow(newer, 2)]
    )
    store.record_bands(
        newer,
        2,
        EMPLOYMENT_CUT_VERSION,
        bands(newer, 2, NACZELNIK, stan_na="2025-12-31", stan_na_score=0.96),
    )
    pages = {**PAGES, f"{newer}-p2": DatePage(f"{newer}-p2", True, ("anna",))}

    plan = employment_plan(store, pages, BODIES, today=RUN_DAY)

    # The older one did not change and is not sent again.
    assert [(i.id, i.status) for i in plan.items] == [
        (NEW, "later"),
        (f"{newer}-p2", "open"),
    ]
    assert plan.unchanged == 1


def test_a_band_cut_again_while_sending_waits_for_the_next_run(store):
    [new, old] = employment_plan(store, PAGES, BODIES).items
    rows = bands(SHA_NEW, 0, NACZELNIK)
    store.record_bands(
        SHA_NEW,
        0,
        EMPLOYMENT_CUT_VERSION,
        [rows[0], band(SHA_NEW, 0, "employer", label="x")],
    )
    held: Counter[str] = Counter()

    ready = _with_pictures(store, [new, old], held)

    assert [item.id for item in ready] == [OLD]
    assert held == {"cut_again": 1}
    assert ready[0].image_bytes == sum(
        len(base64.b64decode(s["png"]))
        for part in ("header", "employer")
        for s in ready[0].record[part]["strips"]
    )


def test_a_picture_the_site_would_refuse_waits(store):
    big = replace(
        band(SHA_NEW, 0, "employer"),
        strips=(
            DeclarationStrip(0, 100, 280, picture("big") + b"\0" * MAX_IMAGE_BYTES),
        ),
    )
    store.record_bands(
        SHA_NEW, 0, EMPLOYMENT_CUT_VERSION, [bands(SHA_NEW, 0, "")[0], big]
    )
    site = FakeSite()

    result = send(store, site)

    assert list(items_of(site)) == [OLD]
    assert result.held == {"picture_too_big": 1}
    assert NEW not in store.sent(EMPLOYMENT)


def test_max_requests_stops_the_upload(store):
    site = FakeSite()

    result = send(store, site, max_requests=0)

    assert (result.requests, site.posts) == (0, [])


def test_what_is_sent_is_what_the_site_s_test_reads(store):
    """The site's schema is checked against SENT by the site's own test, so
    what this upload sends and what the site takes cannot drift apart."""
    site = FakeSite()
    send(store, site)
    [(_, body)] = site.posts

    if os.environ.get(WRITE_SENT):
        SENT.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")
    assert json.loads(SENT.read_text(encoding="utf-8")) == body, (
        f"the upload sends another body than {SENT.name}: check that the site "
        f"takes it, then write it again with {WRITE_SENT}=1"
    )


# -- the site's limits -----------------------------------------------------------------


def test_the_limits_are_the_site_s():
    shared = (FRONTEND / "shared" / "declarationEmployment.ts").read_text("utf-8")
    dates = (FRONTEND / "shared" / "declarations.ts").read_text("utf-8")

    assert f"export const MAX_STRIPS = {MAX_STRIPS};" in shared
    assert f"export const MAX_LINES = {MAX_LINES};" in shared
    assert re.search(
        rf"page: z\.number\(\)\.int\(\)\.min\(0\)\.max\({MAX_STRIP_PAGE}\)", shared
    )
    assert len(re.findall(rf"\.max\({MAX_LINE_Y:_}\)", shared)) == 2
    assert f"export const MAX_IMAGE_BYTES = {MAX_IMAGE_BYTES:_};" in dates
    route = FRONTEND / "server" / f"{EMPLOYMENT_INGEST.removeprefix('/')}.post.ts"
    assert route.is_file()


# -- the command -----------------------------------------------------------------------


@pytest.fixture
def command(store, monkeypatch) -> MemoryBipDeclarationStore:
    monkeypatch.setattr(job, "employment_inputs", lambda: (store, PAGES, BODIES))
    monkeypatch.setattr(job, "token_source", lambda endpoint: object())
    return store


def test_a_dry_run_counts_what_would_go_and_sends_nothing(command, capsys):
    assert job.main(["upload", "--employment", "--dry-run"]) == 0

    said = capsys.readouterr().out
    assert "would send 2 declarations ({'open': 1, 'later': 1})" in said
    assert "'public_post': 1" in said and "sent nothing" in said
    assert command.sent(EMPLOYMENT) == {}


def test_the_command_sends_once_and_sweeps_nothing(command, monkeypatch, capsys):
    sites: list[FakeSite] = []

    def site(endpoint: str, tokens: object) -> FakeSite:
        sites.append(FakeSite())
        return sites[-1]

    monkeypatch.setattr(job, "Site", site)

    assert job.main(["upload", "--employment"]) == 0
    assert job.main(["upload", "--employment"]) == 0

    assert [[p for p, _ in s.posts] for s in sites] == [[EMPLOYMENT_INGEST], []]
    assert set(command.sent(EMPLOYMENT)) == {NEW, OLD}
    assert "declarations {'stored': 2}" in capsys.readouterr().out


def test_the_command_takes_no_date_crop_filter(command, capsys):
    assert job.main(["upload", "--employment", "--public-post"]) == 1
    assert "no --priority, --sample or --public-post" in capsys.readouterr().err
