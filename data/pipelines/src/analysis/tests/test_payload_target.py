"""What a button on one page sends: a company's people, or one person."""

import pandas as pd

from analysis.payloads.person import row_is_about
from analysis.payloads.priority import ON_SITE
from analysis.payloads.site import SiteSnapshot
from analysis.payloads.target import (
    NEW,
    PageTarget,
    employment_krs,
    for_company,
    for_person,
    works_at,
)
from entities.composite import Company, Person

KRS = "0000000001"
SUBSIDIARY = "0000000002"


def page(node_id: str, name: str, register: str | None = None) -> dict:
    node = {"id": node_id, "type": "person", "name": name}
    if register:
        node["rejestrIo"] = register
    return node


def snapshot(*people: dict, edges: tuple = ()) -> SiteSnapshot:
    nodes = [
        *people,
        {"id": "place-1", "type": "place", "name": "Wodociągi", "krsNumber": KRS},
        {"id": "place-2", "type": "place", "name": "Spółka", "krsNumber": SUBSIDIARY},
    ]
    return SiteSnapshot(
        pd.DataFrame.from_records(nodes),
        pd.DataFrame.from_records(list(edges)) if edges else pd.DataFrame(),
    )


def employed(person_id: str, place: str, start: str) -> dict:
    return {
        "id": f"edge-{person_id}-{place}",
        "type": "employed",
        "source": person_id,
        "target": place,
        "name": "Prezes",
        "start_date": start,
    }


def person(name: str, number: str | None, *companies: Company, **extra) -> Person:
    return Person(
        name=name,
        companies=list(companies),
        elections=[],
        sources=[],
        rejestrIo=f"https://rejestr.io/osoby/{number}" if number else None,
        **extra,
    )


AT_KRS = Company(krs=KRS, role="Prezes", start="2024-01-01")


# ---------------------------------------------------------------------------
# A company


def test_a_companys_run_creates_the_missing_and_changes_the_stale():
    site = snapshot(
        page("p-known", "Anna Nowak", "https://rejestr.io/osoby/1"),
        page("p-done", "Ewa Lis", "https://rejestr.io/osoby/2"),
        edges=(employed("p-done", "place-1", "2024-01-01"),),
    )
    payloads = [
        person("Anna Nowak", "1", AT_KRS),  # on the site, missing the post
        person("Ewa Lis", "2", AT_KRS),  # on the site with it already
        person("Jan Nowy", "3", AT_KRS),  # not on the site
        person("Obcy", "4", Company(krs=SUBSIDIARY, start="2024-01-01")),
    ]

    result = for_company(payloads, site, KRS)

    assert [p.name for p in result.changed] == ["Anna Nowak"]
    assert [p.name for p in result.new] == ["Jan Nowy"]
    assert (result.matched, result.up_to_date, result.left_out) == (3, 1, 0)
    assert result.plan() == [(result.changed[0], ON_SITE), (result.new[0], NEW)]


def test_a_company_is_its_own_posts_not_its_subsidiaries():
    owner = person("Jan Nowy", "3", Company(krs=SUBSIDIARY, start="2024-01-01"))

    assert not works_at(owner, KRS)
    assert for_company([owner], snapshot(), KRS).matched == 0


def test_namesakes_the_payloads_cannot_tell_apart_are_left_out():
    # Two payloads named alike, one without a register link: uploaded one
    # after the other, the second would land on the page the first made.
    payloads = [
        person("Jan Kowalski", "5", AT_KRS),
        person("Jan Kowalski", None, AT_KRS),
    ]

    result = for_company(payloads, snapshot(), KRS)

    assert result.new == []
    assert (result.matched, result.left_out) == (2, 2)


# ---------------------------------------------------------------------------
# A person


TARGET = PageTarget(kind="person", node_id="p-1", name="Anna Nowak", register="1")


def test_a_persons_run_sends_the_one_payload_about_the_page():
    site = snapshot(page("p-1", "Anna Nowak", "https://rejestr.io/osoby/1"))

    result = for_person([person("Anna Nowak", "1", AT_KRS)], site, TARGET)

    [sent] = result.changed
    # Sent at the page itself, so the ingest looks nobody up by name.
    assert sent.korytaId == "p-1"
    assert result.new == [] and result.reason == ""


def test_a_person_whose_page_has_it_all_already_sends_nothing():
    site = snapshot(
        page("p-1", "Anna Nowak", "https://rejestr.io/osoby/1"),
        edges=(employed("p-1", "place-1", "2024-01-01"),),
    )

    result = for_person([person("Anna Nowak", "1", AT_KRS)], site, TARGET)

    assert (result.changed, result.up_to_date) == ([], 1)


def test_a_page_without_a_register_link_is_matched_by_a_unique_name():
    site = snapshot(page("p-1", "Anna Nowak"))
    target = PageTarget(kind="person", node_id="p-1", name="Anna Nowak")

    result = for_person([person("Anna Nowak", "1", AT_KRS)], site, target)

    assert [p.korytaId for p in result.changed] == ["p-1"]


def test_two_payloads_landing_on_one_page_send_nothing():
    # A page without a register link, which people_merged gave to two entries.
    site = snapshot(page("p-1", "Anna Nowak"))
    target = PageTarget(kind="person", node_id="p-1", name="Anna Nowak")
    payloads = [
        person("Anna Nowak", "5", AT_KRS, korytaId="p-1"),
        person("Anna Nowak", "9", AT_KRS, korytaId="p-1"),
    ]

    result = for_person(payloads, site, target)

    assert result.changed == []
    assert result.left_out == 2
    assert "2 osoby" in result.reason


def test_of_two_payloads_the_one_naming_the_pages_entry_is_sent():
    site = snapshot(page("p-1", "Anna Nowak", "https://rejestr.io/osoby/1"))
    payloads = [
        person("Anna Nowak", "1", AT_KRS),
        person("Anna Nowak", "9", AT_KRS, korytaId="p-1"),
    ]

    result = for_person(payloads, site, TARGET)

    assert [p.rejestrIo for p in result.changed] == ["https://rejestr.io/osoby/1"]


def test_data_the_site_files_on_another_page_is_not_moved_here():
    # The page links register entry 1, but the export files entry 1 on p-2.
    site = snapshot(
        page("p-2", "Anna Nowak", "https://rejestr.io/osoby/1"),
        page("p-1", "Anna Nowak-Kowalska", "https://rejestr.io/osoby/1"),
    )

    result = for_person([person("Anna Nowak", "1", AT_KRS)], site, TARGET)

    assert result.changed == []
    assert "p-2" in result.reason


def test_a_payload_naming_another_register_entry_does_not_overwrite_the_page():
    # people_merged put entry 7 on p-1, which the page itself links to entry 1.
    site = snapshot(page("p-1", "Anna Nowak", "https://rejestr.io/osoby/1"))
    payload = person("Anna Nowak", "7", AT_KRS, korytaId="p-1")

    result = for_person([payload], site, TARGET)

    assert result.changed == []
    assert result.left_out == 1
    assert "(7)" in result.reason and "(1)" in result.reason


def test_a_page_newer_than_the_export_is_matched_by_its_register_link_alone():
    site = snapshot()  # The page was made after this morning's export.
    payloads = [person("Anna Nowak", "1", AT_KRS), person("Anna Nowak", "7", AT_KRS)]

    result = for_person(payloads, site, TARGET)

    assert [(p.rejestrIo, p.korytaId) for p in result.changed] == [
        ("https://rejestr.io/osoby/1", "p-1")
    ]


def test_nobody_in_the_data_is_said_so():
    result = for_person([], snapshot(page("p-1", "Anna Nowak")), TARGET)

    assert result.changed == [] and result.reason.startswith("w danych nie ma")


# ---------------------------------------------------------------------------
# Narrowing Extract's rows before any is a payload


def test_rows_are_narrowed_to_the_target():
    company = PageTarget(kind="company", node_id="place-1", krs=KRS)
    at_krs = pd.Series({"employment": [{"employed_krs": KRS}], "rejestrio_id": ["1"]})
    elsewhere = pd.Series(
        {"employment": [{"employed_krs": SUBSIDIARY}], "rejestrio_id": ["2"]}
    )

    assert row_is_about(at_krs, company)
    assert not row_is_about(elsewhere, company)

    by_register = pd.Series({"rejestrio_id": ["5", "1"], "krs_name": "X"})
    by_name = pd.Series({"rejestrio_id": ["8"], "full_name": ["ANNA  NOWAK"]})
    by_page = pd.Series({"rejestrio_id": ["8"], "koryta_id": "p-1"})
    stranger = pd.Series({"rejestrio_id": ["8"], "full_name": ["Ewa Lis"]})
    assert row_is_about(by_register, TARGET)
    assert row_is_about(by_name, TARGET)
    assert row_is_about(by_page, TARGET)
    assert not row_is_about(stranger, TARGET)


def test_employment_krs_reads_either_spelling():
    assert employment_krs([{"employed_krs": KRS}, {"krs": SUBSIDIARY}, "x"]) == [
        KRS,
        SUBSIDIARY,
    ]
    assert employment_krs(None) == []
