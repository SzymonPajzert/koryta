"""Which trade unions are a public company's, by what their names say."""

import gzip

import pandas as pd

from scrapers.krs.labour_unions import (
    SEARCH_LOG,
    Employer,
    EmployerIndex,
    LabourUnions,
    UnionHit,
    attached_unions,
    corporate_group,
    is_labour_union,
    state_owned,
    union_groups,
)
from scrapers.test_tree import MockIO

ENERGETYKA = Employer("0000012900", "ENERGETYKA", "Lubin", national=True)
MPWIK = Employer(
    "0000065204",
    "MIEJSKIE PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI SPÓŁKA Z OGRANICZONĄ "
    "ODPOWIEDZIALNOŚCIĄ W LUBINIE",
    "Lubin",
)
POCZTA = Employer("0000334972", "POCZTA POLSKA", "Warszawa", national=True)
ZOZ = Employer("0000057887", "ZAKŁAD OPIEKI ZDROWOTNEJ", "chełm śląski")
KOLEJE = Employer("0000370981", "KOLEJE ŚLĄSKIE", "Katowice")
PULAWY = Employer(
    "0000011737", 'GRUPA AZOTY ZAKŁADY AZOTOWE "PUŁAWY"', "Puławy", national=True
)
REMASZ = Employer("0000029374", 'KOMPANIJNE ZAKŁADY REMONTOWE "REMASZ"', "Gliwice")
PORT = Employer("0000005185", "PORT GDAŃSKI EKSPLOATACJA", "Gdańsk")


def found(union: str, town: str, *employers: Employer) -> list[tuple[str, str]]:
    index = EmployerIndex(employers, [e.name for e in employers])
    return [(m.employer.krs, m.how) for m in index.employers(union, town)]


def test_a_union_is_known_by_its_form_or_its_name():
    assert is_labour_union("DOZÓR", "ZWIĄZEK ZAWODOWY")
    assert is_labour_union('NSZZ "SOLIDARNOŚĆ" KOMISJA ZAKŁADOWA')
    assert is_labour_union("OGÓLNOPOLSKIE POROZUMIENIE ZWIĄZKÓW ZAWODOWYCH")
    assert not is_labour_union("ZWIĄZEK GMIN JURAJSKICH", "ZWIĄZEK MIĘDZYGMINNY")
    assert not is_labour_union(None, float("nan"))


def test_the_union_names_its_company_in_its_own_town():
    union = (
        'ZWIĄZEK ZAWODOWY PRACOWNIKÓW TECHNICZNYCH I ADMINISTRACJI "DOZÓR" '
        '"ENERGETYKA" SPÓŁKA Z O.O. W LUBINIE'
    )
    assert found(union, "LUBIN", ENERGETYKA) == [(ENERGETYKA.krs, "city")]


def test_a_name_is_found_in_another_case():
    union = (
        "ZWIĄZEK ZAWODOWY PRACOWNIKÓW ZAKŁADU WODOCIĄGÓW I KANALIZACJI PRZY "
        "MIEJSKIM PRZEDSIĘBIORSTWIE WODOCIĄGÓW I KANALIZACJI SPÓŁKA Z "
        "OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ W LUBINIE"
    )
    assert found(union, "LUBIN", MPWIK) == [(MPWIK.krs, "city")]


def test_another_word_with_the_same_start_is_not_the_name():
    assert found("ZWIĄZEK ZAWODOWY KOLEJARZY ŚLĄSKICH", "KATOWICE", KOLEJE) == []


def test_a_state_company_is_found_in_any_town():
    union = "ZWIĄZEK ZAWODOWY PRACOWNIKÓW POCZTY POLSKIEJ W LEGNICY"
    assert found(union, "LEGNICA", POCZTA) == [(POCZTA.krs, "name")]


def test_a_local_company_is_found_only_in_its_own_town():
    union = "ZWIĄZEK ZAWODOWY PRACOWNIKÓW ZAKŁADU OPIEKI ZDROWOTNEJ"
    assert found(union, "NAMYSŁÓW", ZOZ) == []
    assert found(union, "CHEŁM ŚLĄSKI", ZOZ) == [(ZOZ.krs, "city")]


def test_initials_name_a_company_in_its_own_town():
    union = (
        "MIĘDZYZAKŁADOWY ZWIĄZEK ZAWODOWY PRACOWNIKÓW SŁUŻB KOMUNALNYCH PRZY "
        "MPWIK SP. Z O.O. W LUBINIE"
    )
    assert found(union, "LUBIN", MPWIK) == [(MPWIK.krs, "acronym")]
    assert found(union, "GŁOGÓW", MPWIK) == []


def test_three_letters_that_start_a_longer_name_are_not_initials():
    union = "ZWIĄZEK ZAWODOWY PRACOWNIKÓW PGE ENERGIA CIEPŁA Z SIEDZIBĄ W GDAŃSKU"
    assert found(union, "GDAŃSK", PORT) == []


def test_a_union_older_than_its_companys_new_name():
    union = 'MIĘDZYZAKŁADOWY ZWIĄZEK ZAWODOWY PRACOWNIKÓW ZAKŁADÓW AZOTOWYCH "PUŁAWY"'
    assert found(union, "PUŁAWY", PULAWY) == [(PULAWY.krs, "tail")]


def test_a_company_named_by_the_part_of_its_name_in_quotes():
    union = 'ZWIĄZEK ZAWODOWY "KADRA" PRZY "REMASZ" SP. Z O.O. W GLIWICACH'
    assert found(union, "GLIWICE", REMASZ) == [(REMASZ.krs, "brand")]


def test_the_unions_own_name_in_quotes_is_not_a_company():
    kadra = Employer("0000000019", 'BIURO RACHUNKOWE "KADRA"', "Gliwice")
    assert found('ZWIĄZEK ZAWODOWY "KADRA"', "GLIWICE", kadra) == []


def test_an_ending_that_two_companies_share_names_neither():
    first = Employer("0000000027", "ALFA ZAKŁADY MECHANICZNE POLNE", "Kielce")
    second = Employer("0000000035", "BETA ZAKŁADY MECHANICZNE POLNE", "Kielce")
    union = "ZWIĄZEK ZAWODOWY PRACOWNIKÓW ZAKŁADÓW MECHANICZNYCH POLNYCH"
    assert found(union, "KIELCE", first) == [(first.krs, "tail")]
    assert found(union, "KIELCE", first, second) == []


def test_a_hospital_is_not_named_by_its_legal_form():
    hospital = Employer(
        "0000000051",
        "SZPITAL BIELAŃSKI SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        "Warszawa",
    )
    union = (
        "NIEZALEŻNY SAMORZĄDNY ZWIĄZEK ZAWODOWY PRACOWNIKÓW SAMODZIELNEGO "
        "PUBLICZNEGO ZAKŁADU OPIEKI ZDROWOTNEJ"
    )
    assert found(union, "M. ST. WARSZAWA", hospital) == []


def test_the_search_and_the_register_write_a_town_differently():
    azoty = Employer(
        "0000008993", "GRUPA AZOTY ZAKŁADY AZOTOWE KĘDZIERZYN", "Kędzierzyn - Koźle"
    )
    union = 'ZWIĄZEK ZAWODOWY "KADRA" ZAKŁADÓW AZOTOWYCH "KĘDZIERZYN" S.A.'
    assert found(union, "KĘDZIERZYN-KOŹLE", azoty) == [(azoty.krs, "tail")]


# --------------------------------------------------------- the employer's group
PARENTS = {"B": ["A"], "C": ["A"], "D": ["B"], "J": ["A", "X"]}
CHILDREN = {"A": ["B", "C", "J"], "B": ["D"], "X": ["J"]}


def test_the_group_is_the_company_its_owner_and_what_they_own():
    assert corporate_group("B", PARENTS, CHILDREN) == {"A", "B", "C", "D", "J"}


def test_the_group_climbs_one_level_only():
    assert corporate_group("D", PARENTS, CHILDREN) == {"B", "D"}


def test_a_holding_is_not_an_employer():
    assert corporate_group("B", PARENTS, CHILDREN, holdings={"A"}) == {"B", "D"}


def test_a_joint_venture_does_not_join_its_owners():
    assert corporate_group("J", PARENTS, CHILDREN) == {"J"}


def test_the_state_owns_what_its_lists_or_shares_say():
    assert state_owned({"treasury_share": "31.79"})
    assert state_owned({"sources": [{"reason": "SPOLKI_SKARBU_PANSTWA"}]})
    assert state_owned({"sources": [{"reason": "MINISTERSTWO_AKTYWOW_PANSTWOWYCH"}]})
    assert state_owned({"parents": [{"krs": None, "teryt": "SKARB PANSTWA"}]})
    assert not state_owned(
        {
            "treasury_share": float("nan"),
            "sources": [{"reason": "PUBLIC_COMPANIES_KRS"}],
            "parents": [{"krs": None, "teryt": "0211011"}],
        }
    )


# ------------------------------------------------------------- the pipeline
class LogIO(MockIO):
    """A MockIO whose bucket holds `SEARCH_LOG` parts."""

    def __init__(self, *parts: list[UnionHit]):
        super().__init__()
        self.parts = {
            f"part-{i}": gzip.compress(
                "".join(hit.to_line() + "\n" for hit in hits).encode()
            )
            for i, hits in enumerate(parts)
        }
        self.asked: list = []

    def list_files(self, path):
        self.asked.append(path)
        yield from self.parts

    def read_data(self, fs):
        data = self.parts[fs]

        class Part:
            def read_bytes(self):
                return data

        return Part()


DOZOR = "0000049978"
KADRA = "0000429531"
SOLIDARNOSC = "0000059630"
KGHM, INVEST = "0000023302", "0000879452"

COMPANIES = pd.DataFrame(
    [
        {
            "krs": KGHM,
            "name": "KGHM POLSKA MIEDŹ",
            "city": "Lubin",
            "is_public": True,
            "treasury_share": "31.79",
            "parents": [],
            "children": [ENERGETYKA.krs, INVEST],
        },
        {
            "krs": ENERGETYKA.krs,
            "name": "ENERGETYKA",
            "city": "Lubin",
            "is_public": True,
            "parents": [{"krs": KGHM, "teryt": None, "source": None}],
            "children": [],
        },
        {
            "krs": INVEST,
            "name": "INVEST PV 7",
            "city": "Lubin",
            "is_public": True,
            "parents": [{"krs": KGHM, "teryt": None, "source": None}],
            "children": [],
        },
        {
            "krs": KADRA,
            "name": 'ZWIĄZEK ZAWODOWY "KADRA" PRACOWNIKÓW "KATOWICKIEGO WĘGLA"',
            "city": "Katowice",
            "form": "ZWIĄZEK ZAWODOWY",
            "is_public": False,
            "parents": [],
            "children": [],
        },
    ]
)


def union_rows() -> tuple[pd.DataFrame, LogIO]:
    io = LogIO(
        [
            UnionHit(
                DOZOR,
                'ZWIĄZEK ZAWODOWY PRACOWNIKÓW TECHNICZNYCH I ADMINISTRACJI "DOZÓR" '
                '"ENERGETYKA" SPÓŁKA Z O.O. W LUBINIE',
                "LUBIN",
                "2026-11-20",
            ),
            UnionHit(
                SOLIDARNOSC,
                'NIEZALEŻNY SAMORZĄDNY ZWIĄZEK ZAWODOWY "SOLIDARNOŚĆ"',
                "GDAŃSK",
                "2026-11-20",
            ),
        ]
    )
    pipeline = LabourUnions()
    pipeline.companies.read_or_process = lambda ctx: COMPANIES  # type: ignore[method-assign]

    class Ctx:
        pass

    ctx = Ctx()
    ctx.io = io  # type: ignore[attr-defined]
    return pipeline.process(ctx), io  # type: ignore[arg-type]


def test_every_union_is_kept_and_those_of_a_public_company_are_tied_to_it():
    df, io = union_rows()

    assert io.asked == [SEARCH_LOG]
    rows = df.set_index("krs")
    assert set(rows.index) == {DOZOR, SOLIDARNOSC, KADRA}
    assert rows.loc[DOZOR, "employer_krs"] == ENERGETYKA.krs
    assert rows.loc[DOZOR, "source"] == "search"
    assert rows.loc[KADRA, "source"] == "crawl"
    assert pd.isna(rows.loc[SOLIDARNOSC, "employer_krs"])


def test_a_union_belongs_to_its_employers_whole_group():
    df, _ = union_rows()

    assert attached_unions(df) == [DOZOR]
    assert union_groups(df) == {DOZOR: frozenset({KGHM, ENERGETYKA.krs, INVEST})}


def test_no_unions_tie_nobody():
    assert attached_unions(pd.DataFrame()) == []
    assert union_groups(pd.DataFrame()) == {}
