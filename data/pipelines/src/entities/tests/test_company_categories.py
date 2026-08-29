"""Tests for the company category mapping.

The PKD code lists are copied verbatim from the `activity` field of the named
company's node, so these pin the mapping against the register as it actually
reads rather than against a tidied-up version of it. Companies are named by KRS
number so an entry can be re-checked against the register.
"""

import unittest

from entities.company_categories import (
    CATEGORY_VALUES,
    COMPANY_CATEGORIES,
    KOLEJE,
    SPZOZ,
    categories_for,
    matches_pkd,
)


class TestMatchesPkd(unittest.TestCase):
    def test_matches_any_declared_code_not_just_the_first(self):
        # PKP Cargo Connect's main activity is road freight; it hauls by rail
        # as its tenth declared code
        self.assertTrue(matches_pkd(["49.41.Z", "52.10.B", "49.20.Z"], ("49.20",)))

    def test_prefix_is_directional(self):
        self.assertTrue(matches_pkd(["49.20.Z"], ("49.20",)))
        # A code truncated to the group is too coarse to place a company
        self.assertFalse(matches_pkd(["49.2."], ("49.20",)))

    def test_empty_and_missing_activity(self):
        self.assertFalse(matches_pkd([], ("49.20",)))
        self.assertFalse(matches_pkd(None, ("49.20",)))


class TestCategoriesFor(unittest.TestCase):
    def test_no_activity_and_no_override_is_no_category(self):
        self.assertEqual(categories_for("0000999999", []), [])
        self.assertEqual(categories_for(None, None), [])

    def test_hospitals_and_water(self):
        self.assertEqual(categories_for("0000999999", ["86.10.Z"]), ["szpitale"])
        self.assertEqual(categories_for("0000999999", ["36.00.Z"]), ["wodociagi"])
        self.assertEqual(categories_for("0000999999", ["37.00.Z"]), ["wodociagi"])

    def test_a_sector_code_below_the_main_one_does_not_place_a_company(self):
        # An imaging chain that lists 86.10 second among ten codes is not a
        # hospital - it is an outpatient provider, which is what its main code
        # says - and a fertiliser works that draws its own water is neither.
        # Both were in `szpitale`/`wodociagi` before the main-code rule.
        self.assertEqual(
            categories_for("0000999999", ["86.22.Z", "86.10.Z"]), ["przychodnie"]
        )
        self.assertEqual(categories_for("0000999999", ["20.15.Z", "36.00.Z"]), [])

    def test_water_needs_both_codes_when_neither_is_the_main_one(self):
        # A gmina utility files water and sewage as a pair, whatever it calls its
        # headline business; a plant with its own intake files one of them.
        self.assertEqual(
            categories_for("0000999999", ["38.11.Z", "36.00.Z", "37.00.Z"]),
            ["wodociagi", "odpady"],
        )
        self.assertEqual(
            categories_for("0000999999", ["38.11.Z", "36.00.Z"]), ["odpady"]
        )

    def test_more_than_one_category(self):
        # 36.00 as the main activity, 49.20 as a secondary: `wodociagi` reads the
        # main code, `koleje` reads any of them.
        self.assertEqual(
            categories_for("0000999999", ["36.00.Z", "49.20.Z"]),
            ["wodociagi", "koleje"],
        )

    def test_krs_is_padded_before_lookup(self):
        # The register writes 0000042646; a payload may carry it unpadded
        self.assertIn("koleje", categories_for("42646", ["62.01.Z"]))

    def test_order_is_stable(self):
        # The value ends up in a Firestore document a diff is taken against, so
        # it has to come out in `COMPANY_CATEGORIES` order however the codes
        # were given. Asserted as a subsequence rather than against the whole
        # list: no company matches every category.
        result = categories_for("0000999999", ["86.10.Z", "36.00.Z", "37.00.Z"])
        self.assertEqual(result, ["szpitale", "wodociagi"])
        # Reordered, the same three codes mean something else: 86.10 is no
        # longer the main activity, so this is a water utility with a clinic.
        reordered = categories_for("0000999999", ["36.00.Z", "37.00.Z", "86.10.Z"])
        self.assertEqual(reordered, ["wodociagi"])
        order = list(CATEGORY_VALUES)
        self.assertEqual(result, sorted(result, key=order.index))


class TestKolejeByPkd(unittest.TestCase):
    """Companies the prefix rules alone place correctly."""

    def assertKoleje(self, krs, activity):
        self.assertIn("koleje", categories_for(krs, activity))

    def assertNotKoleje(self, krs, activity):
        self.assertNotIn("koleje", categories_for(krs, activity))

    def test_pkp_intercity(self):
        self.assertKoleje(
            "0000296032",
            [
                "49.10.Z",
                "49.20.Z",
                "52.21.Z",
                "49.31.Z",
                "49.39.Z",
                "77.39.Z",
                "79.12.Z",
                "79.90.B",
                "82.20.Z",
                "33.17.Z",
            ],
        )

    def test_pkp_cargo(self):
        self.assertKoleje(
            "0000027702",
            [
                "49.20.Z",
                "33.17.Z",
                "45.20.Z",
                "49.10.Z",
                "52.10.A",
                "52.10.B",
                "52.21.Z",
                "52.24.C",
                "52.29.C",
                "69.20.Z",
            ],
        )

    def test_skm_trojmiasto_declares_only_the_2025_urban_rail_code(self):
        # KRS 0000076705: no 49.10, no 49.20, no 42.12. The PKD 2025 revision
        # split urban and suburban rail out of 49.31 into 49.12.
        self.assertKoleje(
            "0000076705",
            [
                "49.12.Z",
                "49.31.Z",
                "49.32.Z",
                "52.21.B",
                "52.32.Z",
                "25.53.Z",
                "33.12.Z",
                "33.13.Z",
                "33.14.Z",
                "33.17.Z",
            ],
        )

    def test_lodzka_kolej_aglomeracyjna(self):
        self.assertKoleje(
            "0000359408",
            [
                "49.12.Z",
                "49.39.Z",
                "77.39.Z",
                "49.31.Z",
                "49.32.Z",
                "52.21.B",
                "33.17.Z",
                "35.1.",
                "46.81.Z",
                "85.59.B",
            ],
        )

    def test_koleje_dolnoslaskie_declares_the_2025_interurban_code(self):
        self.assertKoleje(
            "0000298575",
            [
                "49.11.Z",
                "25.5.",
                "33.1.",
                "49.3.",
                "52.21.B",
                "52.32.Z",
                "81.2.",
                "77.3.",
                "85.5.",
                "64.99.",
            ],
        )

    def test_pkp_plk_is_reached_only_by_the_track_building_code(self):
        # PLK's main activity is 52.21, which also covers roads, parking and
        # bus terminals, so 42.12 is the only usable handle on it
        self.assertKoleje(
            "0000037568",
            [
                "52.21.B",
                "42.12.Z",
                "42.22.Z",
                "43.99.Z",
                "68.20.Z",
                "74.99.Z",
                "71.12.B",
                "80.01.Z",
                "85.59.D",
                "62.90.Z",
            ],
        )

    def test_rolling_stock_manufacture(self):
        # 30.20 Produkcja lokomotyw kolejowych oraz taboru szynowego
        self.assertKoleje(
            "0000069009",
            [
                "30.20.Z",
                "25.11.Z",
                "25.61.Z",
                "25.62.Z",
                "27.12.Z",
                "29.20.Z",
                "33.11.Z",
                "33.13.Z",
                "33.17.Z",
                "71.20.B",
            ],
        )
        self.assertKoleje("0000093623", ["30.20.Z", "25.11.Z", "33.11.Z"])
        self.assertKoleje("0000391105", ["30.20.Z", "25.11.Z", "29.20.Z"])

    def test_urban_bus_and_road_codes_are_not_rail(self):
        # 49.31 is trams, metro and buses together; 52.21 covers roads,
        # parking and bus terminals; 49.32 is taxis
        self.assertNotKoleje("0000999999", ["49.31.Z"])
        self.assertNotKoleje("0000999999", ["52.21.Z"])
        self.assertNotKoleje("0000999999", ["52.21.B"])
        self.assertNotKoleje("0000999999", ["49.32.Z"])
        self.assertNotKoleje("0000999999", ["49.39.Z"])
        self.assertNotKoleje("0000999999", ["42.11.Z"])


class TestKolejeOverrides(unittest.TestCase):
    """Companies only the override lists get right."""

    def test_pkp_group_companies_with_no_rail_pkd(self):
        # The holding company itself files as 70.10, dzialalnosc firm centralnych
        self.assertIn("koleje", categories_for("0000019193", ["70.10.Z", "68.20.Z"]))
        self.assertIn("koleje", categories_for("0000042646", ["62.01.Z", "62.02.Z"]))
        self.assertIn("koleje", categories_for("0000504917", ["95.10.Z"]))
        self.assertIn("koleje", categories_for("0000377050", ["52.24.C"]))

    def test_rolling_stock_repair_shops_that_only_carry_the_broad_33_17(self):
        # 33.17 also holds water utilities and an orthopaedic workshop, so
        # these are named rather than matched
        self.assertIn("koleje", categories_for("0000327801", ["33.17.Z", "33.12.Z"]))
        self.assertIn("koleje", categories_for("0000091303", ["33.17.Z", "38.31.Z"]))
        self.assertNotIn("koleje", categories_for("0000999999", ["33.17.Z"]))

    def test_traction_power_group(self):
        for krs in ("0000541901", "0000610778", "0000610805"):
            self.assertIn("koleje", categories_for(krs, ["64.21.Z"]))

    def test_companies_krs_stores_no_pkd_for(self):
        # No prefix list can reach a company with an empty activity, so the
        # ones that matter are named
        for krs in (
            "0000014327",
            "0000849277",
            "0000249835",
            "0000496856",
            "0000569557",
            "0000031521",
            "0000034257",
            "0000152612",
        ):
            self.assertEqual(categories_for(krs, []), ["koleje"], krs)

    def test_pkp_group_entities_no_pkd_rule_can_reach(self):
        # Windykacja Kolejowa collects the group's debts and files 64.99,
        # pozostala finansowa dzialalnosc uslugowa; the register's rejestr P
        # names PKP Cargo S.A. as its sole shareholder.
        self.assertEqual(categories_for("0000487558", ["64.99.Z"]), ["koleje"])
        # Fundacja Grupy PKP is in the rejestr stowarzyszen and declares no PKD
        # at all. Its registered purpose is level-crossing safety, support for
        # the development of rail transport, and railway heritage - so it is a
        # rail entity even though it is not a rail company, and the ten board
        # and council members the site holds for it are the reason to say so.
        self.assertEqual(categories_for("0000499069", []), ["koleje"])

    def test_cable_cars_are_not_railways(self):
        for krs in ("0000312594", "0000079964", "0000527636"):
            self.assertNotIn("koleje", categories_for(krs, []))

    def test_railway_branded_hospitals_stay_hospitals(self):
        self.assertEqual(
            categories_for("0000074422", ["86.10.Z", "56.10.A"]), ["szpitale"]
        )

    def test_railway_branded_clinics_with_no_pkd_get_nothing(self):
        # These four are SPZOZ entries with an empty `activity`, so their name
        # is the only thing about them a rule could read - and it says
        # "kolejowy". Naming them on the exclude list is what keeps the answer
        # at "no category" rather than at the wrong one. That they are also not
        # in `szpitale` is a separate gap: 86.10 cannot reach a company that
        # declares no PKD.
        for krs in ("0000004917", "0000132016", "0000046263", "0000031391"):
            self.assertEqual(categories_for(krs, []), [], krs)

    def test_road_and_quarry_companies_that_carry_a_rail_code_incidentally(self):
        # Instytut Badawczy Drog i Mostow: 42.12 is one of ten construction codes
        self.assertNotIn(
            "koleje",
            categories_for("0000158240", ["72.19.Z", "42.11.Z", "42.12.Z"]),
        )
        # Kopalnia Wapienia Czatkowice declares 49.20 because it has a siding
        self.assertNotIn("koleje", categories_for("0000073875", ["08.11.Z", "49.20.Z"]))
        # Orlen Aviation, likewise
        self.assertNotIn("koleje", categories_for("0000022177", ["52.23.Z", "49.20.Z"]))

    def test_an_excluded_water_utility_keeps_its_own_category(self):
        # Wikom carries 42.12; excluding it from koleje must not cost it wodociagi
        self.assertEqual(
            categories_for("0000209019", ["36.00.Z", "42.12.Z"]), ["wodociagi"]
        )


class TestOverrideListsAreWellFormed(unittest.TestCase):
    def test_no_company_is_both_included_and_excluded(self):
        for category in COMPANY_CATEGORIES:
            overlap = category.included_krs & category.excluded_krs
            self.assertEqual(overlap, frozenset(), f"{category.value}: {overlap}")

    def test_krs_numbers_are_ten_digits(self):
        for category in COMPANY_CATEGORIES:
            for override in category.include + category.exclude:
                self.assertRegex(override.krs, r"^\d{10}$", override.name)

    def test_every_override_carries_a_reason(self):
        for category in COMPANY_CATEGORIES:
            for override in category.include + category.exclude:
                self.assertTrue(override.reason.strip(), override.name)

    def test_no_duplicate_krs_within_a_list(self):
        for category in COMPANY_CATEGORIES:
            for name, entries in (
                ("include", category.include),
                ("exclude", category.exclude),
            ):
                krs = [o.krs for o in entries]
                # Polskie Koleje Linowe holds two separate registrations, so
                # duplicate *names* are fine; duplicate numbers are not
                self.assertEqual(len(krs), len(set(krs)), f"{category.value}.{name}")

    def test_category_values_are_unique(self):
        self.assertEqual(len(CATEGORY_VALUES), len(set(CATEGORY_VALUES)))

    def test_koleje_carries_both_override_lists(self):
        # The point of moving this out of the frontend: the prefix rules alone
        # neither reach the PKP group nor keep the road builders out
        self.assertTrue(KOLEJE.include)
        self.assertTrue(KOLEJE.exclude)


if __name__ == "__main__":
    unittest.main()


class TestFormaPrawna(unittest.TestCase):
    """The SPZOZ hospitals, which no PKD rule can reach.

    243 of the site's companies are `samodzielny publiczny zaklad opieki
    zdrowotnej`. They sit in the associations register, which has no
    `przedmiotDzialalnosci` section at all, so their `activity` is empty and
    stays empty however often the crawl runs.
    """

    def test_spzoz_is_a_hospital_with_no_pkd_at_all(self):
        self.assertEqual(categories_for("0000059726", [], form=SPZOZ), ["szpitale"])

    def test_form_is_compared_case_insensitively_and_whole(self):
        self.assertEqual(
            categories_for("0000059726", [], form=SPZOZ.lower()), ["szpitale"]
        )
        self.assertEqual(
            categories_for("0000059726", [], form=SPZOZ + " W LIKWIDACJI"), []
        )

    def test_a_missing_form_never_removes_a_category(self):
        # A payload assembled before formaPrawna was parsed carries None, and a
        # company whose form is unknown must keep what its codes give it.
        self.assertEqual(
            categories_for("0000999999", ["86.10.Z"], form=None), ["szpitale"]
        )

    def test_other_legal_forms_are_not_hospitals(self):
        self.assertEqual(
            categories_for(
                "0000999999", [], form="SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"
            ),
            [],
        )


class TestMainCodeRules(unittest.TestCase):
    """Real companies that moved when the module stopped matching any code."""

    def test_interferie_is_a_spa_hotel_not_a_hospital(self):
        # KRS 0000225570: 86.10 is the fifth of ten codes; the main one is 55.10
        self.assertEqual(
            categories_for(
                "0000225570",
                ["55.10.Z", "55.20.Z", "79.11.A", "79.12.Z", "86.10.Z", "93.13.Z"],
            ),
            [],
        )

    def test_mpec_ostroda_is_a_heat_plant_not_a_water_utility(self):
        # KRS 0000129011: 36.00 is code seven of ten, there is no 37.00, and the
        # main activity is 35.30
        self.assertEqual(
            categories_for(
                "0000129011",
                ["35.30.Z", "42.21.Z", "43.22.Z", "35.22.Z", "68.20.Z", "36.00.Z"],
            ),
            ["cieplownictwo"],
        )

    def test_a_gmina_multi_utility_is_both_heat_and_water(self):
        # KRS 0000008578, ZUK Energokom: heat is its main business and it files
        # the water pair, so it is genuinely both
        self.assertEqual(
            categories_for("0000008578", ["35.30.Z", "36.00.Z", "37.00.Z", "38.11.Z"]),
            ["wodociagi", "cieplownictwo"],
        )

    def test_pkp_plk_still_needs_the_any_code_rule(self):
        # 52.21 is its przewazajaca dzialalnosc and covers roads and bus
        # terminals too, so 42.12 - its second code - is the only handle
        self.assertIn("koleje", categories_for("0000037568", ["52.21.B", "42.12.Z"]))

    def test_a_bus_company_with_a_dead_rail_code_is_not_a_railway(self):
        # KRS 0000076836, PKM Tychy: buses and trolleybuses, and Tychy has no
        # railway. Excluded by hand because 49.10 is matched anywhere.
        result = categories_for("0000076836", ["49.31.Z", "49.39.Z", "49.10.Z"])
        self.assertNotIn("koleje", result)
        self.assertEqual(result, ["komunikacja-miejska"])

    def test_a_tram_operator_is_rail_by_override(self):
        # KRS 0000027173, MPK Wroclaw: runs the tram network and declares only
        # 49.31/49.39, which in the 2007 vintage bundles trams with buses
        self.assertEqual(
            categories_for("0000027173", ["49.31.Z", "49.39.Z"]),
            ["koleje", "komunikacja-miejska"],
        )
