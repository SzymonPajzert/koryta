"""Which unit each public body serves, what it is called, and its KRS number.

The three bodies the design names - POWIATOWY URZĄD PRACY ŁÓDŹ-WSCHÓD,
CENTRUM USŁUG SPOŁECZNYCH GMINY REDZIKOWO and Starostwo Powiatowe w Przemyślu -
are the catalogue's own rows of August 2025, and the codes are TERC's. The
other rows are made up after the catalogue's.
"""

import gzip

import pandas as pd

from scrapers.krs.register import (
    RESPONSE_LOG,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    RegisterRead,
)
from scrapers.map.public_bodies import (
    RULE_LAND_POWIAT,
    RULE_NAME,
    RULE_OFFICE,
    RULE_SEAT,
    PublicBodies,
    krs_by_regon,
    public_bodies,
)
from scrapers.stores import Pipeline
from scrapers.tests.mocks import MockIO, get_test_context, setup_test_context

TERC = [
    # WOJ, POW, GMI, RODZ, NAZWA
    ("06", None, None, None, "LUBELSKIE"),
    ("06", "16", None, None, "rycki"),
    ("06", "16", "01", "1", "Dęblin"),
    ("10", None, None, None, "ŁÓDZKIE"),
    ("10", "06", None, None, "łódzki wschodni"),
    ("10", "06", "08", "2", "Nowosolna"),
    ("10", "61", None, None, "Łódź"),
    ("10", "61", "01", "1", "Łódź"),
    ("10", "61", "06", "9", "Łódź-Widzew"),
    ("14", None, None, None, "MAZOWIECKIE"),
    ("14", "65", None, None, "Warszawa"),
    ("14", "65", "01", "1", "Warszawa"),
    ("14", "65", "05", "8", "Mokotów"),
    ("14", "65", "19", "8", "Żoliborz"),
    ("18", None, None, None, "PODKARPACKIE"),
    ("18", "13", None, None, "przemyski"),
    ("18", "13", "08", "2", "Przemyśl"),
    ("18", "62", None, None, "Przemyśl"),
    ("18", "62", "01", "1", "Przemyśl"),
    ("22", None, None, None, "POMORSKIE"),
    ("22", "12", None, None, "słupski"),
    ("22", "12", "08", "2", "Redzikowo"),
    ("22", "15", None, None, "wejherowski"),
    ("22", "15", "03", "1", "Wejherowo"),
    ("22", "15", "10", "2", "Wejherowo"),
    ("22", "63", None, None, "Słupsk"),
    ("22", "63", "01", "1", "Słupsk"),
]

COLUMNS = [
    "Nazwa podmiotu",
    "Status",
    "Kategoria podmiotu",
    "Typ podmiotu",
    "Podtyp podmiotu",
    "REGON",
    "NIP",
    "KRS",
    "Forma prawna",
    "Forma własności",
    "Województwo siedziby",
    "Powiat siedziby",
    "Gmina siedziby",
    "Miasto siedziby",
    "Ulica siedziby",
    "Numer budynku siedziby",
]

POWIAT_UNIT = "430 - POWIATOWE SAMORZĄDOWE JEDNOSTKI ORGANIZACYJNE"
GMINA_UNIT = "429 - GMINNE SAMORZĄDOWE JEDNOSTKI ORGANIZACYJNE"
SPOLKA = "117 - SPÓŁKI Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"
SPOLKA_AKCYJNA = "116 - SPÓŁKI AKCYJNE"
JST_PROPERTY = (
    "113 - WŁASNOŚĆ JEDNOSTEK SAMORZĄDU TERYTORIALNEGO LUB SAMORZĄDOWYCH OSÓB PRAWNYCH"
)
TREASURY = "111 - WŁASNOŚĆ SKARBU PAŃSTWA"


def body(
    name: str,
    kind: str,
    regon: str | None,
    seat: tuple[str, str, str, str],
    *,
    krs: str | None = None,
    form: str | None = GMINA_UNIT,
    ownership: str | None = JST_PROPERTY,
    status: str = "ACTIVE",
    category: str = "PUBLIC",
    subtype: str | None = None,
    street: str = "ul. Testowa",
) -> list[str | None]:
    """A catalogue row; `seat` is województwo, powiat, gmina and town."""
    woj, powiat, gmina, town = seat
    return [
        name,
        status,
        category,
        kind,
        subtype,
        regon,
        "1234563218",
        krs,
        form,
        ownership,
        woj,
        powiat,
        gmina,
        town,
        street,
        "1",
    ]


IN_LODZ = ("ŁÓDZKIE", "Łódź", "Łódź-Widzew", "Łódź")
IN_SLUPSK = ("POMORSKIE", "Słupsk", "Słupsk", "Słupsk")
IN_PRZEMYSL = ("PODKARPACKIE", "Przemyśl", "Przemyśl", "Przemyśl")
IN_WEJHEROWO = ("POMORSKIE", "wejherowski", "Wejherowo", "Wejherowo")
IN_MOKOTOW = ("MAZOWIECKIE", "Warszawa", "Mokotów", "Warszawa")
IN_DEBLIN = ("LUBELSKIE", "rycki", "Dęblin", "Dęblin")

STAROSTWO_PRZEMYSL = body(
    "Starostwo Powiatowe w Przemyślu",
    "starostwa powiatowe",
    "650903256",
    IN_PRZEMYSL,
    form=POWIAT_UNIT,
)
STAROSTWO_LODZ = body(
    "Starostwo Powiatowe w Łodzi",
    "starostwa powiatowe",
    "472057860",
    IN_LODZ,
    form=POWIAT_UNIT,
)
PUP_LODZ_WSCHOD = body(
    "POWIATOWY URZĄD PRACY ŁÓDŹ-WSCHÓD",
    "urzędy pracy",
    "472297833",
    IN_LODZ,
    form=POWIAT_UNIT,
    subtype="powiatowe",
)


def terc() -> pd.DataFrame:
    return pd.DataFrame(TERC, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])


def records(frame: pd.DataFrame) -> list[dict]:
    """The rows, with a missing value as None: a string column holds NaN."""
    return [
        {key: None if pd.isna(value) else value for key, value in row.items()}
        for row in frame.to_dict("records")
    ]


def table(*rows: list[str | None], register: dict[str, str] | None = None):
    """The table for these catalogue rows, by name."""
    catalogue = pd.DataFrame(list(rows), columns=COLUMNS)
    bodies = public_bodies(catalogue, terc(), register)
    return {row["name"]: row for row in records(bodies)}


def served(found: dict, name: str) -> tuple:
    return found[name]["teryt"], found[name]["seat"], found[name]["rule"]


def test_the_powiat_or_gmina_a_name_states_is_the_one_it_serves():
    # Each stands in a city and serves a unit around it, which only its own
    # name says.
    found = table(
        PUP_LODZ_WSCHOD,
        body(
            "CENTRUM USŁUG SPOŁECZNYCH GMINY REDZIKOWO",
            "centra usług społecznych",
            "005310998",
            IN_SLUPSK,
        ),
        body(
            "OŚRODEK POMOCY SPOŁECZNEJ GMINY NOWOSOLNA W ŁODZI",
            "ośrodki pomocy społecznej",
            "472057877",
            IN_LODZ,
        ),
        body(
            "CENTRUM USŁUG WSPÓLNYCH POWIATU SŁUPSKIEGO",
            "jednostki wspólnej obsługi podmiotów",
            "220000002",
            IN_SLUPSK,
            form=POWIAT_UNIT,
        ),
    )

    assert served(found, "Powiatowy Urząd Pracy Łódź-Wschód") == (
        "1006",
        "1061011",
        RULE_NAME,
    )
    assert served(found, "Centrum Usług Społecznych Gminy Redzikowo") == (
        "2212082",
        "2263011",
        RULE_NAME,
    )
    assert served(found, "Ośrodek Pomocy Społecznej Gminy Nowosolna w Łodzi") == (
        "1006082",
        "1061011",
        RULE_NAME,
    )
    assert served(found, "Centrum Usług Wspólnych Powiatu Słupskiego") == (
        "2212",
        "2263011",
        RULE_NAME,
    )


def test_a_powiat_unit_in_a_city_serves_the_land_powiat_run_from_it():
    # Przemyśl has a powiat's offices of its own, and is the seat of powiat
    # przemyski's: the starostwo standing there, as offices.py finds, says
    # which. A unit that names the city is the city's.
    found = table(
        STAROSTWO_PRZEMYSL,
        body(
            "POWIATOWE CENTRUM POMOCY RODZINIE W PRZEMYŚLU",
            "centra pomocy rodzinie",
            "180000006",
            IN_PRZEMYSL,
            form=POWIAT_UNIT,
        ),
        body(
            "POWIATOWY INSPEKTORAT NADZORU BUDOWLANEGO W PRZEMYŚLU",
            "inspektoraty nadzoru budowlanego",
            "180000012",
            IN_PRZEMYSL,
            form=None,
        ),
        body(
            "POWIATOWY INSPEKTORAT NADZORU BUDOWLANEGO DLA MIASTA PRZEMYŚLA",
            "inspektoraty nadzoru budowlanego",
            "180000029",
            IN_PRZEMYSL,
            form=None,
        ),
        body(
            "SZKOŁA PODSTAWOWA NR 5 IM. BOHATERÓW WRZEŚNIA W PRZEMYŚLU",
            "szkoły podstawowe",
            "180000035",
            IN_PRZEMYSL,
        ),
    )

    assert served(found, "Starostwo Powiatowe w Przemyślu") == (
        "1813",
        "1862011",
        RULE_OFFICE,
    )
    assert served(found, "Powiatowe Centrum Pomocy Rodzinie w Przemyślu") == (
        "1813",
        "1862011",
        RULE_LAND_POWIAT,
    )
    assert served(found, "Powiatowy Inspektorat Nadzoru Budowlanego w Przemyślu") == (
        "1813",
        "1862011",
        RULE_LAND_POWIAT,
    )
    assert served(
        found, "Powiatowy Inspektorat Nadzoru Budowlanego dla Miasta Przemyśla"
    ) == ("1862011", "1862011", RULE_NAME)
    assert served(
        found, "Szkoła Podstawowa nr 5 im. Bohaterów Września w Przemyślu"
    ) == ("1862011", "1862011", RULE_SEAT)


def test_beside_its_land_powiat_namesake_a_unit_is_the_citys():
    # Łódź has two powiatowe urzędy pracy: Łódź-Wschód says it is powiat
    # łódzki wschodni's, so the other is the city's.
    found = table(
        STAROSTWO_LODZ,
        PUP_LODZ_WSCHOD,
        body(
            "POWIATOWY URZĄD PRACY W ŁODZI",
            "urzędy pracy",
            "470000003",
            IN_LODZ,
            form=POWIAT_UNIT,
            subtype="powiatowe",
        ),
        body(
            "POWIATOWE CENTRUM POMOCY RODZINIE W ŁODZI",
            "centra pomocy rodzinie",
            "470000010",
            IN_LODZ,
            form=POWIAT_UNIT,
        ),
    )

    assert served(found, "Starostwo Powiatowe w Łodzi") == (
        "1006",
        "1061011",
        RULE_OFFICE,
    )
    assert served(found, "Powiatowy Urząd Pracy w Łodzi") == (
        "1061011",
        "1061011",
        RULE_SEAT,
    )
    assert served(found, "Powiatowe Centrum Pomocy Rodzinie w Łodzi") == (
        "1006",
        "1061011",
        RULE_LAND_POWIAT,
    )


def test_a_gminny_unit_in_a_town_is_the_gmina_wiejska_of_its_name():
    # Wejherowo is a town and the gmina wiejska around it; a school in one of
    # the gmina's villages stands in it, and the gmina's GOPS is in the town.
    # Gmina Przemyśl is in the powiat run from Przemyśl, as its starostwo says.
    found = table(
        STAROSTWO_PRZEMYSL,
        body(
            "GMINNY OŚRODEK POMOCY SPOŁECZNEJ W WEJHEROWIE",
            "ośrodki pomocy społecznej",
            "190000001",
            IN_WEJHEROWO,
        ),
        body(
            "GMINNY OŚRODEK POMOCY SPOŁECZNEJ W PRZEMYŚLU",
            "ośrodki pomocy społecznej",
            "190000018",
            IN_PRZEMYSL,
        ),
        body(
            "SZKOŁA PODSTAWOWA W GOŚCICINIE",
            "szkoły podstawowe",
            "190000024",
            ("POMORSKIE", "wejherowski", "Wejherowo", "Gościcino"),
        ),
        body(
            "MIEJSKI OŚRODEK POMOCY SPOŁECZNEJ W WEJHEROWIE",
            "ośrodki pomocy społecznej",
            "190000030",
            IN_WEJHEROWO,
        ),
    )

    assert served(found, "Gminny Ośrodek Pomocy Społecznej w Wejherowie") == (
        "2215102",
        "2215031",
        RULE_NAME,
    )
    assert served(found, "Gminny Ośrodek Pomocy Społecznej w Przemyślu") == (
        "1813082",
        "1862011",
        RULE_NAME,
    )
    assert served(found, "Szkoła Podstawowa w Gościcinie") == (
        "2215102",
        "2215102",
        RULE_SEAT,
    )
    assert served(found, "Miejski Ośrodek Pomocy Społecznej w Wejherowie") == (
        "2215031",
        "2215031",
        RULE_SEAT,
    )


def test_a_warsaw_unit_serves_the_dzielnica_it_names_and_else_the_city():
    found = table(
        body(
            "OŚRODEK SPORTU I REKREACJI M.ST. WARSZAWY W DZIELNICY ŻOLIBORZ",
            "ośrodki sportu i rekreacji",
            "140000004",
            IN_MOKOTOW,
        ),
        body(
            "URZĄD PRACY MIASTA STOŁECZNEGO WARSZAWY",
            "urzędy pracy",
            "140000010",
            IN_MOKOTOW,
        ),
        body(
            "PRZEDSZKOLE NR 1",
            "przedszkola",
            "140000027",
            IN_MOKOTOW,
        ),
    )

    assert served(
        found, "Ośrodek Sportu i Rekreacji m.st. Warszawy w Dzielnicy Żoliborz"
    ) == ("1465198", "1465058", RULE_NAME)
    assert served(found, "Urząd Pracy Miasta Stołecznego Warszawy") == (
        "1465011",
        "1465058",
        RULE_NAME,
    )
    assert served(found, "Przedszkole nr 1 (Warszawa)") == (
        "1465058",
        "1465058",
        RULE_SEAT,
    )


def test_the_gmina_and_the_powiat_themselves_are_left_out():
    # The urząd employs a wójt, never the gmina; so are entries no longer in
    # the catalogue, private ones, and ones without a REGON.
    found = table(
        body("GMINA REDZIKOWO", "gminy", "770979855", IN_SLUPSK, form=None),
        body(
            "POWIAT SŁUPSKI",
            "jednostki samorządu terytorialnego",
            "770979411",
            IN_SLUPSK,
            form=None,
            subtype="powiaty",
        ),
        body(
            "SZKOŁA PODSTAWOWA NR 2",
            "szkoły podstawowe",
            "220000019",
            IN_SLUPSK,
            status="WITHDRAWN",
        ),
        body(
            "NIEPUBLICZNE PRZEDSZKOLE",
            "przedszkola",
            "220000025",
            IN_SLUPSK,
            category="NON_PUBLIC",
        ),
        body("SZKOŁA PODSTAWOWA NR 3", "szkoły podstawowe", None, IN_SLUPSK),
        body("SZKOŁA PODSTAWOWA NR 4", "szkoły podstawowe", "220000031", IN_SLUPSK),
    )

    assert list(found) == ["Szkoła Podstawowa nr 4 (Słupsk)"]


def test_the_rows_krs_number_is_kept_and_the_register_fills_in_a_missing_one():
    ledger = pd.DataFrame(
        [
            # The register writes a REGON as fourteen digits.
            {"krs": "123456", "status": STATUS_OK, "regon": "22000004800000"},
            {"krs": "1033744", "status": STATUS_OK, "regon": "00350398300000"},
            # Registered twice under one REGON: neither is said.
            {"krs": "0000000111", "status": STATUS_OK, "regon": "220000054"},
            {"krs": "0000000222", "status": STATUS_OK, "regon": "220000054"},
            # Struck off: the register no longer says.
            {"krs": "0000000333", "status": STATUS_STRUCK_OFF, "regon": "220000060"},
        ]
    )
    found = table(
        body(
            "ZAKŁAD GOSPODARKI KOMUNALNEJ SP. Z O.O.",
            "zakłady usług komunalnych",
            "220000048",
            IN_SLUPSK,
            form=SPOLKA,
        ),
        body(
            "SŁUPSKI OŚRODEK SPORTU SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            "ośrodki sportu i rekreacji",
            "003503983",
            IN_SLUPSK,
            krs="0000042676",
            form=SPOLKA,
        ),
        body(
            "WODOCIĄGI SŁUPSK SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            "zakłady wodociągów i kanalizacji",
            "220000054",
            IN_SLUPSK,
            form=SPOLKA,
        ),
        body(
            "ENERGETYKA SŁUPSK SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            "zakłady energii i energetyki cieplnej",
            "220000060",
            IN_SLUPSK,
            form=SPOLKA,
        ),
        register=krs_by_regon(ledger),
    )

    municipal = found["Zakład Gospodarki Komunalnej sp. z o.o. (Słupsk)"]
    assert (municipal["krs"], municipal["legal_form"], municipal["ownership"]) == (
        "0000123456",
        "117",
        "113",
    )
    assert (
        found["Słupski Ośrodek Sportu spółka z ograniczoną odpowiedzialnością"]["krs"]
        == "0000042676"
    )
    assert (
        found["Wodociągi Słupsk spółka z ograniczoną odpowiedzialnością"]["krs"] is None
    )
    assert (
        found["Energetyka Słupsk spółka z ograniczoną odpowiedzialnością"]["krs"]
        is None
    )


def test_a_local_unit_is_part_of_its_parents_company():
    # A local unit's REGON is its parent's nine digits and five of its own; the
    # catalogue gives this branch no KRS number, form or ownership.
    ledger = pd.DataFrame(
        [{"krs": "123456", "status": STATUS_OK, "regon": "22000004800000"}]
    )
    found = table(
        body(
            "WOJSKOWE ZAKŁADY LOTNICZE NR 1 W ŁODZI SPÓŁKA AKCYJNA",
            "przedsiębiorstwa sektora obronnego",
            "000173278",
            IN_LODZ,
            krs="0000295398",
            form=SPOLKA_AKCYJNA,
            ownership=TREASURY,
        ),
        body(
            "WOJSKOWE ZAKŁADY LOTNICZE NR 1 SPÓŁKA AKCYJNA ODDZIAŁ W DĘBLINIE",
            "przedsiębiorstwa sektora obronnego",
            "00017327800020",
            IN_DEBLIN,
            form=None,
            ownership=None,
        ),
        # A branch of a company the catalogue does not list, which the
        # register knows by the parent's REGON.
        body(
            "ZAKŁAD GOSPODARKI KOMUNALNEJ SP. Z O.O. ODDZIAŁ W SŁUPSKU",
            "zakłady usług komunalnych",
            "22000004800013",
            IN_SLUPSK,
            form=None,
            ownership=None,
        ),
        register=krs_by_regon(ledger),
    )

    branch = found["Wojskowe Zakłady Lotnicze nr 1 spółka akcyjna Oddział w Dęblinie"]
    assert (
        branch["krs"],
        branch["legal_form"],
        branch["ownership"],
        branch["teryt"],
    ) == ("0000295398", "116", "111", "0616011")
    other = found["Zakład Gospodarki Komunalnej sp. z o.o. Oddział w Słupsku"]
    assert (other["krs"], other["legal_form"], other["ownership"]) == (
        "0000123456",
        None,
        None,
    )


def test_the_town_goes_after_a_name_that_names_no_place():
    # In any case, by the first word of a longer name, or by an adjective made
    # of it, the town is named already; a gmina the name states is a place.
    found = table(
        body("SZKOŁA PODSTAWOWA NR 1", "szkoły podstawowe", "190000047", IN_WEJHEROWO),
        body(
            "ZESPÓŁ SZKÓŁ NR 2 W WEJHEROWIE",
            "zespoły szkół",
            "190000053",
            IN_WEJHEROWO,
        ),
        body(
            "WEJHEROWSKIE CENTRUM KULTURY",
            "instytucje kultury",
            "190000060",
            IN_WEJHEROWO,
        ),
        body(
            "CENTRUM USŁUG SPOŁECZNYCH GMINY REDZIKOWO",
            "centra usług społecznych",
            "005310998",
            IN_SLUPSK,
        ),
    )

    assert list(found) == [
        "Centrum Usług Społecznych Gminy Redzikowo",
        "Szkoła Podstawowa nr 1 (Wejherowo)",
        "Zespół Szkół nr 2 w Wejherowie",
        "Wejherowskie Centrum Kultury",
    ]


class LogIO(MockIO):
    """A MockIO whose bucket holds one `RESPONSE_LOG` part."""

    def __init__(self, reads: list[RegisterRead]):
        super().__init__()
        self.part = gzip.compress("".join(r.to_line() + "\n" for r in reads).encode())

    def list_files(self, path):
        if path == RESPONSE_LOG:
            yield "part-0"
        else:
            yield from super().list_files(path)

    def read_data(self, fs):
        if fs != "part-0":
            return super().read_data(fs)
        data = self.part

        class Part:
            def read_bytes(self):
                return data

        return Part()


def test_the_pipeline_reads_the_catalogue_terc_and_the_register_log():
    catalogue = pd.DataFrame(
        [
            PUP_LODZ_WSCHOD,
            body(
                "MIEJSKIE PRZEDSIĘBIORSTWO KOMUNALNE SP. Z O.O.",
                "zakłady usług komunalnych",
                "470000027",
                IN_LODZ,
                form=SPOLKA,
            ),
        ],
        columns=COLUMNS,
    )
    terc_csv = "WOJ;POW;GMI;RODZ;NAZWA;NAZWA_DOD\n" + "\n".join(
        ";".join(value or "" for value in row) + ";" for row in TERC
    )
    odpis = {
        "odpis": {
            "naglowekA": {"rejestr": "RejP", "numerKRS": "0000098765"},
            "dane": {
                "dzial1": {
                    "danePodmiotu": {
                        "nazwa": "MIEJSKIE PRZEDSIĘBIORSTWO KOMUNALNE SP. Z O.O.",
                        "identyfikatory": {"regon": "47000002700000"},
                    }
                }
            },
        }
    }
    io = LogIO(
        [
            RegisterRead(
                krs="0000098765",
                read_at="2026-10-01T10:00:00+02:00",
                status=STATUS_OK,
                rejestr="P",
                body=odpis,
            )
        ]
    )
    ctx = get_test_context()
    ctx.io = io
    setup_test_context(
        ctx,
        {
            "dane-o-podmiotach-swiadczacych-usugi-publiczne.csv": catalogue.to_csv(
                sep=";", index=False
            ),
            "teryt_codes.zip": {"TERC_Urzedowy_2025-11-15.csv": terc_csv},
        },
    )
    pipeline: PublicBodies = Pipeline.create(PublicBodies)

    result = pipeline.process(ctx)

    # The REGON keeps its leading zeros, and the company its KRS number.
    assert records(result[["regon", "krs", "teryt"]]) == [
        {"regon": "470000027", "krs": "0000098765", "teryt": "1061011"},
        {"regon": "472297833", "krs": None, "teryt": "1006"},
    ]
