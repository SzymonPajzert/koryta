"""The candidacies `scripts.payload_elections` writes out for each person."""

from scripts.payload_elections import payload_elections


def sobczak(**overrides):
    """Michał Jerzy Sobczak's row as `people_enriched` holds it, cut to what
    the payload reads."""
    row = {
        "koryta_id": "1gTpeJh06gps7G2wgEaE",
        "rejestrio_id": ["870160"],
        "elections": [
            {
                "party": "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI",
                "election_year": 2024,
                "election_type": "samorządu",
                "teryt_candidacy_wojewodztwo": "10",
                "teryt_candidacy_powiat": "1000",
                "teryt_living_wojewodztwo": "10",
                "teryt_living_powiat": "1061",
                "candidacy_success": "FALSE",
                "office": "Sejmik",
            },
            {
                "party": "KOMITET WYBORCZY POROZUMIENIE ŁOWICKIE",
                "election_year": 2018,
                "election_type": "samorządu",
                "teryt_candidacy_wojewodztwo": "10",
                "teryt_candidacy_powiat": "1005",
                "candidacy_success": "TRUE",
                "office": "Rada miasta",
            },
        ],
    }
    row.update(overrides)
    return row


def test_a_person_s_runs_as_the_payload_sends_them():
    out = payload_elections(sobczak())

    assert out["korytaId"] == "1gTpeJh06gps7G2wgEaE"
    assert out["rejestrIo"] == ["870160"]
    sejmik, council = out["elections"]
    # Where it was stood, not where he lives; a sejmik under its województwo.
    assert (sejmik["election_type"], sejmik["election_year"], sejmik["teryt"]) == (
        "Sejmik",
        "2024",
        "10",
    )
    assert sejmik["elected"] is False
    assert (council["election_type"], council["teryt"], council["elected"]) == (
        "Rada miasta",
        "1005",
        True,
    )


def test_a_local_run_with_no_office_is_samorzad():
    row = sobczak()
    row["elections"][1]["office"] = None

    assert payload_elections(row)["elections"][1]["election_type"] == "Samorząd"


def test_a_row_no_page_can_be_found_by_is_left_out():
    assert payload_elections(sobczak(koryta_id=None, rejestrio_id=[])) is None


def test_a_register_entry_alone_is_enough():
    out = payload_elections(sobczak(koryta_id=None, rejestrio_id="870160"))

    assert out["korytaId"] is None
    assert out["rejestrIo"] == ["870160"]
