"""`scripts.region_authorities`: PKW's 2024 winners, as each region's record."""

from scripts.region_authorities import node_id, region_authorities

#: TERC kinds of the gminy the rows below name.
KINDS = {"100501": "1", "100502": "2", "146501": "8"}


def row(**over):
    """A won 2024 row of person_pkw, with what a test does not care about."""
    return {
        "election_year": "2024",
        "election_type": "samorządu",
        "candidacy_success": "TRUE",
        "teryt_candidacy": "100501",
        "office": "Rada miasta",
        "party": "KWW ŁOWICKIE.PL",
        "first_name": "Jan",
        "middle_name": "",
        "last_name": "KOWALSKI",
        "birth_year": 1970.0,
        "party_member": "",
        **over,
    }


def test_files_each_result_on_the_node_its_page_is():
    assert node_id("Sejmik", "100000", KINDS) == "teryt10"
    assert node_id("Rada powiatu", "100500", KINDS) == "teryt1005"
    # A city with powiat rights is a powiat node, not its „Gmina X” twin.
    assert node_id("Rada miasta", "106101", KINDS) == "teryt1061"
    assert node_id("Prezydent", "106101", KINDS) == "teryt1061"
    assert node_id("Rada miasta", "100501", KINDS) == "teryt1005011"
    assert node_id("Wójt", "100502", KINDS) == "teryt1005022"
    assert node_id("Rada dzielnicy", "146501", KINDS) == "teryt1465018"
    assert node_id("Rada gminy", "999999", KINDS) is None


def test_names_winners_as_a_page_does_and_keeps_only_winners():
    regions = region_authorities(
        [
            row(),
            row(first_name="Anna", middle_name="Maria", last_name="NOWAK-ŁĄCKA"),
            row(first_name="Lost", candidacy_success="FALSE"),
            row(first_name="Old", election_year="2018"),
        ],
        KINDS,
    )
    [council] = regions["teryt1005011"]["councils"]
    assert council["seats"] == 2
    assert [m["name"] for m in council["members"]] == [
        "Jan Kowalski",
        "Anna Maria Nowak-Łącka",
    ]
    assert council["members"][0] == {
        "name": "Jan Kowalski",
        "firstName": "Jan",
        "lastName": "Kowalski",
        "birthYear": 1970,
        "committee": "KWW ŁOWICKIE.PL",
    }


def test_takes_the_head_off_the_council_the_seat_passed_on_from():
    regions = region_authorities(
        [
            row(
                office="Burmistrz",
                party_member="członek partii politycznej: Prawo i Sprawiedliwość",
            ),
            row(),  # the same person's council seat, which they gave up
            row(first_name="Ewa", last_name="NOWAK"),
        ],
        KINDS,
    )
    region = regions["teryt1005011"]
    assert region["head"]["office"] == "Burmistrz"
    assert region["head"]["name"] == "Jan Kowalski"
    assert region["head"]["member"] == "Prawo i Sprawiedliwość"
    [council] = region["councils"]
    assert council["seats"] == 2
    assert [m["name"] for m in council["members"]] == ["Ewa Nowak"]


def test_gives_a_party_list_its_parties_and_a_local_list_none():
    regions = region_authorities(
        [row(party="KW PRAWO I SPRAWIEDLIWOŚĆ"), row(first_name="Ewa")],
        KINDS,
    )
    members = regions["teryt1005011"]["councils"][0]["members"]
    assert members[0]["committeeParties"] == ["PiS"]
    assert "committeeParties" not in members[1]
