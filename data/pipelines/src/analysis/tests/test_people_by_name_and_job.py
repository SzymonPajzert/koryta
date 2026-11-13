"""A page made before the register reached its person, often under a middle
name the payload leaves out: found by an agreeing name and a job it holds.

`SiteSnapshot._by_name_and_job` is `lookupByNameAndJob` transcribed, and the
cases mirror the suite "a page with a middle name that holds one of the
payload's jobs" in `frontend/tests/server/api/ingest/person.test.ts`.
"""

from dataclasses import asdict

import pandas as pd
import pytest

from analysis.payloads.person import matching_one_page, missing_from_koryta
from analysis.payloads.site import (
    BY_NAME,
    BY_NAME_AND_DATE,
    BY_NAME_AND_JOB,
    HELD_JOB,
    NOT_ON_SITE,
    PERSON_FIELDS,
    SiteSnapshot,
)
from entities.composite import Company, Person

ENTRY = "https://rejestr.io/osoby/1295123"
BORN = "1957-06-21"
PGE, BOGDANKA = "0000059307", "0000004549"


def page(node_id: str, name: str = "Krzysztof Jan Żuk", **fields) -> dict:
    """A page as the 2026-03-26 upload made his: published, with the middle
    name, and no register link or birth date."""
    return {"id": node_id, "type": "person", "name": name, "published": True, **fields}


def pge_seat(source: str, **fields) -> dict:
    """The PGE seat as a page shows it."""
    return {
        "id": f"{source}-pge",
        "type": "employed",
        "name": "Rada Nadzorcza",
        "source": source,
        "target": "pge",
        "start_date": "2010-03-03",
        "end_date": "2012-06-25",
        **fields,
    }


def snapshot(pages: list[dict], edges: list[dict]) -> SiteSnapshot:
    companies = [
        {"id": "pge", "type": "place", "name": "PGE", "krsNumber": PGE},
        {"id": "bogdanka", "type": "place", "name": "BOGDANKA", "krsNumber": BOGDANKA},
    ]
    return SiteSnapshot(
        pd.DataFrame.from_records([*pages, *companies]),
        pd.DataFrame.from_records(edges),
    )


def person(
    name: str = "Krzysztof Żuk",
    register: str | None = ENTRY,
    born: str | None = BORN,
    companies: list[Company] | None = None,
) -> Person:
    """The 2026-11-06 payload of Krzysztof Żuk's register entry, cut to two of
    its twelve jobs: the PGE seat his page shows, and one at Bogdanka."""
    if companies is None:
        companies = [
            Company(
                krs=PGE, role="Rada Nadzorcza", start="2010-03-03", end="2012-06-25"
            ),
            Company(
                krs=BOGDANKA,
                role="Rada Nadzorcza",
                start="2001-03-26",
                end="2002-06-14",
            ),
        ]
    return Person(
        name=name,
        companies=companies,
        elections=[],
        sources=[],
        rejestrIo=register,
        birthDate=born,
    )


def resolve(site: SiteSnapshot, one: Person) -> tuple[str | None, str]:
    found = site.resolve(asdict(one))
    return (found.page or {}).get("id"), found.how


def test_lands_on_the_published_page_that_already_shows_one_of_its_jobs():
    """The night made a draft „Krzysztof Żuk” beside this page on 2026-11-06:
    no page had the entry or the date, and none the exact name."""
    site = snapshot([page("zuk")], [pge_seat("zuk")])

    assert resolve(site, person()) == ("zuk", BY_NAME_AND_JOB)


def test_lands_there_for_a_payload_without_a_birth_date_too():
    site = snapshot([page("zuk")], [pge_seat("zuk")])

    assert resolve(site, person(born=None)) == ("zuk", BY_NAME_AND_JOB)


def test_takes_a_page_past_a_page_of_its_exact_name_that_links_another_entry():
    """Andrzej Olszewski's: the page of his exact name linked a namesake's
    entry, and „Andrzej Mieczysław Olszewski” showed both his seats."""
    site = snapshot(
        [
            page("namesake", "Krzysztof Żuk", rejestrIo="https://rejestr.io/osoby/777"),
            page("zuk"),
        ],
        [pge_seat("zuk")],
    )

    assert resolve(site, person()) == ("zuk", BY_NAME_AND_JOB)


def test_takes_the_page_of_its_exact_name_first_as_before():
    site = snapshot([page("exact", "Krzysztof Żuk"), page("zuk")], [pge_seat("zuk")])

    assert resolve(site, person()) == ("exact", BY_NAME)


def test_follows_a_merged_page_to_the_page_it_was_merged_into():
    site = snapshot(
        [page("zuk", merged_into="survivor"), page("survivor")],
        [pge_seat("survivor")],
    )

    assert resolve(site, person()) == ("survivor", BY_NAME_AND_JOB)


def test_holds_the_payload_back_where_two_such_pages_show_its_jobs():
    site = snapshot(
        [page("zuk"), page("other", "Krzysztof Józef Żuk")],
        [pge_seat("zuk"), pge_seat("other")],
    )

    assert resolve(site, person()) == (None, HELD_JOB)
    assert site.resolve(asdict(person())).held


@pytest.mark.parametrize(
    "seat",
    [
        pytest.param({"start_date": "2010-03-04"}, id="begun on another day"),
        pytest.param({"name": "Zarząd"}, id="another role"),
        pytest.param({"deleted": True}, id="removed by a reviewer"),
        pytest.param({"deleted": 1.0}, id="removed, as read back off disk"),
    ],
)
def test_a_job_that_is_not_one_of_its_own_leaves_the_payload_a_page_of_its_own(
    seat,
):
    site = snapshot([page("zuk")], [pge_seat("zuk", **seat)])

    assert resolve(site, person()) == (None, NOT_ON_SITE)


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"rejestrIo": "https://rejestr.io/osoby/777"}, id="linked"),
        pytest.param({"birthDate": "1960-01-01"}, id="born on another day"),
        pytest.param({"birthDate": "1957"}, id="a year of birth"),
        pytest.param({"deleted": True}, id="removed"),
    ],
)
def test_a_page_saying_it_is_somebody_else_is_never_taken(fields):
    site = snapshot([page("zuk", **fields)], [pge_seat("zuk")])

    assert resolve(site, person()) == (None, NOT_ON_SITE)


def test_a_page_storing_the_payloads_birth_date_is_found_by_it_as_before():
    site = snapshot([page("zuk", birthDate=BORN)], [pge_seat("zuk")])

    assert resolve(site, person()) == ("zuk", BY_NAME_AND_DATE)


def test_a_page_with_another_middle_name_is_somebody_else():
    site = snapshot([page("zuk")], [pge_seat("zuk")])

    assert resolve(site, person("Krzysztof Adam Żuk")) == (None, NOT_ON_SITE)


def test_misses_a_page_with_polish_letters_for_a_payload_written_without_them():
    """„Krzysztof Zuk” asks the ingest's name index for „zuk” alone, which
    „Krzysztof Jan Żuk” is not filed under, so the ingest never sees the page
    and makes the payload one of its own. Planned onto the page, the payload
    would go out as a stored person's, and the page the ingest made would
    stop the people run."""
    site = snapshot([page("zuk")], [pge_seat("zuk")])
    plain = person("Krzysztof Zuk")

    assert resolve(site, plain) == (None, NOT_ON_SITE)
    assert missing_from_koryta([plain], site) == [plain]


def test_finds_a_page_written_without_polish_letters_for_a_payload_with_them():
    """`namesakes` asks for the surname written plain as well."""
    site = snapshot([page("zuk", "Krzysztof Jan Zuk")], [pge_seat("zuk")])

    assert resolve(site, person()) == ("zuk", BY_NAME_AND_JOB)


def test_a_job_with_no_start_names_no_day_to_share():
    site = snapshot([page("zuk")], [pge_seat("zuk", start_date=None)])
    undated = [Company(krs=PGE, role="Rada Nadzorcza")]

    assert resolve(site, person(companies=undated)) == (None, NOT_ON_SITE)


def test_the_planner_counts_the_payload_on_the_site_not_new():
    """`--all` sends it as a stored person's: the page learns the entry, the
    date and the jobs it lacks. Counted new, it would have been planned as the
    draft the night made."""
    site = snapshot([page("zuk")], [pge_seat("zuk")])

    assert matching_one_page([person()], site) == [person()]
    assert missing_from_koryta([person()], site) == []
    assert PERSON_FIELDS in site.changes(asdict(person()))


def test_two_payloads_reaching_the_page_by_a_job_are_left_for_a_reviewer():
    """Two entries holding one seat: which of them the page is, the payloads
    cannot say - as for two reaching a page by a name and a birth date."""
    site = snapshot([page("zuk")], [pge_seat("zuk")])
    payloads = [person(), person(register="https://rejestr.io/osoby/42")]

    assert matching_one_page(payloads, site) == []
    assert missing_from_koryta(payloads, site) == []
