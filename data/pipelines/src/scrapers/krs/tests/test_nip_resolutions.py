"""That the artifact says the same thing the bucket does.

It exists to be read instead of 17,008 objects, so the property that matters
is not that it parses -- it is that a consumer cannot tell which source it
got. `payloads_from_artifact` rebuilds the stored shape for exactly that
reason, and these pin the round trip.
"""

import json

import pytest

from scrapers.krs import nip_resolutions


def answer(*hits) -> dict:
    return {"hits": [{"krs": krs, "name": name} for krs, name in hits]}


def test_the_open_entry_is_position_zero():
    """`krs_of` returns it, so the artifact must agree about which one it is."""
    rows = nip_resolutions.rows_for(
        "5272703675",
        answer(("0000482636", "STARA"), ("0000716108", "NOWA")),
        "2026-09-01",
    )
    assert [(r.krs, r.position) for r in rows] == [
        ("0000716108", 0),
        ("0000482636", 1),
    ]


def test_each_entry_keeps_its_own_name():
    """Labelling both with the open entry's name hides which era a board sat in."""
    rows = nip_resolutions.rows_for(
        "5272703675",
        answer(("0000482636", "EMITEL SP. Z O.O."), ("0000716108", "EMITEL SA")),
        "d",
    )
    assert {r.krs: r.name for r in rows} == {
        "0000716108": "EMITEL SA",
        "0000482636": "EMITEL SP. Z O.O.",
    }


def test_an_answer_that_found_nothing_is_still_a_row():
    """"Asked and the register had nothing" is a result, not a gap."""
    rows = nip_resolutions.rows_for("1111111111", {"hits": []}, "2026-09-01")
    assert len(rows) == 1
    assert rows[0].found is False
    assert rows[0].krs == ""


def test_a_nip_nobody_asked_about_has_no_row():
    """Which is what makes `found` false mean something."""
    built = {r.nip for r in nip_resolutions.rows_for("1111111111", {}, "d")}
    assert built == {"1111111111"}


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "gs://b/hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/krs/"
            "nip/5272703675/date=2026-09-01",
            ("5272703675", "2026-09-01"),
        ),
        # An odpis, not a search: same host, different route.
        (
            "gs://b/hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/"
            "OdpisPelny/pdf/P/0000000893/date=2026-09-19",
            None,
        ),
    ],
)
def test_only_nip_searches_are_read_off_the_key(url, expected):
    assert nip_resolutions.nip_and_date(url) == expected


def test_the_artifact_round_trips_to_the_stored_shape(tmp_path):
    """A consumer must not be able to tell the artifact from the bucket."""
    payload = answer(("0000482636", "STARA"), ("0000716108", "NOWA"))
    rows = nip_resolutions.rows_for("5272703675", payload, "2026-09-01")
    rows += nip_resolutions.rows_for("1111111111", {"hits": []}, "2026-09-01")

    path = tmp_path / "krs_nip_resolutions.jsonl"
    path.write_text(
        "\n".join(json.dumps(vars(r), ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )

    back = nip_resolutions.payloads_from_artifact(path)
    assert nip_resolutions.krs_entries_of(back["5272703675"]) == (
        nip_resolutions.krs_entries_of(payload)
    )
    assert nip_resolutions.names_of(back["5272703675"]) == (
        nip_resolutions.names_of(payload)
    )
    # The empty answer survives as an answer, so a reader still knows it was
    # asked -- dropping it would send `resolve` back to the register.
    assert "1111111111" in back
    assert nip_resolutions.krs_of(back["1111111111"]) is None
