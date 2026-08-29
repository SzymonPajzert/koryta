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

The include list keeps growing rather than being replaced by a cleverer prefix,
and that is not a failure to generalise: 1253 of the 4047 place nodes on the
site declare no PKD at all - every SPZOZ and every entry in the rejestr
stowarzyszen - so for those there is nothing for a prefix to match. An SPZOZ is
reached by its legal form instead (`SZPITALE.forms`); for the rest, naming them
here is the only rule there can be. Matching on the name instead would be
worse than it looks, which is what the `exclude` entries below are for: half a
dozen railway-branded clinics and two cable-car operators would be swept into
`koleje` by any rule that read "kolej" in a name.

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
    """

    value: str
    title: str
    pkd_prefixes: tuple[str, ...] = ()
    pkd_main_prefixes: tuple[str, ...] = ()
    pkd_all_of: tuple[tuple[str, ...], ...] = ()
    forms: tuple[str, ...] = ()
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
            "0000041661",
            "Tauron Ekoserwis",
            "services power-station equipment, PKD 33.14",
        ),
        # Generators and traders. Cooling water is not a water utility.
        Override("0000517891", "Tameh Polska", "an industrial power plant, PKD 35.11"),
        Override("0000881158", "CCGT Ostroleka", "a gas power plant, PKD 35.11"),
        Override("0000719342", "Energa Storage", "grid storage, PKD 35.11"),
        Override("0000109223", "Ekomedia", "distributes electricity, PKD 35.13"),
        Override("0000528715", "PGE Baltica 5", "an offshore wind SPV, PKD 35.14"),
        Override("0000087694", "Zaklad Energoelektryczny Energo-Stil", "PKD 35.14"),
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
            "0000487558",
            "Windykacja Kolejowa",
            "PKD 64.99; PKP Cargo is its sole shareholder in the register",
        ),
        Override(
            "0000499069",
            "Fundacja Grupy PKP",
            "rejestr stowarzyszen, no PKD; its registered purpose is rail "
            "safety and rail heritage",
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
        # The other four the site holds, and the ones a name rule would really
        # cost: all four are SPZOZ entries that declare no PKD at all, so
        # nothing but their name is available to place them and their name says
        # "kolejowy". They reach `szpitale` by their legal form rather than by a
        # code - 86.10 cannot see a company with an empty `activity` - so the
        # exclusion here only keeps a future name rule from taking them for
        # `koleje`.
        Override(
            "0000004917",
            "Kolejowy Szpital Uzdrowiskowy w Naleczowie",
            "an SPZOZ sanatorium, no PKD stored",
        ),
        Override(
            "0000132016",
            "Obwod Lecznictwa Kolejowego w Bielsku-Bialej",
            "an SPZOZ outpatient clinic, no PKD stored",
        ),
        Override(
            "0000046263",
            "SPZOZ Obwod Lecznictwa Kolejowego",
            "an SPZOZ outpatient clinic, no PKD stored",
        ),
        Override(
            "0000031391",
            "SPZOZ Szpital Kolejowy w Wilkowicach",
            "an SPZOZ hospital, no PKD stored",
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
    exclude=(
        Override(
            "0000541901",
            "PGE Energetyka Kolejowa Holding",
            "PKD 64.21; traction power, and already in `koleje`",
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

COMPANY_CATEGORIES: tuple[Category, ...] = (
    SZPITALE,
    PRZYCHODNIE,
    WODOCIAGI,
    CIEPLOWNICTWO,
    ENERGETYKA,
    ODPADY,
    KOLEJE,
    KOMUNIKACJA_MIEJSKA,
    SPORT,
)

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


def categories_for(
    krs: str | None,
    activity: list[str] | None,
    form: str | None = None,
) -> list[str]:
    """Every category a company belongs to, in `COMPANY_CATEGORIES` order.

    An exclusion beats everything, including an inclusion: the two lists are
    written by hand and an entry appearing on both is a mistake, so the safer
    of the two answers wins rather than the order of the checks deciding it.

    `form` is the register's `formaPrawna`. It is optional because a payload
    assembled before the field was parsed does not carry it, and a company whose
    form is unknown should keep the categories its PKD codes give it rather than
    losing them - so a missing `form` narrows the answer, never widens it.

    Returns a list rather than a set so the value is stable from one run to the
    next - it ends up in a Firestore document that a diff is taken against.
    """
    normalized = str(krs).zfill(10) if krs is not None else None
    result = []
    for category in COMPANY_CATEGORIES:
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
    return result
