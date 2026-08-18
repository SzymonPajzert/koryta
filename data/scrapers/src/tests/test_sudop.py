"""What the SUDOP rollup is allowed to emit.

The numbers quoted here are from a full pull on 2026-08-18: 9461 decisions
granted for disaster damage since the 2024 flood, 3711 beneficiaries, 30
granting institutions, two programmes. Of those beneficiaries the biała lista
put 748 in KRS, which is what the rollup keeps.
"""

from scrapers.sudop import people
from scrapers.sudop.pipelines import _decimal, _payloads


def decision(**overrides):
    base = dict(
        grantor_nip="7532132088",
        grantor_name="STAROSTA POWIATU NYSA",
        beneficiary_nip="7531608850",
        beneficiary_name="ALL WINDOWS GROUP",
        measure="SA.116730",
        granted_on="2024-11-20",
        gross=1000.0,
        nominal=1000.0,
        form="dotacja",
        pkd="22.23",
        size="mikroprzedsiębiorstwo",
        teryt="1607053",
    )
    base.update(overrides)
    return base


REGISTER = {
    "7531608850": {"krs": "0000345467", "name": "ALL WINDOWS GROUP", "regon": ""},
    "6131209985": {"krs": "", "name": "Stanisław Leszczyński", "regon": ""},
}


def test_decimal_takes_both_separators():
    # The API returns amounts as strings and is not consistent about which
    # separator it uses.
    assert _decimal("23015.94") == 23015.94
    assert _decimal("23015,94") == 23015.94
    assert _decimal("") == 0.0
    assert _decimal(None) == 0.0


def test_keeps_beneficiaries_with_no_krs_number():
    # Four in five of them, and they are kept. An earlier version dropped them,
    # which also dropped the single-decision micro-firms that are worth reading.
    payloads = _payloads([decision(), decision(beneficiary_nip="6131209985")], REGISTER)

    assert sorted(payload["nip"] for payload in payloads) == [
        "6131209985",
        "7531608850",
    ]
    by_nip = {payload["nip"]: payload for payload in payloads}
    assert by_nip["7531608850"]["krs"] == "0000345467"
    assert by_nip["7531608850"]["soleTrader"] is False
    # No KRS entry, and the register did answer - so this is a natural person
    # trading under their own name, which is what decides publication.
    assert "krs" not in by_nip["6131209985"]
    assert by_nip["6131209985"]["soleTrader"] is True


def test_says_nothing_about_a_beneficiary_the_register_did_not_answer_for():
    # 918 of the 3715. "Not found" is not evidence of anything, so the payload
    # carries no flag and the endpoint applies its own cautious default.
    (payload,) = _payloads([decision(beneficiary_nip="9999999999")], REGISTER)

    assert "soleTrader" not in payload
    assert "krs" not in payload


def test_rolls_decisions_up_per_grantor():
    payloads = _payloads(
        [
            decision(gross=100.0, granted_on="2024-11-20"),
            decision(gross=250.0, granted_on="2025-03-06"),
            decision(
                grantor_nip="5213017228",
                grantor_name="Prezes Zakładu Ubezpieczeń Społecznych",
                gross=40.0,
                granted_on="2024-10-18",
            ),
        ],
        REGISTER,
    )

    (payload,) = payloads
    assert [grant["grantor_nip"] for grant in payload["grants"]] == [
        # Largest first, so a reader of the payload sees the grant that matters.
        "7532132088",
        "5213017228",
    ]
    starosta, zus = payload["grants"]
    assert starosta["gross"] == 350.0
    assert starosta["decisions"] == 2
    assert starosta["first_decision"] == "2024-11-20"
    assert starosta["last_decision"] == "2025-03-06"
    assert zus["decisions"] == 1


def test_describes_a_beneficiary_by_its_latest_decision():
    # A company that was renamed or moved between two grants is better
    # described by the more recent of them.
    payloads = _payloads(
        [
            decision(
                granted_on="2024-11-20",
                beneficiary_name="Stara Nazwa",
                teryt="1607053",
            ),
            decision(
                granted_on="2025-03-06",
                beneficiary_name="Nowa Nazwa",
                teryt="0208125",
                pkd="25.12",
            ),
        ],
        REGISTER,
    )

    (payload,) = payloads
    assert payload["name"] == "Nowa Nazwa"
    assert payload["teryt"] == "0208125"
    # The PKD codes are a union, though: a company that reported two of them
    # does both, and the later decision naming one is not it dropping the other.
    assert payload["activity"] == ["22.23", "25.12"]


def test_pads_the_krs_number():
    # The white list returns it padded, KRS itself does not, and koryta.pl
    # stores ten digits - `findCompanyByKRS` is an equality match, so an unpadded
    # number would create a second node for a company already on the site.
    (payload,) = _payloads(
        [decision()], {"7531608850": {"krs": "345467", "name": "", "regon": ""}}
    )

    assert payload["krs"] == "0000345467"


def test_keeps_two_programmes_apart():
    # SA.117151, 109 decisions of preferential loans from the regional
    # development agencies, is a second flood measure and a second fact: the
    # measure is part of the edge's identity, so one payload carrying both
    # would collapse them onto one document.
    payloads = _payloads(
        [
            decision(measure="SA.116730", gross=100.0),
            decision(measure="SA.117151", gross=40.0),
        ],
        REGISTER,
    )

    assert [payload["measure"] for payload in payloads] == [
        "SA.116730",
        "SA.117151",
    ]
    assert [payload["grants"][0]["gross"] for payload in payloads] == [100.0, 40.0]


def person(node_id, name, *powiats):
    return people.Person(node_id=node_id, name=name, powiats=frozenset(powiats))


def test_normalises_polish_letters_without_splitting_a_name():
    # NFKD leaves ł alone - it is its own codepoint, not a base plus a mark - so
    # a normaliser that only strips combining marks turns Małgorzata into two
    # words and starts matching different people to each other.
    assert people.normalize_name("Małgorzata Wójcik") == "MALGORZATA WOJCIK"
    assert people.normalize_name("MAŁGORZATA WÓJCIK") == people.normalize_name(
        "Małgorzata Wójcik"
    )
    assert people.normalize_name("Żaneta Ćwik-Łaska") == "ZANETA CWIK LASKA"


def test_powiat_is_the_first_four_digits():
    assert people.powiat_of("1607053") == "1607"
    assert people.powiat_of("16") == ""
    assert people.powiat_of("") == ""


def test_a_name_alone_is_not_a_match():
    # The finding this rule exists for: on the real data 21 sole traders carry
    # the name of somebody on the site and all 21 are in a different powiat.
    index = people.index([person("p1", "Grzegorz Lach", "1418")])

    assert people.match("Grzegorz Lach", "1607053", index) is None
    assert people.match("Grzegorz Lach", "1418011", index).node_id == "p1"


def test_two_people_of_that_name_in_the_powiat_match_neither():
    index = people.index(
        [person("p1", "Jan Krupa", "0207"), person("p2", "Jan Krupa", "0207")]
    )

    assert people.match("Jan Krupa", "0207011", index) is None


def test_the_owner_link_is_an_enrichment_and_not_a_gate():
    owners = {"6131209985": {"name": "Grzegorz Lach", "teryt": "1607053"}}
    elsewhere = people.index([person("p1", "Grzegorz Lach", "1418")])
    here = people.index([person("p1", "Grzegorz Lach", "1607")])
    rows = [decision(beneficiary_nip="6131209985")]

    # Wrong powiat: the beneficiary is still stored, just without the claim.
    (unlinked,) = _payloads(rows, REGISTER, owners, elsewhere)
    assert "owner" not in unlinked
    assert unlinked["nip"] == "6131209985"

    (linked,) = _payloads(rows, REGISTER, owners, here)
    assert linked["owner"] == {
        "name": "Grzegorz Lach",
        "node_id": "p1",
        "teryt": "1607",
    }
    assert "krs" not in linked
