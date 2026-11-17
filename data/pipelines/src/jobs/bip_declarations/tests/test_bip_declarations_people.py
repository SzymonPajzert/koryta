"""The people snapshot: who is counted, the stage each person is in, and the
namesake estimate. No Postgres and no export: a memory store, and the site's
half built by hand."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from jobs.bip_declarations import people
from jobs.bip_declarations.people import (
    MIN_SETTLED,
    STAGES,
    Names,
    Page,
    Person,
    Publication,
    SiteCrop,
    SiteState,
    count_people,
    different_kind,
    namesake_estimate,
    newest_export,
    read_crawl,
    read_site,
    search_reason,
)
from scrapers.stores import (
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationLink,
    PersonRow,
    SentRow,
)
from stores.bip_declarations import MemoryBipDeclarationStore

AT = datetime(2026, 11, 17, 6, 15, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n made up"
NAMES = Names(
    surnames={"M": {"KOWALSKI": 30_000, "RZADKI": 10}, "K": {"NOWAK": 6_000}},
    first_names={"M": {"JAN": 100}, "K": {"ANNA": 100}},
)


def candidacy(
    key: str,
    page: str,
    *,
    status: str = "found",
    reason: str = "named",
    unit: str = "021704",
    unit_name: str = "Testowo (gmina wiejska)",
    first: str = "Jan",
    last: str = "Kowalski",
) -> PersonRow:
    return PersonRow(
        key=key,
        unit=unit,
        priority=0,
        election_year=2024,
        first_name=first,
        last_name=last,
        person={
            "koryta_ids": [page],
            "teryt": unit,
            "unit_level": "gmina",
            "unit_name": unit_name,
            "office": "Rada gminy",
            "pkw_age": 55,
        },
        status=status,
        reason=reason,
        docs=1,
    )


def link(key: str, sha: str, named: bool) -> DeclarationLink:
    return DeclarationLink(key, sha, f"https://bip.example/{sha[:4]}.pdf", named=named)


def crop(sha: str, page: int, name: str) -> DeclarationCropRow:
    return DeclarationCropRow(
        sha, page, sort="ocr", birth_date="", name=name, date_png=PNG, name_png=PNG
    )


CROPPED, SENT, NOT_CUT, NO_LABEL, COUNCIL = (c * 64 for c in "abcde")

CANDIDACIES = [
    candidacy("k-published", "published"),
    candidacy("k-queued", "queued"),
    candidacy("k-held", "held"),
    candidacy("k-namesake", "namesake"),
    candidacy("k-misread", "misread"),
    candidacy("k-reading", "reading"),
    # A page merged into "reading": the same person, counted once.
    candidacy("k-merged", "merged-away"),
    candidacy("k-cropped", "cropped"),
    candidacy("k-sent", "sent"),
    candidacy("k-not-cut", "not-cut"),
    candidacy("k-no-label", "no-label"),
    candidacy(
        "k-blocked",
        "blocked",
        status="not_found",
        reason="unreachable",
        unit="106101",
        unit_name="Łódź (gmina miejska)",
    ),
    # Only a council's file came down for him, and no page of it is his.
    candidacy("k-council", "council", status="unconfirmed", reason="unnamed"),
    # Her name is on a page of the council's file.
    candidacy("k-on-council", "on-council", first="Anna", last="Nowak"),
    candidacy("k-no-post", "no-post"),
    candidacy("k-public", "public"),
]


@pytest.fixture
def store() -> MemoryBipDeclarationStore:
    store = MemoryBipDeclarationStore(
        [*CANDIDACIES],
        links=[
            link("k-cropped", CROPPED, True),
            link("k-sent", SENT, True),
            link("k-not-cut", NOT_CUT, True),
            link("k-no-label", NO_LABEL, True),
            link("k-council", COUNCIL, False),
            link("k-on-council", COUNCIL, False),
        ],
    )
    store.record_cut(DeclarationCutRow(CROPPED, 1, "cut"), [crop(CROPPED, 0, "")])
    store.record_cut(DeclarationCutRow(SENT, 1, "cut"), [crop(SENT, 0, "")])
    store.record_cut(DeclarationCutRow(NO_LABEL, 1, "no_label"), [])
    store.record_cut(
        DeclarationCutRow(COUNCIL, 1, "cut"),
        [crop(COUNCIL, 0, "Anna Nowak"), crop(COUNCIL, 1, "Ktos Obcy")],
    )
    store.record_sent([SentRow("extract", f"{SENT}-p0", "d", "stored")], "run")
    return store


def agreed(id_: str, outcome: str, value: str = "1970-05-05") -> SiteCrop:
    return SiteCrop(id_, "agreed", outcome, value)


@pytest.fixture
def site() -> SiteState:
    pages = {
        page: Page(published=False, birth_date="1970-05-05")
        for page in (
            "queued",
            "held",
            "namesake",
            "misread",
            "reading",
            "cropped",
            "sent",
            "not-cut",
            "no-label",
            "blocked",
            "council",
            "on-council",
            "no-post",
        )
    }
    pages["published"] = Page(published=True, birth_date="1970-05-05")
    pages["public"] = Page(published=True, birth_date="1970-05-05")
    return SiteState(
        day="2026-11-17",
        pages=pages,
        public_posts=set(pages) - {"no-post"},
        publications={
            "published": Publication("published", published_on="2026-11-16"),
            "queued": Publication("queued"),
            "held": Publication("held", "two_places"),
        },
        crops={
            "published": [agreed("x1", "queued")],
            "queued": [agreed("x2", "queued")],
            "held": [agreed("x3", "held")],
            "namesake": [agreed("x4", "different", "1973-02-11")],
            "misread": [agreed("x5", "different", "1970-05-08")],
            "reading": [SiteCrop("x6", "open")],
        },
        merged_into={"merged-away": "reading"},
    )


def test_every_person_is_in_one_stage_and_the_stages_add_up(store, site):
    candidacies = store.candidacies()
    count = count_people(
        candidacies, read_crawl(store, candidacies, 1), site, NAMES, at=AT
    )

    stages = {p.page: (p.stage, p.detail) for p in count.people}
    assert stages == {
        "published": ("published", ""),
        "queued": ("held", "queued"),
        "held": ("held", "held:two_places"),
        "namesake": ("namesakes", ""),
        "misread": ("mismatched", ""),
        "reading": ("reading", ""),
        "cropped": ("cropped", ""),
        "on-council": ("cropped", ""),
        # On the site already, but no crop of the site's is his.
        "sent": ("searching", "other_page"),
        "not-cut": ("downloaded", ""),
        "no-label": ("searching", "no_date_line"),
        "blocked": ("searching", "unreachable"),
        "council": ("searching", "not_listed"),
    }
    assert count.left_out == {
        "no public post": 1,
        "public, not through a declaration": 1,
    }
    snapshot = count.snapshot
    assert sum(snapshot[stage] for stage in STAGES) == snapshot["people"] == 13


def test_the_snapshot_is_the_sites_shape(store, site):
    candidacies = store.candidacies()
    snapshot = count_people(
        candidacies, read_crawl(store, candidacies, 1), site, NAMES, at=AT
    ).snapshot

    assert set(snapshot) == {
        "at",
        "exportDay",
        "people",
        *STAGES,
        "searchingBy",
        "expectedNamesakes",
        "bySurname",
        "topUnits",
        "publishedByDay",
    }
    assert snapshot["at"] == "2026-11-17T06:15:00.000Z"
    assert snapshot["exportDay"] == "2026-11-17"
    assert snapshot["searchingBy"] == [
        {"reason": "unreachable", "count": 1},
        {"reason": "not_listed", "count": 1},
        {"reason": "no_date_line", "count": 1},
        {"reason": "other_page", "count": 1},
    ]
    assert snapshot["topUnits"] == [
        {
            "teryt": "106101",
            "name": "Łódź (gmina miejska)",
            "people": 1,
            "reason": "unreachable",
        }
    ]
    assert snapshot["publishedByDay"] == [{"day": "2026-11-16", "count": 1}]
    assert [row["max"] for row in snapshot["bySurname"]] == [
        50,
        1_000,
        5_000,
        20_000,
        None,
    ]
    # Five settled is too few to say anything about the rest.
    assert snapshot["expectedNamesakes"] is None


def test_a_crop_on_the_site_waiting_for_its_comparison_is_still_being_read(site):
    site.crops["queued"] = [SiteCrop("x2", "agreed", None, "1970-05-05")]
    rows = [candidacy("k-queued", "queued")]

    assert people.stage_of("queued", rows, {}, site, this_year=2026) == (
        "reading",
        "",
    )


@pytest.mark.parametrize(
    ("read", "page", "kind"),
    [
        ("1973-02-11", "1970-05-05", "namesake"),  # three years off
        ("1970-11-23", "1970-05-05", "namesake"),  # same year, far apart
        ("1970-05-08", "1970-05-05", "mismatched"),  # a slip of a digit
        ("1971-05-05", "1970-05-05", "mismatched"),  # the year misread
        ("1984-02-11", "1970-05-05", "mismatched"),  # ten years and more: a file
        ("2025-03-01", "1970-05-05", "mismatched"),  # the day it was signed
        ("1972", "1970-05-05", "namesake"),  # a year alone
        ("1972-01-01", "", "mismatched"),  # nothing to tell it by
    ],
)
def test_another_date_is_a_namesake_or_a_mistake(read, page, kind):
    assert different_kind(read, page, this_year=2026) == kind


def test_one_namesakes_date_makes_a_namesake_whatever_else_was_read(site):
    site.crops["namesake"] = [
        agreed("x4", "different", "1984-02-11"),
        agreed("x7", "different", "1973-02-11"),
    ]
    rows = [candidacy("k-namesake", "namesake")]

    assert people.stage_of("namesake", rows, {}, site, this_year=2026) == (
        "namesakes",
        "",
    )


def test_the_bip_not_answering_is_said_before_a_search_that_found_nothing():
    rows = [
        candidacy("b", "p", status="not_found", reason="not_listed"),
        candidacy("a", "p", status="unconfirmed", reason="unnamed"),
        candidacy("c", "p", status="not_found", reason="robots", unit="020100"),
    ]

    reason, row = search_reason(rows)

    assert (reason, row.unit) == ("robots", "020100")
    assert search_reason(rows[:2])[0] == "not_listed"
    assert search_reason([candidacy("d", "p", status="pending")])[0] == "pending"


def settled(n: int, bearers: int, namesakes: int = 0) -> list[Person]:
    return [
        Person(
            page=f"s{bearers}-{i}",
            stage="namesakes" if i < namesakes else "published",
            detail="",
            unit="021704",
            unit_name="",
            bearers=bearers,
        )
        for i in range(n)
    ]


def waiting(n: int, bearers: int) -> list[Person]:
    return [
        Person(f"w{bearers}-{i}", "searching", "pending", "021704", "", bearers)
        for i in range(n)
    ]


def test_namesakes_to_expect_follow_how_common_a_surname_is():
    crowd = [
        *settled(MIN_SETTLED, 10),
        *waiting(5, 10),
        *settled(MIN_SETTLED, 30_000, namesakes=MIN_SETTLED // 2),
        *waiting(4, 30_000),
    ]

    rows, expected = namesake_estimate(crowd)

    assert rows[0] == {
        "min": 0,
        "max": 50,
        "settled": MIN_SETTLED,
        "namesakes": 0,
        "remaining": 5,
    }
    assert rows[-1]["namesakes"] == MIN_SETTLED // 2
    # None among the rare surnames, half of the four with a common one.
    assert expected is not None and expected["count"] == 2
    assert expected["low"] <= 2 <= expected["high"]
    assert namesake_estimate(crowd) == (rows, expected)


def test_no_estimate_for_a_band_too_few_have_settled_in():
    crowd = [*settled(MIN_SETTLED - 1, 10), *waiting(1, 10)]

    assert namesake_estimate(crowd)[1] is None


EXPORT_DOCS: dict[str, list[dict[str, Any]]] = {
    "nodes": [
        {"_id": "jan", "type": "person", "published": False, "birthDate": "1970-05-05"},
        {"_id": "jan-old", "type": "person", "merged_into": "jan"},
        {"_id": "anna", "type": "person", "published": True},
        {"_id": "spolka", "type": "place", "isPublic": True},
        {
            "_id": "szpital",
            "type": "place",
            "isPublic": True,
            "supervisoryBody": "rada-spoleczna",
        },
    ],
    "edges": [
        {"source": "jan", "target": "spolka", "type": "employed", "name": "Prezes"},
        {
            "source": "anna",
            "target": "szpital",
            "type": "employed",
            "name": "Członek rady społecznej",
        },
    ],
    "declarationPublications": [
        {
            "_id": "jan",
            "personId": "jan",
            "status": "published",
            # 00:30 in Warsaw on the 17th.
            "publishedAt": datetime(2026, 11, 16, 23, 30, tzinfo=timezone.utc),
        }
    ],
    "declarationExtracts": [
        {
            "_id": "x1",
            "status": "agreed",
            "personIds": ["jan-old"],
            "pageOutcomes": {"jan-old": "queued"},
            "agreed": {"value": "1970-05-05", "kind": "date"},
        }
    ],
}


def test_the_sites_half_is_read_off_the_export(monkeypatch):
    monkeypatch.setattr(people, "read_kind", lambda root, kind: iter(EXPORT_DOCS[kind]))

    site = read_site(Path("/exports/date=2026-11-17T03:00:41.533Z"))

    assert site.day == "2026-11-17"
    assert set(site.pages) == {"jan", "anna"}
    assert site.pages["jan"] == Page(published=False, birth_date="1970-05-05")
    # A seat on a hospital's rada społeczna is not a paid post.
    assert site.public_posts == {"jan"}
    assert site.publications["jan"].published_on == "2026-11-17"
    assert site.crops == {"jan": [SiteCrop("x1", "agreed", "queued", "1970-05-05")]}


def test_the_newest_export_whole_is_taken(tmp_path):
    def export(name: str, kinds: tuple[str, ...]) -> None:
        for kind in kinds:
            folder = tmp_path / name / "all_namespaces" / f"kind_{kind}"
            folder.mkdir(parents=True)
            (folder / "output-0").write_bytes(b"")
            (folder / f"all_namespaces_kind_{kind}.export_metadata").write_bytes(b"")

    export("date=2026-11-16T03:00:52.388Z", people.KINDS)
    # Still coming down: no declarations yet.
    export("date=2026-11-17T03:00:41.533Z", ("nodes", "edges"))

    assert newest_export(tmp_path).name == "date=2026-11-16T03:00:52.388Z"
