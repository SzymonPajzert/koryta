"""What a government shareholder's name in KRS resolves to.

Every name in these tests is copied verbatim from `dzial1.wspolnicySpzoo` of a
real OdpisAktualny, so they pin the resolver against the register as it actually
reads rather than against a tidied-up version of it. The expected TERYT codes
come from TERC_Urzedowy.
"""

import unittest

import pandas as pd

from scrapers.map.jst import (
    AMBIGUOUS,
    SKARB_PANSTWA,
    JstIndex,
    classify,
    clean,
    normalise,
    stem_key,
)


def index() -> JstIndex:
    """A small TERC-shaped table covering the units these tests name."""
    rows = [
        # WOJ, POW, GMI, RODZ, NAZWA
        ("22", None, None, None, "POMORSKIE"),
        ("12", None, None, None, "MAŁOPOLSKIE"),
        ("22", "61", None, None, "Gdańsk"),
        ("22", "62", None, None, "Gdynia"),
        ("22", "01", None, None, "bytowski"),
        ("28", "12", None, None, "nowomiejski"),
        ("12", "10", None, None, "nowosądecki"),
        ("22", "61", "01", "1", "Gdańsk"),
        ("22", "62", "01", "1", "Gdynia"),
        ("28", "12", "01", "1", "Nowe Miasto Lubawskie"),
        ("28", "12", "02", "2", "Nowe Miasto Lubawskie"),
        ("12", "62", "01", "1", "Nowy Sącz"),
        ("12", "10", "12", "2", "Nawojowa"),
        # A miejska and a wiejska sharing a name, in one powiat
        ("32", "08", "01", "1", "Kołobrzeg"),
        ("32", "08", "02", "2", "Kołobrzeg"),
        ("32", "08", None, None, "kołobrzeski"),
        # ...and in two different powiaty, which nothing can resolve
        ("14", "25", "01", "1", "Siedlce"),
        ("14", "34", "02", "2", "Siedlce"),
        # A miasto na prawach powiatu next to a gmina wiejska of its name
        ("04", "64", None, None, "Włocławek"),
        ("04", "64", "01", "1", "Włocławek"),
        ("04", "18", "13", "2", "Włocławek"),
        ("08", "61", None, None, "Gorzów Wielkopolski"),
        ("08", "61", "01", "1", "Gorzów Wielkopolski"),
    ]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


class TestNormalise(unittest.TestCase):
    def test_diacritics_and_case(self):
        self.assertEqual(normalise("Gdańsk"), "GDANSK")
        self.assertEqual(normalise("Kołobrzeg"), "KOLOBRZEG")
        self.assertEqual(normalise("  Nowy   Sącz "), "NOWY SACZ")


class TestClean(unittest.TestCase):
    def test_the_representative_is_not_part_of_the_name(self):
        self.assertEqual(
            clean("POWIAT BYTOWSKI - REPREZENTOWANY PRZEZ ZARZĄD POWIATU"),
            "POWIAT BYTOWSKI",
        )

    def test_an_address_glued_onto_the_name_is_cut_at_the_first_number(self):
        self.assertEqual(
            clean("GMINA SKARŻYSKO-KAMIENNA SIKORSKIEGO 18 26-110 SKARŻYSKO-KAMIENNA"),
            "GMINA SKARZYSKO-KAMIENNA SIKORSKIEGO",
        )

    def test_the_powiat_status_suffix_goes(self):
        self.assertEqual(
            clean("GMINA MIASTO WŁOCŁAWEK-MIASTO NA PRAWACH POWIATU"),
            "GMINA MIASTO WLOCLAWEK",
        )

    def test_the_register_misspells_prawach(self):
        self.assertEqual(
            clean("MIASTO CHORZÓW - MIASTO NA PRWACH POWIATU"), "MIASTO CHORZOW"
        )


class TestClassify(unittest.TestCase):
    def test_the_prefix_names_the_rodz(self):
        self.assertEqual(classify("GMINA MIEJSKA TCZEW")[1], "1")
        self.assertEqual(classify("GMINA WIEJSKA LUBIN")[1], "2")
        self.assertEqual(classify("MIASTO I GMINA SEROCK")[1], "3")
        # A bare GMINA says nothing about which kind
        self.assertIsNone(classify("GMINA KOŁOBRZEG")[1])

    def test_o_statusie_miejskim_says_miejska_without_a_prefix(self):
        level, rodz, core = classify("GMINA ŻAGAŃ O STATUSIE MIEJSKIM")
        self.assertEqual((level, rodz, core), ("gmina", "1", "ZAGAN"))

    def test_levels(self):
        self.assertEqual(classify("WOJEWÓDZTWO POMORSKIE")[0], "wojewodztwo")
        self.assertEqual(classify("POWIAT SANOCKI")[0], "powiat")
        self.assertEqual(classify("MIASTO KIELCE")[0], "gmina")

    def test_a_locative_after_the_prefix(self):
        self.assertEqual(classify("GMINA MIEJSKA W OŁAWIE")[2], "OLAWIE")

    def test_a_company_is_not_a_jst(self):
        level, _, _ = classify("POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA")
        self.assertIsNone(level)

    def test_the_powiat_status_after_the_town_says_gmina_miejska(self):
        # MPEC Wloclawek, KRS 0000048441, and "BAZA", the city's other company
        self.assertEqual(
            classify("WŁOCŁAWEK - MIASTO NA PRAWACH POWIATU"),
            ("gmina", "1", "WLOCLAWEK"),
        )
        # CPK Czestochowa, KRS 0000051670 - no spaces round the hyphen
        self.assertEqual(
            classify("CZĘSTOCHOWA-MIASTO NA PRAWACH POWIATU"),
            ("gmina", "1", "CZESTOCHOWA"),
        )

    def test_the_powiat_status_can_come_first(self):
        # CSR Slowianka, KRS 0000051160
        self.assertEqual(
            classify("MIASTO NA PRAWACH POWIATU GORZÓW WIELKOPOLSKI"),
            ("gmina", "1", "GORZOW WIELKOPOLSKI"),
        )

    def test_skarb_panstwa_is_recognised_but_has_no_level(self):
        level, _, core = classify("SKARB PAŃSTWA")
        self.assertIsNone(level)
        self.assertEqual(core, SKARB_PANSTWA)


class TestStemKey(unittest.TestCase):
    def test_a_genitive_and_its_nominative_agree(self):
        self.assertEqual(
            stem_key("NOWEGO MIASTA LUBAWSKIEGO"), stem_key("NOWE MIASTO LUBAWSKIE")
        )

    def test_a_nominative_ending_in_ow_is_not_over_stemmed(self):
        # KRAKOW must not lose "OW", or it stops agreeing with KRAKOWA
        self.assertEqual(stem_key("KRAKOWA"), stem_key("KRAKOW"))


class TestResolve(unittest.TestCase):
    def setUp(self):
        self.index = index()

    def test_wojewodztwo(self):
        self.assertEqual(self.index.resolve("WOJEWÓDZTWO POMORSKIE"), "22")

    def test_powiat_with_a_representative_appended(self):
        self.assertEqual(
            self.index.resolve("POWIAT BYTOWSKI - REPREZENTOWANY PRZEZ ZARZĄD POWIATU"),
            "2201",
        )

    def test_the_owner_is_not_the_seat(self):
        # The bug this module exists to undo: Gmina Miasta Gdansk holds 10.7% of
        # PKP SKM, which is seated in Gdynia. The old code answered Gdynia.
        self.assertEqual(self.index.resolve("GMINA MIASTA GDAŃSK", "22"), "2261011")

    def test_a_genitive_gmina_name(self):
        self.assertEqual(
            self.index.resolve("GMINA MIASTA NOWEGO MIASTA LUBAWSKIEGO"), "2812011"
        )

    def test_co_owners_stay_distinct(self):
        # Sadeckie Wodociagi: four owner gminas that used to collapse onto one
        resolved = {
            self.index.resolve(name, "12")
            for name in ("GMINA NOWY SĄCZ", "GMINA NAWOJOWA")
        }
        self.assertEqual(resolved, {"1262011", "1210122"})

    def test_a_bare_gmina_name_shared_in_one_powiat_rounds_to_it(self):
        # A miejska and a wiejska called Kolobrzeg, both in powiat kolobrzeski.
        # Naming the powiat says less than the register did but nothing false.
        self.assertEqual(self.index.resolve("GMINA KOŁOBRZEG"), "3208")

    def test_a_bare_gmina_name_shared_across_powiaty_is_ambiguous(self):
        self.assertEqual(self.index.resolve("GMINA SIEDLCE"), AMBIGUOUS)

    def test_the_rodz_from_the_prefix_breaks_the_tie(self):
        self.assertEqual(self.index.resolve("GMINA MIEJSKA KOŁOBRZEG"), "3208011")
        self.assertEqual(self.index.resolve("GMINA WIEJSKA KOŁOBRZEG"), "3208022")

    def test_skarb_panstwa_never_gets_a_teryt_code(self):
        # Giving the Treasury a code would put it in the running for a company's
        # seat, which is a territory and it is not one.
        self.assertEqual(self.index.resolve("SKARB PAŃSTWA"), SKARB_PANSTWA)

    def test_a_miasto_na_prawach_powiatu_is_the_town_not_the_villages(self):
        # Wloclawek is also a gmina wiejska in powiat wloclawski, which is a
        # different owner altogether.
        self.assertEqual(
            self.index.resolve("WŁOCŁAWEK - MIASTO NA PRAWACH POWIATU"), "0464011"
        )
        self.assertEqual(
            self.index.resolve("MIASTO NA PRAWACH POWIATU GORZÓW WIELKOPOLSKI"),
            "0861011",
        )

    def test_a_company_shareholder_resolves_to_nothing(self):
        self.assertIsNone(self.index.resolve("POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA"))

    def test_fuzzy_matching_needs_a_wojewodztwo_to_search_in(self):
        # Unrestricted, a fuzzy match over 2,479 gmina names finds a plausible
        # wrong answer for almost anything, so there is no fuzzy pass without one
        self.assertIsNone(self.index.resolve("GMINA NAWOJOWWA"))
        self.assertEqual(self.index.resolve("GMINA NAWOJOWWA", "12"), "1210122")


if __name__ == "__main__":
    unittest.main()
