"""The structural signals, and the test each of them has to pass.

Numbers here are measured over the whole register as of 2026-08-18: 3715
beneficiaries, 9459 decisions, 699.2 M PLN.
"""

from scrapers.sudop import signals


def beneficiary(**overrides):
    base = dict(
        gross=50_000.0,
        nominal=50_000.0,
        size="0",
        teryt="1607053",
        pkd=("22.23",),
        decision_values=(50_000.0,),
        grantors=("7532132088",),
    )
    base.update(overrides)
    return signals.Beneficiary(**base)


BUSY = {"7532132088": 360, "5213017228": 5690}


def test_an_ordinary_micro_firm_in_the_flood_zone_trips_nothing():
    assert signals.signals(beneficiary(), BUSY) == []


def test_non_sme():
    # 79 of them, 10.0% of the money, at a median of 24,517 PLN - below the
    # register's own median of 46,381. Not a size signal in disguise: 46 have a
    # single decision, and the list is Lidl, Dino, Rossmann, Poczta Polska.
    assert "non_sme" in signals.signals(beneficiary(size="3"), BUSY)
    for code in ("0", "1", "2", ""):
        assert "non_sme" not in signals.signals(beneficiary(size=code), BUSY)


def test_outside_the_flood_voivodeships():
    # 96.9% of decisions went to a seat in 02, 16 or 24.
    assert "outside_flood_region" in signals.signals(beneficiary(teryt="3021011"), BUSY)
    for teryt in ("0208125", "1607053", "2461011"):
        assert "outside_flood_region" not in signals.signals(
            beneficiary(teryt=teryt), BUSY
        )
    # Nothing asserted when there is no seat to test.
    assert "outside_flood_region" not in signals.signals(beneficiary(teryt=""), BUSY)


def test_a_decision_cut_to_the_ceiling():
    # 29 beneficiaries, 6.9% of the money, every one of them ZUS's, and none of
    # them has 8 decisions. Spotted per decision rather than on the total, so a
    # beneficiary whose sum is nowhere near a million is still caught.
    assert "capped_decision" in signals.signals(
        beneficiary(gross=1_450_000.0, decision_values=(1_000_000.0, 450_000.0)),
        BUSY,
    )
    assert "capped_decision" not in signals.signals(
        beneficiary(gross=1_000_000.0, decision_values=(600_000.0, 400_000.0)),
        BUSY,
    )
    # To the grosz. 999,999.99 was measured, not cut to fit.
    assert "capped_decision" not in signals.signals(
        beneficiary(decision_values=(999_999.99,)), BUSY
    )


def test_a_grantor_that_barely_ran_a_programme():
    # STAROSTA POWIATU WAŁBRZYCH made one decision in the whole register, worth
    # 3.67 M PLN. The count is across the register, not within the beneficiary.
    rare = {**BUSY, "8862633345": 1}
    assert "rare_grantor" in signals.signals(
        beneficiary(grantors=("8862633345",)), rare
    )
    assert "rare_grantor" not in signals.signals(beneficiary(), rare)
    # Any one of several grantors is enough.
    assert "rare_grantor" in signals.signals(
        beneficiary(grantors=("7532132088", "8862633345")), rare
    )


def test_asset_light_needs_both_the_section_and_the_floor():
    # The unfiltered J/K/L/M block is 393 beneficiaries of mostly ordinary small
    # sums; with the floor it is 59 worth reading, none with 8+ decisions.
    assert "asset_light" in signals.signals(
        beneficiary(gross=250_000.0, pkd=("68.20",)), BUSY
    )
    assert "asset_light" not in signals.signals(
        beneficiary(gross=150_000.0, pkd=("68.20",)), BUSY
    )
    assert "asset_light" not in signals.signals(
        beneficiary(gross=250_000.0, pkd=("22.23",)), BUSY
    )


def test_pkd_sections():
    assert signals.pkd_section("62.01") == "J"
    assert signals.pkd_section("64.19") == "K"
    assert signals.pkd_section("68.20") == "L"
    assert signals.pkd_section("70.22") == "M"
    # Manufacturing, retail, construction: a flood can damage those.
    assert signals.pkd_section("22.23") == ""
    assert signals.pkd_section("47.11") == ""
    assert signals.pkd_section("41.20") == ""
    assert signals.pkd_section("") == ""
    assert signals.pkd_section("nonsense") == ""


def test_nothing_here_counts_decisions():
    # The whole point. The reference rule flags 8+ decisions; those 71
    # beneficiaries hold 9.78% of the money and the 1340 with exactly one hold
    # 9.72%. A signal that varied with the number of decisions would re-find the
    # same large repeat recipients and miss 110 of the 130 above 1 M PLN.
    one = beneficiary(size="3", decision_values=(50_000.0,))
    many = beneficiary(size="3", decision_values=(10_000.0,) * 20)

    assert signals.signals(one, BUSY) == signals.signals(many, BUSY) == ["non_sme"]
