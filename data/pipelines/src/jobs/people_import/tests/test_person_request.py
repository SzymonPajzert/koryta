"""A person page's „Wyślij dane”, planned as the job plans it: Extract run on
the flags `target_argv` gives it, then `PeoplePayloads.targeted`, against an
export that has the page."""

import sys
from types import SimpleNamespace

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from analysis.payloads.site import SiteSnapshot
from analysis.payloads.target import PageTarget, Targeted
from jobs.people_import.payloads import target_argv
from scrapers.stores import Pipeline

KRS = "0000009022"
#: Maria Iwona Kasprzycka's page, whose rejestr.io link was typed in by hand
#: for an entry the pipeline never bought: no row of the 10-29 people_enriched
#: holds 2346874.
PAGE = {
    "id": "p-1",
    "type": "person",
    "name": "Maria Iwona Kasprzycka",
    "birthDate": "1959-07-14",
    "rejestrIo": "https://rejestr.io/osoby/2346874",
}
TARGET = PageTarget(
    kind="person", node_id="p-1", name="Maria Iwona Kasprzycka", register="2346874"
)
SITE = [
    PAGE,
    {"id": "place-1", "type": "place", "name": "Szpital", "krsNumber": KRS},
    {"id": "teryt28", "type": "region", "name": "Warmińsko-mazurskie", "teryt": "28"},
]
SEJMIK_2018 = {
    "party": "KOALICYJNY KOMITET WYBORCZY PLATFORMA.NOWOCZESNA KOALICJA OBYWATELSKA",
    "election_year": 2018,
    "election_type": "samorządu",
    "teryt_candidacy_wojewodztwo": "28",
    "teryt_candidacy_powiat": "2800",
    "candidacy_success": "FALSE",
    "office": "Sejmik",
}


def person(name: str, born: str, entries: list[str], **extra) -> dict:
    """A person as `PeopleEnriched` leaves them, in a post at `KRS`."""
    return {
        "krs_name": name,
        "full_name": [name],
        "birth_date": born,
        "rejestrio_id": entries,
        "pesel_fingerprint": [f"{name} {born}"],
        "koryta_id": None,
        "employment": [
            {
                "employed_krs": KRS,
                "employed_role": "Zarząd",
                "employed_start": "2026-10-21",
                "employed_end": None,
            }
        ],
        "elections": [],
        **extra,
    }


#: Her, as only an odpis names her: by her name and her birth date, no entry.
HER = person("Maria Iwona Kasprzycka", "1959-07-14", [], elections=[SEJMIK_2018])
#: A namesake with an entry of her own, born another year.
NAMESAKE = person("Maria Kasprzycka", "1953-08-14", ["1714452"])
STRANGER = person("Jan Nowak", "1970-01-01", ["5"])


def plan(monkeypatch, rows: list[dict]) -> Targeted:
    """The request's plan, its pipelines reading `rows` and the export `SITE`."""
    argv = ["koryta_people_import", *target_argv(TARGET, None)]
    monkeypatch.setattr(sys, "argv", argv)
    pipeline = Pipeline.create(PeoplePayloads)
    extract = pipeline.people
    frame = pd.DataFrame.from_records(rows)
    enriched = SimpleNamespace(read_or_process=lambda ctx: frame)
    no_teryt = SimpleNamespace(read_or_process=lambda ctx: None)
    monkeypatch.setattr(extract, "people", enriched)
    monkeypatch.setattr(extract, "teryt", no_teryt)
    # Extract's own selection, without the context `read_or_process` decides
    # a refresh by: what Extract makes of the flags is the point.
    monkeypatch.setattr(extract, "read_or_process", extract.process)
    pipeline._snapshot = SiteSnapshot(pd.DataFrame.from_records(SITE), pd.DataFrame())
    return pipeline.targeted(None, TARGET)  # type: ignore[arg-type]


def test_the_request_reads_the_page_by_its_link():
    assert target_argv(TARGET, None) == ["--rejestrio-id", "2346874"]


def test_a_link_no_row_holds_finds_the_person_by_name_and_birth_date(
    monkeypatch, capsys
):
    result = plan(monkeypatch, [NAMESAKE, HER, STRANGER])

    [sent] = result.changed
    # Sent at the page itself, so the ingest lands it there by the page's id,
    # and with no entry of its own, so it names no other one than the page's.
    assert (sent.korytaId, sent.rejestrIo, sent.birthDate) == (
        "p-1",
        None,
        "1959-07-14",
    )
    assert [company.krs for company in sent.companies] == [KRS]
    assert [(e.election_year, e.teryt) for e in sent.elections] == [("2018", "28")]
    assert (result.new, result.reason) == ([], "")
    out = capsys.readouterr().out
    assert "Found 0 people" in out  # Extract, given the page's entry
    assert "No row holds rejestr.io 2346874" in out


def test_a_request_matching_nobody_at_all_still_says_so(monkeypatch, capsys):
    # Her name, but born another day, and no entry to tell her by: not her,
    # as the ingest reads a name and a birth date.
    born_another_day = person("Maria Iwona Kasprzycka", "1961-03-02", [])

    result = plan(monkeypatch, [NAMESAKE, born_another_day, STRANGER])

    assert (result.changed, result.new, result.up_to_date) == ([], [], 0)
    assert (result.matched, result.left_out) == (0, 0)
    assert result.reason == (
        "w danych nie ma nikogo, kogo dałoby się przypisać do tej strony"
    )


def test_a_link_a_row_holds_reads_nobody_else(monkeypatch, capsys):
    held = person("Maria Iwona Kasprzycka", "1959-07-14", ["2346874"])

    result = plan(monkeypatch, [NAMESAKE, held, HER])

    [sent] = result.changed
    assert sent.rejestrIo == "https://rejestr.io/osoby/2346874"
    assert sent.elections == []  # HER's run is not read: the link found a row
    assert "No row holds" not in capsys.readouterr().out
