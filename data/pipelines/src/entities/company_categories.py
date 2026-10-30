"""Which sector a company belongs to, for the category filter on koryta.pl.

The site offers a "Kategoria" filter on /eksploruj that narrows the table to
one sector - hospitals, water utilities, railways. The category is stored on
the place node as `categories` and shipped there by the company ingest
payload, so this module is the one place that decides what a company is.

It used to live in the frontend (`frontend/shared/companyCategories.ts`) and
derive the answer from PKD codes alone, which is not enough for two reasons
that only show up once you look at real companies:

  - **A PKD code is a claim about activity, not about a sector.** 42.12
    (roboty zwiazane z budowa drog szynowych) is the only code that reaches
    PKP PLK, whose declared main activity is the far broader 52.21, but it is
    also carried as a secondary code by road builders, a quarry and a water
    utility. Meanwhile a company can list a rail code because it owns a
    siding: Orlen Aviation and Enea Bioenergia both declare 49.20.
  - **KRS carries two vintages of PKD at once.** The 2025 revision split
    passenger rail out of 49.10 into 49.11 (miedzymiastowy) and 49.12 (miejski
    i podmiejski, taken out of 49.31), so an operator's code depends on when it
    last filed. PKP Szybka Kolej Miejska w Trojmiescie declares only 49.12.

So the mapping is prefix matching *plus* an explicit override list, and both
halves carry their reasoning. The overrides are by KRS number rather than by
name because a name is not unique - 96 company names in the register are
shared by more than one entity.

A category set computed here is a *default*. Once a person edits the
categories of a company on the site, the node records
`categoriesSource: "manual"` and the ingest stops writing over it, the same
contract `isPublic`/`isPublicSource` already has. See
`frontend/server/api/ingest/company.post.ts`.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Override:
    """One company the prefix rules get wrong, and why.

    The reason is not decoration: an override is a standing claim about a
    single company that nobody can re-derive from the data, so the next person
    to look at the list needs to know what it was for.
    """

    krs: str
    name: str
    reason: str

    def __post_init__(self):
        object.__setattr__(self, "krs", str(self.krs).zfill(10))


@dataclass(frozen=True)
class Category:
    """A sector, and the ways a company lands in it.

    There are two PKD axes, because the register offers two different claims and
    they fail in opposite directions.

    `pkd_prefixes` matches against *any* of a company's ten declared codes. It
    reaches a company whose sector is not its headline business: PKP PLK calls
    52.21 (uslugi wspomagajace transport ladowy) its przewazajaca dzialalnosc
    and is reachable only through its second code, 42.12. Broad - and the reason
    `exclude` exists at all, because a quarry that owns a siding declares a rail
    code too.

    `pkd_main_prefixes` matches only the przewazajaca dzialalnosc, the one
    activity the company itself calls its main one. Measured over the 4,024
    companies on the site, the difference between the two is most of the error
    in this module: 35.30 matched anywhere yields 326 companies of which 77% are
    heat suppliers, matched as the main code it yields 176 and every one of them
    is. Division 93 (sport) goes 51% -> 100% the same way, division 35
    (energetyka) 47% -> 99%.

    The main code is `activity[0]`: `parse_activity_from_api_krs` builds the list
    przewazajaca-first by construction, and that holds for 2,580 of the 2,606
    stored nodes carrying both (the 26 that disagree have an `activity` predating
    the 2025 re-filing).

    `pkd_all_of` requires a match in *every* group, each group being a set of
    alternatives. It exists for one shape: a company genuinely in the sector
    without declaring it as its main business, but declaring the sector's whole
    code set. `wodociagi` uses it - a real gmina utility files both 36.00 (water)
    and 37.00 (sewage), where a chemical works with its own intake files one.

    `forms` matches the register's `formaPrawna` and needs no PKD at all. It is
    the only way to reach the 243 SPZOZ hospitals, which sit in the associations
    register and carry no `przedmiotDzialalnosci` for any rule to read.

    A company satisfying any of the four is in the category.

    `wikipedia` is a fifth way in, and a weaker one: categories of the
    company's Polish Wikipedia article, matched as prefixes. It is read only
    for a company none of the four places anywhere - see `categories_for` -
    because a group holding company declares 70.10 and so reaches no sector
    by its codes, while its article files it under the one it is in: that is
    how Energa and PGE Polska Grupa Energetyczna come to be in `energetyka`.
    """

    value: str
    title: str
    pkd_prefixes: tuple[str, ...] = ()
    pkd_main_prefixes: tuple[str, ...] = ()
    pkd_all_of: tuple[tuple[str, ...], ...] = ()
    forms: tuple[str, ...] = ()
    wikipedia: tuple[str, ...] = ()
    include: tuple[Override, ...] = ()
    exclude: tuple[Override, ...] = ()

    @property
    def included_krs(self) -> frozenset[str]:
        return frozenset(o.krs for o in self.include)

    @property
    def excluded_krs(self) -> frozenset[str]:
        return frozenset(o.krs for o in self.exclude)


#: The register's own spelling, diacritics and all - it is compared against
#: `formaPrawna` verbatim, so it cannot be transliterated the way the comments
#: in this file are.
SPZOZ = "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ"

SZPITALE = Category(
    value="szpitale",
    title="Szpitale",
    # 86.10 Dzialalnosc szpitali, as the *main* activity. Matched anywhere it
    # collects 30 more companies that merely list it among ten codes, and they
    # are not hospitals: Interferie (0000225570) and Verano (0000072201) are spa
    # hotels whose main code is 55.10, Tomma (0000631790) is an imaging chain on
    # 86.22, PZU Zdrowie (0000395215) an outpatient network on 86.21.
    pkd_main_prefixes=("86.10",),
    # 243 hospitals on the site are `samodzielny publiczny zaklad opieki
    # zdrowotnej`, which is not a company at all but an entity in the
    # associations register. KRS holds no `przedmiotDzialalnosci` for those - it
    # is not a crawl gap, the section does not exist for RejS - so no PKD rule
    # can ever see them, and before this every one of them sat in no category
    # while carrying `isPublic` and a founding powiat or wojewodztwo.
    forms=(SPZOZ,),
    include=(
        Override(
            "0000066382",
            "Narodowy Instytut Geriatrii, Reumatologii i Rehabilitacji",
            "an instytut badawczy that runs a clinical hospital; its main PKD "
            "is 72.19, research",
        ),
        Override(
            "0000385647",
            "Szpitale Wielkopolski",
            "wholly owned by Wojewodztwo Wielkopolskie; PKD 41.10 because it "
            "builds the hospitals it then holds",
        ),
        Override(
            "0000451215",
            "Moscickie Centrum Medyczne",
            "wholly owned by Gmina Miasta Tarnowa; files 86.21 but runs the "
            "Moscice hospital",
        ),
    ),
)

WODOCIAGI = Category(
    value="wodociagi",
    title="Wodociagi i kanalizacja",
    # 36.00 Pobor, uzdatnianie i dostarczanie wody
    # 37.00 Odprowadzanie i oczyszczanie sciekow
    #
    # Matched anywhere, these two codes made this the biggest category on the
    # site by a factor of four - 674 companies, of which 176 had a main activity
    # somewhere else entirely: 57 heat plants, 49 waste companies, 22 chemical
    # works, both seaport authorities, an airport and a coal mine. They are the
    # two codes every municipal utility and every large industrial plant tacks
    # onto its ten-code list, because everyone draws water and discharges
    # effluent.
    #
    # Main-code-only is too blunt the other way: it drops 47 companies that
    # really are water utilities and merely file something else first, usually a
    # multi-utility gmina company whose headline business is waste or heat.
    #
    # So: the main code, or both codes together. A gmina utility files 36.00 and
    # 37.00 as a pair because supplying water and taking sewage away is one
    # licence; a chemical works with its own intake files one of them.
    pkd_main_prefixes=("36.00", "37.00"),
    pkd_all_of=(("36.00",), ("37.00",)),
    exclude=(
        # Industrial plants big enough to run their own intake and their own
        # effluent works, which is why they file the pair. The multi-utility
        # gmina companies that file it for the same reason are not excluded -
        # a ZGK really is the town's water utility as well as its heat plant.
        Override(
            "0000011737",
            "Grupa Azoty Zaklady Azotowe Pulawy",
            "a nitrogen-fertiliser works, PKD 20.15; the water pair is its own "
            "intake and effluent plant",
        ),
        Override("0000105885", "PCC Rokita", "a chemical works, PKD 20.16"),
        Override(
            "0000119127", "Kemipol", "produces water-treatment chemicals, PKD 20.13"
        ),
        Override("0000146925", "Chemar", "a steel foundry, PKD 24.52"),
        Override(
            "0000109444",
            "Huta Kosciuszko",
            "a steelworks in bankruptcy liquidation, PKD 24.10; the pair is "
            "codes 15 and 16 of its 38",
        ),
        Override(
            "0000069432",
            "Rafineria Nafty Glimar",
            "an oil refinery, PKD 19.20; the pair is codes 16 and 17 of its 36",
        ),
        Override(
            "0000051491",
            "Fabryka Lozysk Tocznych - Krasnik",
            "a bearings works, PKD 28.15",
        ),
        Override("0000033727", "Lerg", "a chemical works, PKD 20.16"),
        Override(
            "0000041661",
            "Tauron Ekoserwis",
            "services power-station equipment, PKD 33.14",
        ),
        Override(
            "0000191663",
            "Ekotar",
            "a waste-recovery company, PKD 38.32, held by Grupa Azoty Prorem, "
            "Grupa Azoty JRCh and two others; the pair is two of its 60 codes",
        ),
        # Generators and traders. Cooling water is not a water utility.
        Override("0000517891", "Tameh Polska", "an industrial power plant, PKD 35.11"),
        Override("0000881158", "CCGT Ostroleka", "a gas power plant, PKD 35.11"),
        Override("0000719342", "Energa Storage", "grid storage, PKD 35.11"),
        Override("0000109223", "Ekomedia", "distributes electricity, PKD 35.13"),
        Override("0000528715", "PGE Baltica 5", "an offshore wind SPV, PKD 35.14"),
        Override("0000087694", "Zaklad Energoelektryczny Energo-Stil", "PKD 35.14"),
        Override(
            "0000973325",
            "ARP Energia",
            "a generator held by Agencja Rozwoju Przemyslu, PKD 35.11",
        ),
        Override("0000520322", "PGE Inwest 12", "a PGE project company, PKD 35.12"),
        Override("0000315512", "ESV Fabryczna", "a generator, PKD 35.11"),
        Override(
            "0001045921",
            "Veolia Mala Kogeneracja Warszawa 1",
            "a small cogeneration plant, PKD 35.11",
        ),
        Override(
            "0000408185",
            "Ekoenergia Silesia",
            "an industrial estate landlord, PKD 68.20",
        ),
        # Estates whose water codes cover the mains inside the fence.
        Override(
            "0000040398",
            "Zarzad Morskiego Portu Gdansk",
            "a port authority, PKD 68.20; the water pair is the port estate's",
        ),
        Override(
            "0000082699", "Zarzad Morskiego Portu Gdynia", "a port authority, PKD 68.20"
        ),
        Override(
            "0000033018",
            "Legnicka Specjalna Strefa Ekonomiczna",
            "an economic-zone operator, PKD 68.10; the water pair is the zone's mains",
        ),
        Override(
            "0000047934",
            "Lubelski Rynek Hurtowy",
            "a wholesale market, PKD 68.20; the water pair is the market estate's",
        ),
        # Neither code is in the register any more; the node's stored activity
        # is stale. Remove this once the ingest refreshes `activity`.
        Override(
            "0000218420",
            "Zespol Zarzadcow Nieruchomosci",
            "PKD 70.20; the register lists neither 36.00 nor 37.00 today",
        ),
        Override("0000128488", "Elewator Sieradz", "a grain elevator, PKD 52.10.B"),
        Override(
            "0000119699",
            "Wielkopolskie Centrum Hodowli i Rozrodu Zwierzat",
            "animal breeding services, PKD 01.62",
        ),
        # Companies that declare most of the classification, so the pair is
        # there beside everything else rather than as a licence.
        Override(
            "0000501687",
            "Vitamedica.eu",
            "a development company in liquidation, PKD 41.10; the pair is two "
            "of its 71 codes",
        ),
        Override(
            "0000065962",
            "Akwawit",
            "PKD 01.11, crop growing; the pair is two of its 296 codes",
        ),
    ),
    include=(
        # The register places these two on 36.00/37.00; the *node* does not,
        # because its stored `activity` is empty. 1,295 nodes are in that state.
        # Both are load-bearing - 0000247533 supplies 3.3 million people - so
        # they are named here rather than left to wait for an ingest refresh.
        Override(
            "0000247533",
            "Gornoslaskie Przedsiebiorstwo Wodociagow",
            "register przewazajaca is 36.00; the node's stored activity is empty",
        ),
        Override(
            "0000082499",
            "Przedsiebiorstwo Gospodarki Wodnej i Rekultywacji",
            "register przewazajaca is 37.00; the node's stored activity is empty",
        ),
        # A network owner rather than an operator: it holds Gdansk's water and
        # sewer mains and leases them, so it files property and pipeline codes
        # and never 36.00 or 37.00.
        Override(
            "0000216612",
            "Gdanska Infrastruktura Wodociagowo-Kanalizacyjna",
            "owns Gdansk's water and sewer network; PKD 68.20 plus 42.21 pipelines",
        ),
    ),
)

KOLEJE = Category(
    value="koleje",
    title="Koleje",
    # Operators, both PKD vintages:
    #   49.10 Transport kolejowy pasazerski miedzymiastowy       (PKD 2007)
    #   49.11 Transport kolejowy pasazerski miedzymiastowy       (PKD 2025)
    #   49.12 Transport kolejowy pasazerski miejski i podmiejski (PKD 2025)
    #   49.20 Transport kolejowy towarow                         (both)
    # Infrastructure and rolling stock:
    #   42.12 Roboty zwiazane z budowa drog szynowych i kolei podziemnej
    #   30.20 Produkcja lokomotyw kolejowych oraz taboru szynowego
    #
    # 49.31 (transport miejski i podmiejski) is left out: in the 2007 vintage
    # it is trams, metro and buses together, and the rail half of it became
    # 49.12 in 2025, which is listed above. 52.21 (uslugi wspomagajace
    # transport ladowy) is left out for the same reason - it also covers roads,
    # parking and bus terminals - and its 2025 A/B split is not a rail/road
    # one: 52.21.B holds a swimming pool, a hospital and an airport alongside
    # PKP PLK. 33.17 (naprawa pozostalego sprzetu transportowego) is where
    # rolling-stock repair sits, but it also holds water utilities and an
    # orthopaedic workshop, so the repair shops are named individually below.
    pkd_prefixes=("49.10", "49.11", "49.12", "49.20", "42.12", "30.20"),
    # Read only for a company nothing else places. 9 site companies on the
    # 2026-08 dump: the rail-freight arms of chemical and fuel groups (Orlen
    # KolTrans, Grupa Azoty Chemkol, Euronaft Trzebinia, DB Schenker Rail
    # Coaltran), PKP companies filed by group as the overrides below are
    # (WARS, Elester, CS Natura Tour, CS Szkolenie i Doradztwo), and H.
    # Cegielski's rolling stock. Betrans and TK Telekom would make eleven and
    # are excluded below: the first already was, and the second left the
    # group its article still files it under.
    wikipedia=(
        "Przewoźnicy kolejowi w Polsce",
        "Zarządcy infrastruktury kolejowej w Polsce",
        "Spółki grupy PKP",
        "Przedsiębiorstwa kolejowe",
        "Producenci taboru kolejowego w Polsce",
    ),
    include=(
        Override(
            "0000019193",
            "Polskie Koleje Panstwowe",
            "the group holding company: PKD says 70.10, firmy centralne",
        ),
        Override("0000042646", "PKP Informatyka", "PKP group IT, PKD 62.01"),
        Override(
            "0000504917",
            "PKP Telkol",
            "PKP group telecoms and rail signalling, PKD 95.10",
        ),
        Override(
            "0000327801",
            "PKP Cargotabor",
            "wagon maintenance for PKP Cargo, PKD 33.17 - too broad to match on",
        ),
        Override(
            "0000091303",
            "PKP Intercity Remtrak",
            "rolling-stock repair for PKP Intercity, PKD 33.17",
        ),
        Override(
            "0000377050",
            "PKP Cargo Terminale",
            "PKP Cargo's intermodal terminals, PKD 52.24",
        ),
        Override(
            "0000014327",
            "PKP Energetyka",
            "no PKD stored at all; traction power for the network",
        ),
        Override(
            "0000849277",
            "PKP Linia Chelmska Szerokotorowa",
            "no PKD stored; a broad-gauge line operator",
        ),
        Override(
            "0000249835",
            "PKP Cargo Wagon-Tarnowskie Gory",
            "no PKD stored; wagon repair",
        ),
        Override(
            "0000496856", "PKP Budownictwo", "no PKD stored; PKP group construction"
        ),
        Override(
            "0000569557",
            "PMT Linie Kolejowe 2",
            "no PKD stored; sibling of PMT Linie Kolejowe, which matches on 49.10",
        ),
        Override(
            "0000031521",
            "Polregio (poprzedni wpis)",
            "no PKD stored; the earlier registration of the regional operator",
        ),
        Override(
            "0000034257", "Cargosped", "no PKD stored; PKP Cargo's forwarding arm"
        ),
        Override(
            "0000953069",
            "PHN Kolejowa",
            "PKD 68.12; holds the PKP group's railway property",
        ),
        Override(
            "0000157565",
            "Kolejowe Zaklady Lacznosci",
            "PKD 27.90; builds rail signalling and communications equipment",
        ),
        Override(
            "0000541901",
            "PGE Energetyka Kolejowa Holding",
            "PKD 64.21; the traction-power group's holding company",
        ),
        Override(
            "0000610778",
            "PGE Energetyka Kolejowa Operator",
            "PKD 35.14; distributes traction power",
        ),
        Override(
            "0000610805",
            "PGE Energetyka Kolejowa Centrum Uslug Wspolnych",
            "PKD 69.20; shared services for the traction-power group",
        ),
        Override(
            "0000152612",
            "Swietokrzyska Kolejka Dojazdowa Ciuchcia Expres Ponidzia",
            "no PKD stored; a narrow-gauge heritage railway",
        ),
        Override(
            "0000628522",
            "Zwiazek Samorzadowych Przewoznikow Kolejowych",
            "no PKD stored; the regional operators' association",
        ),
        Override(
            "0000206663",
            "Grupa Azoty Koltar",
            "the Grupa Azoty group's licensed rail carrier and wagon works at "
            "Tarnow; the node has no stored PKD",
        ),
        # Tram operators. 49.31 in the 2007 vintage bundles trams, metro and
        # buses, so the code cannot tell a tram network from a bus company and
        # the module deliberately leaves it out - which left the categorisation
        # arbitrary: nine tram operators were in `koleje` anyway because they
        # also build track (42.12) or maintain rolling stock (30.20), while
        # these five, which run trams and nothing else rail-coded, were out.
        # Tramwaje Warszawskie and Tramwaje Slaskie need no override: both file
        # 49.12 (pozostaly szynowy transport pasazerski) as their main activity.
        Override(
            "0000027173",
            "MPK Wroclaw",
            "operates the Wroclaw tram network; declares only 49.31 and 49.39",
        ),
        Override(
            "0000025692",
            "MPK Krakow",
            "operates the Krakow tram network; declares only 49.31 and 49.39",
        ),
        Override(
            "0000132903",
            "MZK Grudziadz",
            "operates the Grudziadz tram network",
        ),
        Override(
            "0000125412",
            "MPK Czestochowa",
            "operates the Czestochowa tram line; its register crawl is empty",
        ),
        Override(
            "0000332741",
            "Tramwaj Fordon",
            "the municipal vehicle behind the Fordon tram extension in Bydgoszcz",
        ),
    ),
    exclude=(
        # "Kolejowy" in the name, and nothing to do with running a railway.
        Override("0000312594", "Polskie Koleje Linowe", "cable cars, not rail"),
        Override(
            "0000079964",
            "Polskie Koleje Linowe",
            "cable cars, not rail - a second registration",
        ),
        Override(
            "0000527636",
            "Polskie Koleje Linowe Food",
            "catering at the cable-car stations",
        ),
        # Railway-branded hospitals. They match 86.10 and belong in `szpitale`;
        # the exclusion only stops a future name rule from claiming them.
        Override(
            "0000074422", "Kolejowy Szpital Uzdrowiskowy", "a hospital, PKD 86.10"
        ),
        Override("0000102533", "Okregowy Szpital Kolejowy w Katowicach", "a hospital"),
        Override(
            "0000011133",
            "Obwod Lecznictwa Kolejowego w Gliwicach",
            "an outpatient clinic",
        ),
        # Road, water, mining and aviation companies that carry 42.12 or a
        # freight-rail code because of a siding or a contract, not because
        # railways are what they do.
        Override(
            "0000158240",
            "Instytut Badawczy Drog i Mostow",
            "a roads research institute; 42.12 is one of ten codes",
        ),
        Override(
            "0000027591", "Drogowa Trasa Srednicowa", "builds a motorway; PKD 71.12"
        ),
        Override(
            "0000503225",
            "Poznanskie Inwestycje Miejskie",
            "the city's general investment vehicle, PKD 41.20",
        ),
        Override(
            "0000035770",
            "Przedsiebiorstwo Budownictwa Przemyslowego Chemobudowa",
            "industrial construction, PKD 41.20",
        ),
        Override(
            "0000502907",
            "Zaklad Przerobki Piaskowca Zbylutow",
            "a sandstone quarry, PKD 09.90",
        ),
        Override(
            "0000209019",
            "Wikom - Wodociagi i Oczyszczanie Miasta",
            "a water utility, PKD 36.00; its 42.12 entry carries 42.21's text "
            "(roboty zwiazane z budowa rurociagow), so it is a misfiled pipeline "
            "code rather than a siding",
        ),
        Override(
            "0000128844",
            "Przedsiebiorstwo Uslug Portowych Rezerwa",
            "port services, PKD 81.22",
        ),
        Override(
            "0000384573",
            "Lokalna Agencja Rozwoju Gospodarczego Gminy Suchy Las",
            "a gmina development agency, PKD 70.20",
        ),
        Override(
            "0000794409",
            "Przedsiebiorstwo Gospodarki Mieszkaniowej Inwestycje",
            "municipal housing, PKD 41.10",
        ),
        Override("0000070755", "Poldim-Mosty", "bridge building, PKD 08.11"),
        Override("0000115191", "Huta Pokoj Konstrukcje", "steel structures, PKD 25.11"),
        Override(
            "0000110826",
            "Przedsiebiorstwo Budowy Kopaln Pebeka",
            "mine construction, PKD 43.99",
        ),
        Override(
            "0000171488",
            "Przedsiebiorstwo Drogowo-Mostowe",
            "roads and bridges, PKD 42.11",
        ),
        Override("0000117194", "Przedsiebiorstwo Robot Drogowych", "roads, PKD 42.11"),
        Override(
            "0000073875",
            "Kopalnia Wapienia Czatkowice",
            "a limestone quarry with a siding, PKD 08.11",
        ),
        Override(
            "0000060011",
            "Kopalnia Surowcow Skalnych - Kleczany",
            "a quarry with a siding, PKD 08.11",
        ),
        Override(
            "0000185170",
            "Grupa Azoty Kopalnie i Zaklady Chemiczne Siarki Siarkopol",
            "sulphur mining with a siding, PKD 08.91",
        ),
        Override(
            "0000376459",
            "Enea Bioenergia",
            "biomass, PKD 16.11; the rail code is a siding",
        ),
        Override(
            "0000085139",
            "Dolnoslaskie Zaklady Uslugowo-Produkcyjne Dozamel",
            "an industrial park landlord, PKD 68.20",
        ),
        Override("0000022177", "Orlen Aviation", "aviation fuel, PKD 52.23"),
        Override(
            "0000059625", "Centrala Zbytu Wegla Weglozbyt", "coal trading, PKD 46.81"
        ),
        Override(
            "0000073870",
            "Przedsiebiorstwo Przeladunkowo-Skladowe Port Polnocny",
            "a Gdansk bulk terminal, PKD 52.24.A; the 49.20 is the terminal siding",
        ),
        Override(
            "0000076836",
            "Przedsiebiorstwo Komunikacji Miejskiej w Tychach",
            "buses and trolleybuses, PKD 49.31; Tychy has no railway and the "
            "49.10 is dead boilerplate",
        ),
        Override(
            "0000047612",
            "Slaskie Centrum Logistyki",
            "the Gliwice inland port, PKD 49.41; 49.20 is one of ten codes",
        ),
        Override(
            "0000134150",
            "Betrans",
            "PGE GiEK's road haulier, PKD 49.41; the rail code serves a mine siding",
        ),
        Override(
            "0000024788",
            "TK Telekom",
            "a telecom, Netia's since PKP sold it; its article is still filed "
            "under Spolki grupy PKP",
        ),
    ),
)

CIEPLOWNICTWO = Category(
    value="cieplownictwo",
    title="Cieplownictwo",
    # 35.30 Wytwarzanie i zaopatrywanie w pare wodna, goraca wode i powietrze
    # do ukladow klimatyzacyjnych. The MPEC / PEC / Cieplownia municipal heat
    # plants, one per town.
    #
    # Main-code only. Matched anywhere, 35.30 collects 326 companies and a
    # quarter of them are water utilities and waste companies that also happen
    # to run a boiler house. Unlike division 35's electricity codes, 35.30 means
    # the same thing in both PKD vintages, so there is nothing to disambiguate.
    #
    # 57 of these are also in `wodociagi`, and that is right rather than a
    # collision: a gmina multi-utility supplies heat and water on one licence.
    pkd_main_prefixes=("35.30",),
    # Read only for a company nothing else places: 3 site companies on the
    # 2026-08 dump, all of them combined heat and power plants - EC Nowa, PGE
    # Elektrocieplownia Lublin-Wrotkow, Elektrocieplownia Kielce - which are
    # in `energetyka` by their "Elektrownie" category as well, and are both.
    wikipedia=("Elektrociepłownie", "Ciepłownie"),
)

ENERGETYKA = Category(
    value="energetyka",
    title="Energetyka",
    # Electricity: generation, grid, distribution and trade.
    #
    # The 2025 PKD revision renumbered this group by one and the register holds
    # both vintages at once, so the *number* does not say what a company does:
    # 35.12 reads "przesylanie energii elektrycznej" for 134 filers and
    # "energetyka sloneczna" for 48. Listing 35.11 through 35.16 together sides
    # with the group rather than trying to tell wytwarzanie from przesyl - a
    # split this data cannot support.
    #
    # 35.30 is deliberately absent: heat is `cieplownictwo` above. 35.2x is
    # gas, which is 14 companies and too few to be a filter of its own.
    pkd_main_prefixes=("35.11", "35.12", "35.13", "35.14", "35.15", "35.16"),
    # Read only for a company nothing else places. It is for the two groups:
    # Energa and PGE Polska Grupa Energetyczna declare 70.10, holding company,
    # and reached no sector at all before. Measured over the 2026-08 dump it
    # places 12 site companies, the groups among them with the power stations
    # and the nuclear developer, which declare nothing that places them either.
    # "Przedsiebiorstwa energetyczne" is wider than this category - heat and
    # gas are energy to plwiki and not to this filter - and four of the twelve
    # are excluded below for it.
    wikipedia=(
        "Elektrownie",
        "Energetyka jądrowa w Polsce",
        "Przedsiębiorstwa energetyczne w Polsce",
    ),
    exclude=(
        Override(
            "0000541901",
            "PGE Energetyka Kolejowa Holding",
            "PKD 64.21; traction power, and already in `koleje`",
        ),
        Override(
            "0000071545",
            "Veolia Term",
            "heat supply; plwiki files it as an energy company",
        ),
        Override(
            "0000338294",
            "Przedsiebiorstwo Energetyki Cieplnej",
            "heat supply, owned by PGNiG; plwiki files it as an energy company",
        ),
        Override(
            "0000734483",
            "Duon Dystrybucja",
            "gas distribution; plwiki files it as an energy company",
        ),
        Override(
            "0000651242",
            "ElectroMobility Poland",
            "the Izera electric car; plwiki files it as an energy company",
        ),
    ),
)

ODPADY = Category(
    value="odpady",
    title="Odpady i recykling",
    # 38.1x zbieranie, 38.2x obrobka i usuwanie, 38.3x odzysk
    # 39.00 rekultywacja
    #
    # Main-code only, for the usual reason: 38.11 matched anywhere reaches 490
    # companies because every gmina utility collects bins as a sideline. 49 of
    # the members are also in `wodociagi` - the PGKiM/ZGK companies that really
    # do both.
    #
    # The opis strings under these codes are not stable either: 38.21 reads
    # "obrobka i usuwanie odpadow" for 253 filers and "odzysk surowcow" for 35,
    # and 38.32 splits between "odzysk surowcow" and "skladowanie odpadow". They
    # are all waste, so the group is matched whole.
    pkd_main_prefixes=("38.", "39.0"),
)

KOMUNIKACJA_MIEJSKA = Category(
    value="komunikacja-miejska",
    title="Komunikacja miejska i autobusowa",
    # 49.31 Transport ladowy pasazerski, miejski i podmiejski (PKD 2007) /
    #       Transport drogowy pasazerski rozkladowy (PKD 2025)
    # 49.39 Pozostaly transport ladowy pasazerski
    #
    # The MPK / MZK / PKS companies. Main-code only is not optional here: 49.39
    # matched anywhere adds 47 companies of which 41 are hospitals, sports
    # centres and water utilities that run a staff bus or a patient transport.
    #
    # The tram operators are in `koleje` as well, by override. A company that
    # runs both a tram network and a bus fleet is in both categories, which is
    # what it is.
    pkd_main_prefixes=("49.31", "49.39"),
    # Read only for a company nothing else places, which is also what keeps
    # "Operatorzy publicznego transportu zbiorowego" off the regional
    # railways it covers too: those have their rail code. 4 site companies on
    # the 2026-08 dump - Tramwaje Podmiejskie, two PKS and Lubelskie Dworce,
    # the PKS bus stations.
    wikipedia=(
        "Przedsiębiorstwo Komunikacji Samochodowej",
        "Przewoźnicy KZK GOP",
        "Operatorzy publicznego transportu zbiorowego w ",
        "Komunikacja miejska w ",
    ),
)

SPORT = Category(
    value="sport",
    title="Sport i rekreacja",
    # Division 93: obiekty sportowe (93.11), kluby (93.12), obiekty rekreacyjne.
    # The OSiR / MOSiR municipal sports centres and the gmina-owned football
    # clubs and stadium operators.
    #
    # The clearest case in the module for main-code matching: division 93
    # matched anywhere yields 169 companies of which about half are real, and
    # the other half are water utilities, property managers and hospitals
    # listing "93.13 pozostala dzialalnosc sportowa" as filler. Matched on the
    # main code it yields 96 and every one is a sports or recreation operator.
    pkd_main_prefixes=("93.",),
)

PRZYCHODNIE = Category(
    value="przychodnie",
    title="Przychodnie i opieka ambulatoryjna",
    # Outpatient care, and the reason `szpitale` can stay narrow: a przychodnia,
    # a pogotowie and a dom opieki are not hospitals, and filing them under
    # „Szpitale" is worse than the miss it would fix.
    #
    # 86.10 is absent on purpose - that is `szpitale`. 86.90 covers
    # fizjoterapia, praktyka pielegniarek and pogotowie ratunkowe; 87 and 88 are
    # residential and non-residential social care.
    pkd_main_prefixes=("86.21", "86.22", "86.23", "86.90", "86.92", "87.", "88."),
)

OBRONNOSC = Category(
    value="obronnosc",
    title="Obronnosc",
    # 25.40 Produkcja broni i amunicji
    # 30.40 Produkcja wojskowych pojazdow bojowych
    #
    # Main-code only, and only these two: they are the register's only codes
    # that mean arms and nothing else. They place the arms makers whoever owns
    # them - Mesko, Rosomak, Bumar-Labedy, Dezamet, Wojskowe Zaklady
    # Uzbrojenia, and the private shell and ammunition makers. 30.30 (aircraft)
    # is left out, being the glider and light-aircraft makers as much as any
    # engine works, and so is 84.22 (obrona narodowa): the one company in the
    # 2026-10-20 crawl filing it first is Wojskowy Instytut Medycyny
    # Lotniczej, a research institute.
    pkd_main_prefixes=("25.40", "30.40"),
    # Read only for a company nothing else places. 4 companies in the
    # 2026-10-20 crawl: WB Electronics and Hertz Systems, both private, ZURAD,
    # which plwiki files under PGZ's group, and Osrodek Badawczo-Rozwojowy
    # Sprzetu Mechanicznego. Every other company filed under either is in the
    # list below or reached by its code.
    wikipedia=("Polskie przedsiębiorstwa zbrojeniowe", "Polska Grupa Zbrojeniowa"),
    # The rest of the state's defence companies, named by KRS number as the
    # PKP group is in `koleje`, because no code reaches them. Polska Grupa
    # Zbrojeniowa files 64.20, a holding company, and what it holds - a
    # shipyard, a trader, developers, a fund manager - each files the code of
    # its own trade. Nor can the ownership graph stand in for the list: the
    # register names an S.A.'s shareholders only when there is one, so in the
    # 2026-10-20 crawl it lists 14 companies under PGZ and names no company as
    # a shareholder of Huta Stalowa Wola, Nitro-Chem, PCO, PIT-RADWAR or any
    # of the military works.
    #
    # The list starts from the companies the state-company estimate of
    # 2026-10-11 put in its defence phase (decide-ssp-research-phase-1), and
    # adds three it filed elsewhere: Centrum Techniki Morskiej under research
    # by its PKD 72, and PCO and PIT-RADWAR as private, the register naming
    # none of their owners. A company the group adds later has to be added
    # here.
    #
    # Left out on purpose: the military hospitals and przychodnie, which are
    # `szpitale` and `przychodnie` - the army runs them, but what they do is
    # health care - and the military research institutes, which are not
    # companies and were not in the estimate.
    include=(
        Override(
            "0000489456",
            "Polska Grupa Zbrojeniowa",
            "the group's holding company: PKD 64.20",
        ),
        Override(
            "0000004324",
            "Huta Stalowa Wola",
            "PGZ's; howitzers and tracked carriers, filed under 25.30",
        ),
        Override(
            "0000015446",
            "Jelcz",
            "Huta Stalowa Wola's and PGZ's; the army's trucks, PKD 29.10",
        ),
        Override(
            "0000118542",
            "Grupa MCC",
            "Jelcz's, with a private partner; PKD 45.32",
        ),
        Override(
            "0000006791",
            "Zaklady Chemiczne Nitro-Chem",
            "PGZ's; explosives, PKD 20.51",
        ),
        Override(
            "0000147230",
            "Zaklad Produkcji Specjalnej Gamrat",
            "PGZ's; propellants and pyrotechnics, PKD 20.51",
        ),
        Override(
            "0000026372",
            "Cenzin",
            "PGZ's arms trader, PKD 46.90",
        ),
        Override(
            "0000110327",
            "Rondo",
            "Cenzin's property company, PKD 68.20",
        ),
        Override(
            "0000657652",
            "PGZ Stocznia Wojenna",
            "PGZ's naval shipyard, PKD 30.11",
        ),
        Override(
            "0000300687",
            "Osrodek Badawczo-Rozwojowy Urzadzen Mechanicznych OBRUM",
            "PGZ's armoured-vehicle design bureau, PKD 72.19",
        ),
        Override(
            "0000169830",
            "PCO",
            "in PGZ's group, holds shares in Lucznik and ZM Tarnow; military "
            "optics, PKD 26.51",
        ),
        Override(
            "0000297470",
            "PIT-RADWAR",
            "in PGZ's group, holds shares in ZM Tarnow; military radars, PKD 72.10",
        ),
        Override(
            "0000295769",
            "Osrodek Badawczo-Rozwojowy Centrum Techniki Morskiej",
            "a Treasury company; naval weapons, PKD 72.10",
        ),
        Override(
            "0000099611",
            "Warynski Grupa Holdingowa",
            "PGZ's property company, PKD 68.20",
        ),
        Override(
            "0000475240",
            "Eqlibrium",
            "Warynski's developer company, PKD 41.10",
        ),
        Override(
            "0000712820",
            "Eqlibrium II",
            "Warynski's developer company, PKD 41.10",
        ),
        Override(
            "0000719290",
            "Warynski Atol",
            "Warynski's developer company, PKD 41.10",
        ),
        Override(
            "0000784128",
            "Warynski Atol",
            "the same name's second entry, also Warynski's; PKD 41.10",
        ),
        Override(
            "0000045537",
            "Warynski Trade w likwidacji",
            "Warynski's, in liquidation; PKD 46.63",
        ),
        Override(
            "0000044482",
            "Centrum Bankowo-Finansowe Nowy Swiat",
            "PGZ's office building, PKD 68.20",
        ),
        Override(
            "0000533455",
            "Gryf Nieruchomosci",
            "PGZ's property company, PKD 68.20",
        ),
        Override(
            "0000340312",
            "MS Towarzystwo Funduszy Inwestycyjnych",
            "PGZ's fund manager, PKD 66.30",
        ),
        Override(
            "0000395219",
            "Mars Finance 1",
            "PGZ's financing company, PKD 64.99",
        ),
        Override(
            "0000116560",
            "Stomil-Poznan w likwidacji",
            "PGZ's tyre works, in liquidation; PKD 22.11",
        ),
        Override(
            "0000308183",
            "Osrodek Badawczo-Rozwojowy Przemyslu Oponiarskiego Stomil",
            "Stomil-Poznan's research centre, PKD 72.19",
        ),
        Override(
            "0000235836",
            "Kuznia Labedy w likwidacji",
            "Bumar-Labedy's forge, in liquidation; PKD 25.50",
        ),
        # Polski Holding Obronny is the Treasury's own, beside PGZ rather than
        # under it, and holds a group of its own.
        Override(
            "0000027151",
            "Polski Holding Obronny",
            "the Treasury's defence holding company, PKD 46.69",
        ),
        Override(
            "0000026981",
            "WGT",
            "Polski Holding Obronny's guarding company, PKD 80.01",
        ),
        Override(
            "0000652787",
            "RR Security",
            "Polski Holding Obronny's guarding company, PKD 80.01",
        ),
        Override(
            "0000130996",
            "Agencja Ochrony Osob i Mienia Reflex",
            "Polski Holding Obronny's guarding company, PKD 80.01",
        ),
        Override(
            "0000066424",
            "Fadroma Development",
            "Polski Holding Obronny's, PKD 28.92",
        ),
        Override(
            "0000017328",
            "Huta Gliwice-Osie w likwidacji",
            "Polski Holding Obronny's, in liquidation; PKD 35.20",
        ),
        # The military works and the army's other companies, all the
        # Treasury's. Each files the code of the work it does for the army.
        Override(
            "0000295398",
            "Wojskowe Zaklady Lotnicze nr 1",
            "overhauls the army's helicopters and aircraft, PKD 33.16",
        ),
        Override(
            "0000295719",
            "Wojskowe Zaklady Lotnicze nr 2",
            "overhauls the army's aircraft, PKD 33.16",
        ),
        Override(
            "0000312175",
            "Laboratorium Badan Napedow Lotniczych Polonia Aero",
            "Wojskowe Zaklady Lotnicze nr 2's engine laboratory, PKD 72.19",
        ),
        Override(
            "0000294799",
            "Wojskowe Zaklady Motoryzacyjne",
            "repairs the army's vehicles, PKD 33.11",
        ),
        Override(
            "0000296096",
            "Wojskowe Zaklady Lacznosci nr 1",
            "the army's signals equipment, PKD 27.90",
        ),
        Override(
            "0000296158",
            "Wojskowe Zaklady Elektroniczne",
            "the army's electronics, PKD 27.90",
        ),
        Override(
            "0000303109",
            "Wojskowe Centralne Biuro Konstrukcyjno-Technologiczne",
            "the army's design bureau, PKD 28.99",
        ),
        Override(
            "0000295452",
            "Wojskowe Zaklady Kartograficzne",
            "prints the army's maps, PKD 18.12",
        ),
        Override(
            "0000294679",
            "Wojskowe Przedsiebiorstwo Handlowe",
            "the army's shops, PKD 47.11",
        ),
        Override(
            "0000320810",
            "Warszawskie Zaklady Mechaniczne PZL-WZM",
            "a Treasury engine works, PKD 29.32",
        ),
        Override(
            "0000187449",
            "Diesel Centrum-Polska",
            "PZL-WZM's, PKD 45.31",
        ),
        Override(
            "0000071223",
            "Wytwornia Sprzetu Komunikacyjnego PZL-Kalisz",
            "a state aircraft-engine works plwiki files under PGZ's group; "
            "PKD 30.30, which is left out above",
        ),
        Override(
            "0001187687",
            "Hornet - Polskie Drony",
            "drones, owned by the Instytut Techniczny Wojsk Lotniczych and "
            "Boryszew; PKD 30.32",
        ),
        # Agencja Mienia Wojskowego's companies. The agency holds them for the
        # Treasury and is not in the register itself, so the register names
        # the Treasury and nothing ties them to the army but this list - and
        # the AMW list in `scrapers.krs.data`, which holds Modlin airport too.
        Override(
            "0000394569",
            "AMW Rewita",
            "AMW's hotels and holiday resorts, PKD 55.20",
        ),
        Override(
            "0001204707",
            "Rewita Food Service",
            "AMW Rewita's catering, PKD 56.21",
        ),
        Override(
            "0000392868",
            "AMW Sinevia",
            "AMW's, PKD 42.99",
        ),
        Override(
            "0000003772",
            "AMW Invest",
            "AMW's, PKD 71.11",
        ),
        Override(
            "0000140528",
            "AMW Towarzystwo Budownictwa Spolecznego Kwatera",
            "AMW's housing for soldiers, PKD 68.32",
        ),
    ),
)

SECTORS: tuple[Category, ...] = (
    SZPITALE,
    PRZYCHODNIE,
    WODOCIAGI,
    CIEPLOWNICTWO,
    ENERGETYKA,
    ODPADY,
    KOLEJE,
    KOMUNIKACJA_MIEJSKA,
    SPORT,
    OBRONNOSC,
)

#: Not a sector but an owner: the companies the Treasury holds a stake in,
#: any stake, as Prokuratoria's list names them (`Company.treasury_share`) -
#: the list that makes them public too. Szymon, 2026-10-28: a category to
#: filter by on the site, beside a company's sector rather than in place of
#: one, so it has no rules of its own and `categories_for` adds it after the
#: sectors.
SKARB_PANSTWA = Category("skarb-panstwa", "Skarb Państwa")

COMPANY_CATEGORIES: tuple[Category, ...] = (*SECTORS, SKARB_PANSTWA)

CATEGORY_VALUES: tuple[str, ...] = tuple(c.value for c in COMPANY_CATEGORIES)


def matches_pkd(activity: list[str] | None, prefixes: tuple[str, ...]) -> bool:
    """Whether any declared code starts with any of `prefixes`.

    Prefix matching is directional and that is deliberate: "49.20.Z".startswith
    ("49.20") holds, "49.2.".startswith("49.20") does not. A handful of stored
    codes are truncated to the division ("49..", "42.1."), and those are too
    coarse to place a company - division 49 is every kind of land transport,
    most of it buses - so not matching them is the right answer rather than a
    gap.
    """
    if not activity:
        return False
    return any(code.startswith(prefix) for code in activity for prefix in prefixes)


def matches_main_pkd(activity: list[str] | None, prefixes: tuple[str, ...]) -> bool:
    """Whether the *przewazajaca dzialalnosc* starts with any of `prefixes`.

    `activity[0]` is that code. The register returns it in its own field
    (`przedmiotPrzewazajacejDzialalnosci`) and `parse_activity_from_api_krs`
    puts it first, so position carries the meaning rather than a separate field
    the stored nodes would not have.

    A company whose `activity` is empty has no main code and matches nothing -
    which is 1,295 of the 4,024 nodes on the site, and the reason `forms` and
    the override lists exist.
    """
    if not activity:
        return False
    return any(activity[0].startswith(prefix) for prefix in prefixes)


def matches_all_of(
    activity: list[str] | None, groups: tuple[tuple[str, ...], ...]
) -> bool:
    """Whether every group has at least one match among the declared codes.

    Empty `groups` is False rather than vacuously True: a category that declares
    no such requirement must not collect every company through it.
    """
    if not groups or not activity:
        return False
    return all(matches_pkd(activity, group) for group in groups)


def matches_form(form: str | None, forms: tuple[str, ...]) -> bool:
    """Whether the register's `formaPrawna` is one of `forms`.

    Compared case-insensitively on the whole string, not by prefix: the register
    writes the legal form from a fixed vocabulary, so there is nothing to be
    tolerant about, and a prefix match would put "SPOLKA AKCYJNA" and "SPOLKA
    AKCYJNA W ORGANIZACJI" in one bucket.
    """
    if not form or not forms:
        return False
    normalized = form.strip().upper()
    return any(normalized == f.strip().upper() for f in forms)


def matches_wikipedia(
    wiki_categories: list[str] | None, prefixes: tuple[str, ...]
) -> bool:
    """Whether any of an article's categories starts with any of `prefixes`.

    Prefixes rather than whole names because plwiki splits a category by
    region: "Elektrownie w wojewodztwie slaskim", "Operatorzy publicznego
    transportu zbiorowego w wojewodztwie lodzkim".
    """
    if not wiki_categories or not prefixes:
        return False
    return any(
        category.startswith(prefix)
        for category in wiki_categories
        for prefix in prefixes
    )


def categories_for(
    krs: str | None,
    activity: list[str] | None,
    form: str | None = None,
    wiki_categories: list[str] | None = None,
    treasury: bool = False,
) -> list[str]:
    """Every category a company belongs to, in `COMPANY_CATEGORIES` order.

    An exclusion beats everything, including an inclusion: the two lists are
    written by hand and an entry appearing on both is a mistake, so the safer
    of the two answers wins rather than the order of the checks deciding it.

    `form` is the register's `formaPrawna`. It is optional because a payload
    assembled before the field was parsed does not carry it, and a company whose
    form is unknown should keep the categories its PKD codes give it rather than
    losing them - so a missing `form` narrows the answer, never widens it.

    `wiki_categories` are the categories of the company's Wikipedia article,
    and they are read only when nothing else places the company anywhere. The
    register is what this module trusts; an article is a reader's filing, and
    a broader one - to plwiki a heat plant is an energy company - so it fills a
    gap rather than adding to an answer. On the 2026-08 dump it places 21 of
    the 299 site companies with an article and no sector of their own - 27
    before the six it got wrong were excluded by KRS. The rest were in
    sectors the filter had no category for: arms, chemicals, mining, finance.
    Arms has had one since 2026-10-20, `obronnosc`.

    `treasury` is whether Prokuratoria's list names the company, which files it
    under `SKARB_PANSTWA` as well - after its sectors, and without counting as
    one: taken for a sector, it would keep the Wikipedia fallback from the
    listed companies that declare no sector of their own, PGE Polska Grupa
    Energetyczna among them.

    Returns a list rather than a set so the value is stable from one run to the
    next - it ends up in a Firestore document that a diff is taken against.
    """
    owners = [SKARB_PANSTWA.value] if treasury else []
    normalized = str(krs).zfill(10) if krs is not None else None
    result = []
    for category in SECTORS:
        if normalized is not None and normalized in category.excluded_krs:
            continue
        if normalized is not None and normalized in category.included_krs:
            result.append(category.value)
            continue
        if (
            matches_main_pkd(activity, category.pkd_main_prefixes)
            or matches_pkd(activity, category.pkd_prefixes)
            or matches_all_of(activity, category.pkd_all_of)
            or matches_form(form, category.forms)
        ):
            result.append(category.value)
    if result:
        return result + owners
    return [
        category.value
        for category in SECTORS
        if not (normalized is not None and normalized in category.excluded_krs)
        and matches_wikipedia(wiki_categories, category.wikipedia)
    ] + owners
