"""What `Companies` writes to companies_merged."""

import pandas as pd
import pytest

from analysis.interesting import Companies
from entities.company import Company as KrsCompany
from entities.company import Owner, Wikipedia, WikiShareholder
from scrapers.map.jst import SKARB_PANSTWA, JstIndex, Unit

ENERGA = "0000271591"
ORLEN = "0000028860"
PKM = "0000371625"


class _Fake:
    """A dependency of `Companies` that answers with what it was given."""

    def __init__(self, rows=(), **attributes):
        self.rows = list(rows)
        self.__dict__.update(attributes)

    def read_or_process_list(self, ctx):
        return self.rows

    def read_or_process(self, ctx):
        return None


def merge(*companies, articles=(), jst=None) -> pd.DataFrame:
    """`Companies.process` over these register entries and Wikipedia articles."""
    pipeline = Companies()
    pipeline.scraped_companies = _Fake(companies)  # type: ignore[assignment]
    pipeline.hardcoded_companies = _Fake()  # type: ignore[assignment]
    pipeline.teryt_pipeline = _Fake(cities_to_teryt={})  # type: ignore[assignment]
    pipeline.jst = _Fake(index=jst)  # type: ignore[assignment]
    pipeline.wiki_companies = lambda ctx: list(articles)  # type: ignore[method-assign]
    return pipeline.process(None)  # type: ignore[arg-type]


def article(title, krs, *shareholders, name=None, categories=()):
    return Wikipedia(
        name=name or title,
        content_score=1,
        krs=krs,
        title=title,
        source=f"https://pl.wikipedia.org/wiki/{title.replace(' ', '_')}",
        shareholders=list(shareholders),
        categories=list(categories),
    )


def row(df: pd.DataFrame, krs: str) -> dict:
    return df[df["krs"] == krs].iloc[0].to_dict()


def test_the_merge_writes_the_companies_in_the_same_order_every_run():
    """Two runs on the same data write the same file, so a diff shows a change.

    The KRS numbers are gathered in a set, which iterates differently every run.
    """
    df = merge(
        *(KrsCompany(krs=krs) for krs in ["0000300000", "0000100000", "0000200000"])
    )

    assert df["krs"].tolist() == ["0000100000", "0000200000", "0000300000"]


@pytest.mark.parametrize("name", ["ZAKSA", "EKSTRAKLASA", "EUROREGION NYSA"])
def test_the_merge_does_not_cut_sa_off_a_name_that_ends_in_it(name):
    """The suffix list this replaced matched "SA" without a word boundary, so
    the site called the volleyball club ZAKSA "ZAK"."""
    df = merge(KrsCompany(krs="0000195237", name=name))

    assert row(df, "0000195237")["name"] == name


def test_a_name_from_an_article_loses_its_form_too():
    # A company the register gave no name is named by its article, which
    # writes the form the way the register never does.
    df = merge(
        KrsCompany(krs=ENERGA),
        articles=[article("Energa", ENERGA, name="Energa S.A.")],
    )

    assert row(df, ENERGA)["name"] == "Energa"


def test_a_company_takes_the_address_and_categories_of_its_own_article():
    df = merge(
        KrsCompany(krs=ENERGA, name="ENERGA SPÓŁKA AKCYJNA"),
        articles=[
            article(
                "Energa",
                ENERGA,
                name="Energa SA",
                categories=["Przedsiębiorstwa energetyczne w Polsce", "Orlen"],
            )
        ],
    )

    energa = row(df, ENERGA)
    assert energa["wikipedia"] == "https://pl.wikipedia.org/wiki/Energa"
    assert list(energa["wiki_categories"]) == [
        "Przedsiębiorstwa energetyczne w Polsce",
        "Orlen",
    ]


def test_an_article_naming_the_company_otherwise_is_not_its_own():
    """A KRS number in an infobox is not always the company's own article.

    Elektrocieplownia Bialystok's gives the number of Enea Cieplo, which runs
    the plant.
    """
    df = merge(
        KrsCompany(krs="0000121456", name="ENEA CIEPŁO"),
        articles=[article("Elektrociepłownia Białystok", "0000121456")],
    )

    operator = row(df, "0000121456")
    assert operator["wikipedia"] is None
    assert list(operator["wiki_categories"]) == []


def test_of_two_articles_giving_one_number_the_company_s_own_wins():
    """A power station's article gives its operator's KRS number."""
    df = merge(
        KrsCompany(krs="0000032334", name="PGE GÓRNICTWO I ENERGETYKA KONWENCJONALNA"),
        articles=[
            article("Elektrownia Bełchatów", "0000032334"),
            article("PGE Górnictwo i Energetyka Konwencjonalna", "0000032334"),
        ],
    )

    assert row(df, "0000032334")["wikipedia"].endswith(
        "PGE_Górnictwo_i_Energetyka_Konwencjonalna"
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_of_two_articles_that_agree_the_one_whose_title_does_wins(reverse):
    """The power station's infobox names its operator, word for word."""
    articles = [
        article(
            "Elektrownia Bełchatów",
            "0000032334",
            name="PGE Górnictwo i Energetyka Konwencjonalna S.A. Oddział Elektrownia"
            " Bełchatów",
        ),
        article("PGE Górnictwo i Energetyka Konwencjonalna", "0000032334"),
    ]
    df = merge(
        KrsCompany(krs="0000032334", name="PGE GÓRNICTWO I ENERGETYKA KONWENCJONALNA"),
        articles=articles[::-1] if reverse else articles,
    )

    assert row(df, "0000032334")["wikipedia"].endswith(
        "PGE_Górnictwo_i_Energetyka_Konwencjonalna"
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_a_tie_goes_the_same_way_whatever_order_the_articles_come_in(reverse):
    articles = [
        article("Śląsk Wrocław (piłka nożna kobiet)", "0000070008"),
        article("Śląsk Wrocław (piłka nożna)", "0000070008"),
    ]
    df = merge(
        KrsCompany(krs="0000070008", name='WROCŁAWSKI KLUB SPORTOWY "ŚLĄSK WROCŁAW"'),
        articles=articles[::-1] if reverse else articles,
    )

    assert row(df, "0000070008")["wikipedia"].endswith("Śląsk_Wrocław_(piłka_nożna)")


def test_the_owners_come_from_the_first_of_its_articles_to_list_any():
    """COIG's article lists none; the one under its old name does."""
    df = merge(
        KrsCompany(krs="0000092497", name="COIG"),
        articles=[
            article(
                "Centralny Ośrodek Informatyki Górnictwa",
                "0000092497",
                WikiShareholder("WASKO SA", None, 85.0),
                WikiShareholder("Skarb Państwa", None, 15.0, skarb_panstwa=True),
                name="COIG S.A.",
            ),
            article("COIG", "0000092497", name="COIG S.A."),
        ],
    )

    coig = row(df, "0000092497")
    assert coig["wikipedia"].endswith("/COIG")
    assert list(coig["parents"]) == [
        {"krs": None, "teryt": SKARB_PANSTWA, "source": "wiki"}
    ]


def test_a_name_inside_the_longer_one_agrees():
    df = merge(
        KrsCompany(
            krs="0000065348",
            name='PRZEDSIĘBIORSTWO PRZEŁADUNKU PALIW PŁYNNYCH "NAFTOPORT"',
        ),
        articles=[article("Naftoport", "65348")],
    )

    assert row(df, "0000065348")["wikipedia"].endswith("/Naftoport")


def test_the_article_owners_stand_in_only_where_the_register_names_none():
    """The register is current where it speaks; the article may not be.

    An SA's shareholders are in the register only when there is one, so
    Energa's 90.92% PKN Orlen is nowhere but the article.
    """
    listed = article(
        "Energa",
        ENERGA,
        WikiShareholder(
            "PKN ORLEN S.A.", "Polski Koncern Naftowy Orlen", 90.92, krs=ORLEN
        ),
        WikiShareholder("mniejszościowi akcjonariusze", None, 9.08),
    )
    register_owner = Owner(krs="0000059307", teryt=None)

    silent = row(
        merge(KrsCompany(krs=ENERGA, name="ENERGA"), articles=[listed]), ENERGA
    )
    speaking = row(
        merge(
            KrsCompany(krs=ENERGA, name="ENERGA", parents=[register_owner]),
            articles=[listed],
        ),
        ENERGA,
    )

    assert list(silent["parents"]) == [{"krs": ORLEN, "teryt": None, "source": "wiki"}]
    assert list(speaking["parents"]) == [
        {"krs": "0000059307", "teryt": None, "source": None}
    ]


def test_the_article_owners_become_the_register_s_kinds_of_owner():
    """A gmina written out in words is found in the TERYT register by name.

    Pomorska Kolej Metropolitalna lists its owners as "94,17% - Urzad
    Marszalkowski Wojewodztwa Pomorskiego" and "5,83% - Gmina Miasta Gdanska",
    neither of them linked: the office is rewritten to the wojewodztwo it
    serves, and the gmina is resolved like a register entry.
    """
    jst = JstIndex(
        [
            Unit("22", "POMORSKIE", "wojewodztwo", None, "22"),
            Unit("2261011", "Gdańsk", "gmina", "1", "22"),
        ]
    )
    df = merge(
        KrsCompany(krs=PKM, name="POMORSKA KOLEJ METROPOLITALNA", teryt_code="2261"),
        articles=[
            article(
                "Pomorska Kolej Metropolitalna",
                PKM,
                WikiShareholder(
                    "Urząd Marszałkowski Województwa Pomorskiego", share=94.17
                ),
                WikiShareholder("Gmina Miasta Gdańska", share=5.83),
                WikiShareholder("Skarb Państwa", skarb_panstwa=True),
                WikiShareholder("Miasto Gdańsk", "Gdańsk", teryt="2261011"),
            )
        ],
        jst=jst,
    )

    owners = [(p["krs"], p["teryt"]) for p in row(df, PKM)["parents"]]
    # Gdansk once: the article lists it twice, in words and as a link.
    assert owners == [(None, "22"), (None, "2261011"), (None, SKARB_PANSTWA)]


def test_nobody_the_site_has_a_node_for_is_no_owner():
    """People, funds and foreign treasuries stay names.

    `JstIndex` reads any name starting "Skarb Panstwa" as the Treasury, and
    plwiki writes Estonia's as "skarb panstwa Estonii" - which is why the
    Treasury is only ever taken from `ProcessWiki`'s stricter reading.
    """
    jst = JstIndex([Unit("2261011", "Gdańsk", "gmina", "1", "22")])
    df = merge(
        KrsCompany(krs="0000000001", name="EESTI ENERGIA"),
        articles=[
            article(
                "Eesti Energia",
                "0000000001",
                WikiShareholder("skarb państwa Estonii"),
                WikiShareholder("Zygmunt Solorz-Żak", "Zygmunt Solorz-Żak", 65.96),
                WikiShareholder("Nationale-Nederlanden OFE", None, 5.4),
            )
        ],
        jst=jst,
    )

    assert list(row(df, "0000000001")["parents"]) == []


def test_a_company_does_not_own_itself():
    df = merge(
        KrsCompany(krs="0000069910", name="EUROPOL GAZ"),
        articles=[
            article(
                "System Gazociągów Tranzytowych „EuRoPol Gaz”",
                "0000069910",
                WikiShareholder("Orlen", "Orlen", 48.0, krs=ORLEN),
                WikiShareholder("EuRoPol Gaz", None, 52.0, krs="0000069910"),
                name="EuRoPol Gaz",
            )
        ],
    )

    assert [p["krs"] for p in row(df, "0000069910")["parents"]] == [ORLEN]


def test_a_company_only_wikipedia_knows_is_not_added():
    """An article lends to a company the register has, and never adds one.

    One known only from an article has no codes and no form, and its payload
    would write an empty category list over whatever the site holds.
    """
    df = merge(
        KrsCompany(krs=ENERGA, name="ENERGA"),
        articles=[article("Energa", ENERGA), article("Orlen", ORLEN)],
    )

    assert df["krs"].tolist() == [ENERGA]


def test_a_public_owner_only_the_article_names_makes_the_company_public():
    """Any stake will do: Szymon's call on 2026-10-07, and the register's rule.

    PKP Cargo's article gives PKP S.A. 33%; COIG's gives the Treasury 15%.
    """
    pkp = KrsCompany(krs="0000019193", name="POLSKIE KOLEJE PAŃSTWOWE", is_public=True)
    df = merge(
        pkp,
        KrsCompany(krs="0000027702", name="PKP CARGO"),
        KrsCompany(krs="0000092497", name="COIG"),
        KrsCompany(krs="0000047612", name="ŚLĄSKIE CENTRUM LOGISTYKI"),
        articles=[
            article(
                "PKP Cargo",
                "0000027702",
                WikiShareholder(
                    "PKP S.A.", "Polskie Koleje Państwowe", 33.0, krs="0000019193"
                ),
                WikiShareholder("podmioty prywatne", None, 67.0),
            ),
            article(
                "COIG",
                "0000092497",
                WikiShareholder("WASKO SA", None, 85.0),
                WikiShareholder("Skarb Państwa", None, 15.0, skarb_panstwa=True),
            ),
            article(
                "Śląskie Centrum Logistyki",
                "0000047612",
                WikiShareholder("Miasto Gliwice", "Gliwice", teryt="2466011"),
            ),
        ],
    )

    assert row(df, "0000027702")["is_public"]
    assert row(df, "0000092497")["is_public"]
    assert row(df, "0000047612")["is_public"]


def test_an_article_naming_only_private_owners_changes_nothing():
    df = merge(
        KrsCompany(krs="0000002000", name="FIRMA"),
        KrsCompany(krs="0000001000", name="WŁAŚCICIEL"),
        articles=[
            article(
                "Firma",
                "0000002000",
                WikiShareholder("Właściciel", "Właściciel", 100.0, krs="0000001000"),
                WikiShareholder("Zygmunt Solorz-Żak", "Zygmunt Solorz-Żak"),
            )
        ],
    )

    assert not row(df, "0000002000")["is_public"]


def test_a_company_an_article_makes_public_makes_what_it_owns_public():
    """Down the register's edges as well as the articles'.

    CompaniesKRS walked the register's edges from its own public companies
    only, so Polimex Mostostal's subsidiaries were left private with it.
    """
    polimex = KrsCompany(
        krs="0000022460", name="POLIMEX MOSTOSTAL", children=["0000000003"]
    )
    df = merge(
        KrsCompany(krs="0000012483", name="ENEA", is_public=True),
        polimex,
        # Owned through its own odpis, and through rejestr.io's list above.
        KrsCompany(
            krs="0000000002",
            name="POLIMEX ENERGETYKA",
            parents=[Owner(krs="0000022460", teryt=None)],
        ),
        KrsCompany(krs="0000000003", name="POLIMEX BUDOWNICTWO"),
        articles=[
            article(
                "Polimex Mostostal",
                "0000022460",
                WikiShareholder("ENEA SA", "Enea", krs="0000012483"),
            )
        ],
    )

    assert row(df, "0000022460")["is_public"]
    assert row(df, "0000000002")["is_public"]
    assert row(df, "0000000003")["is_public"]


def test_an_owner_another_article_made_public_counts():
    """Whichever order the two come in."""
    df = merge(
        KrsCompany(krs="0000000010", name="SPÓŁKA CÓRKA"),
        KrsCompany(krs="0000000020", name="SPÓŁKA MATKA"),
        articles=[
            article(
                "Spółka córka",
                "0000000010",
                WikiShareholder("Spółka matka", "Spółka matka", krs="0000000020"),
            ),
            article(
                "Spółka matka",
                "0000000020",
                WikiShareholder("Skarb Państwa", skarb_panstwa=True),
            ),
        ],
    )

    assert row(df, "0000000020")["is_public"]
    assert row(df, "0000000010")["is_public"]
