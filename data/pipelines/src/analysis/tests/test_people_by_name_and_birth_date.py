"""People only an odpis names: keyed by their PESEL here, found by their name
and birth date on the site.

`SiteSnapshot.resolve` is `lookupPersonDoc` transcribed, `lookupByNameAndBirthDate`
included, and the cases mirror `frontend/tests/server/api/ingest/person.test.ts`.
The fingerprints are made up; none reaches a payload.
"""

from dataclasses import asdict, fields

import pandas as pd

from analysis.payloads.person import (
    PeoplePayloads,
    another_pesels_page,
    matching_one_page,
    missing_from_koryta,
)
from analysis.payloads.site import (
    BY_NAME,
    BY_NAME_AND_DATE,
    HELD_SEVERAL,
    HELD_UNDATED,
    NOT_ON_SITE,
    SiteSnapshot,
)
from entities.composite import Person
from scrapers.stores import Pipeline

BORN = "1971-03-14"
F, G = "f" * 32, "a" * 32
REGISTER = "https://rejestr.io/osoby/"


def page(node_id: str, name: str, **fields) -> dict:
    return {"id": node_id, "type": "person", "name": name, **fields}


def snapshot(*pages: dict) -> SiteSnapshot:
    return SiteSnapshot(pd.DataFrame.from_records(list(pages)), pd.DataFrame())


def person(
    name: str = "Anna Maria Nowak", born: str | None = BORN, register=None
) -> Person:
    return Person(
        name=name,
        companies=[],
        elections=[],
        sources=[],
        rejestrIo=register,
        birthDate=born,
    )


def resolve(site: SiteSnapshot, one: Person) -> tuple[str | None, str]:
    found = site.resolve(asdict(one))
    return (found.page or {}).get("id"), found.how


# ------------------------------------------------------------ the lookup
def test_lands_on_the_page_of_that_name_and_birth_date():
    site = snapshot(page("anna", "Anna Maria Nowak", birthDate=BORN))

    assert resolve(site, person()) == ("anna", BY_NAME_AND_DATE)


def test_finds_the_page_past_its_polish_letters_and_a_middle_name_it_lacks():
    site = snapshot(
        page("anna", "Anna Nowak", birthDate=BORN),
        page("ania", "Ánna Nówak", birthDate="1971-03-15"),
    )

    assert resolve(site, person("Anna Maria Nowák")) == ("anna", BY_NAME_AND_DATE)


def test_lands_on_a_linked_page_of_that_name_and_birth_date():
    site = snapshot(
        page(
            "linked",
            "Anna Maria Nowak",
            birthDate=BORN,
            rejestrIo="https://rejestr.io/osoby/5",
        )
    )

    assert resolve(site, person()) == ("linked", BY_NAME_AND_DATE)


def test_a_namesake_born_on_another_day_is_somebody_else():
    site = snapshot(page("other", "Anna Maria Nowak", birthDate="1980-01-01"))

    assert resolve(site, person()) == (None, NOT_ON_SITE)


def test_a_namesake_with_another_middle_name_is_somebody_else():
    site = snapshot(page("other", "Anna Ewa Nowak", birthDate=BORN))

    assert resolve(site, person()) == (None, NOT_ON_SITE)


def test_a_page_of_the_name_with_no_birth_date_holds_the_person_back():
    site = snapshot(page("undated", "Anna Nowak"))

    assert resolve(site, person()) == (None, HELD_UNDATED)


def test_a_linked_page_of_the_name_with_no_birth_date_holds_the_person_back():
    """177 of the 191 held on 2026-10-09: the entry's person is born on a day
    the page does not store, so it could be them as much as a namesake."""
    site = snapshot(
        page("linked", "Anna Nowak", rejestrIo="https://rejestr.io/osoby/5")
    )

    assert resolve(site, person()) == (None, HELD_UNDATED)


def test_an_entry_still_adopts_an_unlinked_page_of_its_name_with_no_date():
    site = snapshot(page("stary", "Anna Maria Nowak"))

    assert resolve(site, person(register="https://rejestr.io/osoby/7")) == (
        "stary",
        BY_NAME,
    )


def test_an_entry_never_lands_on_a_page_of_its_name_born_on_another_day():
    site = snapshot(page("other", "Anna Maria Nowak", birthDate="1980-01-01"))

    assert resolve(site, person(register="https://rejestr.io/osoby/7")) == (
        None,
        NOT_ON_SITE,
    )


def test_two_pages_of_the_name_and_date_hold_the_person_back():
    site = snapshot(
        page("one", "Anna Maria Nowak", birthDate=BORN),
        page("two", "Anna Nowak", birthDate=BORN),
    )

    assert resolve(site, person()) == (None, HELD_SEVERAL)


def test_a_merged_page_and_its_survivor_are_one_page():
    site = snapshot(
        page("tombstone", "Anna Maria Nowak", birthDate=BORN, merged_into="survivor"),
        page("survivor", "Anna Nowak", birthDate=BORN),
    )

    assert resolve(site, person()) == ("survivor", BY_NAME_AND_DATE)


def test_a_page_linking_another_entry_is_neither_a_match_nor_a_doubt():
    site = snapshot(
        page(
            "linked",
            "Anna Maria Nowak",
            birthDate=BORN,
            rejestrIo="https://rejestr.io/osoby/5",
        ),
        page("undated", "Anna Nowak", rejestrIo="https://rejestr.io/osoby/6/anna"),
    )

    assert resolve(site, person(register="https://rejestr.io/osoby/7")) == (
        None,
        NOT_ON_SITE,
    )


def test_neither_a_date_nor_an_entry_matches_by_the_exact_name_as_before():
    site = snapshot(
        page(
            "linked",
            "Anna Maria Nowak",
            birthDate="1980-01-01",
            rejestrIo="https://rejestr.io/osoby/5",
        )
    )

    assert resolve(site, person(born=None)) == ("linked", BY_NAME)


# ------------------------------------------------------ the run's guards
def test_people_the_ingest_would_hold_back_are_neither_new_nor_on_the_site():
    site = snapshot(page("undated", "Anna Nowak"))
    held = person()

    assert missing_from_koryta([held], site) == []
    assert matching_one_page([held], site) == []


def test_two_people_of_one_name_and_birth_date_are_left_out_together():
    """The second would land on the page the first was just given."""
    site = snapshot()
    one, other = person(), person("Anna Nowak")
    linked, unlinked = person(register="osoby/1"), person()
    entries = [person(register="osoby/1"), person(register="osoby/2")]

    assert missing_from_koryta([one, other], site) == []
    assert missing_from_koryta([linked, unlinked], site) == []
    # Two register entries are two people to the ingest, and so are two days.
    assert missing_from_koryta(entries, site) == entries
    apart = [person(), person(born="1980-01-01")]
    assert missing_from_koryta(apart, site) == apart


def test_two_payloads_reaching_one_page_by_name_and_date_are_both_left_out():
    site = snapshot(page("anna", "Anna Maria Nowak", birthDate=BORN))

    assert matching_one_page([person()], site) == [person()]
    assert matching_one_page([person(), person("Anna Nowak")], site) == []


def test_a_page_its_own_entry_reaches_is_not_also_somebody_elses_by_name():
    site = snapshot(
        page("anna", "Anna Maria Nowak", birthDate=BORN, rejestrIo=f"{REGISTER}5")
    )
    hers = person(register=f"{REGISTER}5")

    assert matching_one_page([hers, person()], site) == [hers]


def test_a_page_whose_entry_has_another_pesel_is_somebody_else():
    """Name and date agree, but the odpisy give the page's entry another PESEL:
    two people, whom the ingest - which never sees a PESEL - would take for one."""
    site = snapshot(
        page(
            "linked",
            "Anna Maria Nowak",
            birthDate=BORN,
            rejestrIo="https://rejestr.io/osoby/5",
        )
    )
    payload = person()

    assert another_pesels_page(site, payload, frozenset({F}), {"5": frozenset({G})})
    assert not another_pesels_page(site, payload, frozenset({F}), {"5": frozenset({F})})
    # Nothing known either way.
    assert not another_pesels_page(site, payload, frozenset({F}), {})
    assert not another_pesels_page(site, payload, frozenset(), {"5": frozenset({G})})


# ------------------------------------------------------------ the payload
def row(**fields) -> pd.Series:
    base = {
        "full_name": ["Anna Maria Nowak"],
        "rejestrio_id": [],
        "pesel_fingerprint": [F],
        "birth_date": BORN,
        "koryta_id": None,
        "koryta_rejestrio_id": None,
        "employment": [],
        "elections": [],
    }
    return pd.Series({**base, **fields})


def payload_of(**fields) -> Person:
    pipeline = Pipeline.create(PeoplePayloads)
    return pipeline.map_person_payload(ctx=None, row=row(**fields))  # type: ignore[arg-type]


def test_somebody_only_an_odpis_names_is_sent_by_name_and_birth_date():
    sent = payload_of()

    assert (sent.name, sent.birthDate, sent.rejestrIo) == (
        "Anna Maria Nowak",
        BORN,
        None,
    )
    # The PESEL is the pipeline's alone: no field for it, and not in any value.
    assert not any("pesel" in one.name.lower() for one in fields(Person))
    assert F not in repr(asdict(sent))


def test_a_page_found_by_the_name_alone_is_not_sent_as_theirs():
    """`people_merged` matched a page by the name; the ingest decides by the
    name and the birth date instead."""
    assert payload_of(koryta_id="namesake").korytaId is None
    assert payload_of(rejestrio_id=["5"], koryta_id="anna").korytaId == "anna"


def test_one_pesel_under_two_entries_keeps_the_one_its_page_links():
    both = ["126307", "715231"]

    assert payload_of(rejestrio_id=both).rejestrIo == "https://rejestr.io/osoby/126307"
    assert (
        payload_of(rejestrio_id=both, koryta_rejestrio_id=715231.0).rejestrIo
        == "https://rejestr.io/osoby/715231"
    )
