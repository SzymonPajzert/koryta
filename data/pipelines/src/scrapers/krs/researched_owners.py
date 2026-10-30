"""Public owners nothing the pipeline reads can name, found by hand.

KRS names the shareholders of a spółka akcyjna only when there is exactly one,
so an SA held by Poczta Polska and Asseco, or by a city and its voivodeship,
reads as owned by nobody, and REGON's code covers few of them; nor does it
name a shareholder under 10% of a spółka z o.o. Each company here was found by
`CompaniesLikelyPublic` - several people on the site worked there, all of them
scored as koryciarz - or, for SIM "KZN-Wielkopolska", by the BIP NIP list, or
for Wodociągi i Kanalizacja-Zgierz by Szymon asking about it, or for PCO,
PIT-RADWAR and Dezamet by the defence sector (`obronnosc`), or for Energa
Elektrownie Ostrołęka by a reader's note that its owner was missing - and its
owners were then read off a source that says so, given beside it: the
company's own shareholder page, its parent's group page, a stock-exchange
disclosure, a voivodeship's or city's own page, the press where nothing better
exists.

Owners are written the way an odpis writes them, so that `CompaniesKRS` treats
them like one: a company by its KRS number becomes an ownership edge, which
also carries the flag down to whatever it owns in turn (Grupa CZH's terminals,
PZU Zdrowie's clinics, the KOWR breeding farms' Green Lab), and a gmina,
powiat, województwo or the Treasury is resolved by name with `JstIndex`.
A public body with neither (KOWR, KZN, PARP) is named for the record only.

Every company here is public by the site's rule - any public stake, minority
included - so `CompaniesKRS` marks it public whatever the owners resolve to.
Checked 2026-10-09, the three defence companies 2026-10-20, Energa
Elektrownie Ostrołęka 2026-10-30; a sale changes it, so a source older than a
year or two is worth reading again before a page quotes it.
"""

import dataclasses


@dataclasses.dataclass(frozen=True)
class ResearchedOwner:
    #: As an odpis would write it - the name a gmina or the Treasury is resolved
    #: by, and the record of who a company is.
    name: str
    krs: str | None = None
    share: str | None = None


@dataclasses.dataclass(frozen=True)
class Researched:
    owners: tuple[ResearchedOwner, ...]
    source: str


@dataclasses.dataclass(frozen=True)
class FundHolder:
    """Who stands behind an owner the register names without a KRS number."""

    fund: str
    holder: ResearchedOwner
    source: str


ARP = ResearchedOwner("AGENCJA ROZWOJU PRZEMYSŁU S.A.", "0000037957")
PFR = ResearchedOwner("POLSKI FUNDUSZ ROZWOJU S.A.", "0000466256")
PGZ = ResearchedOwner("POLSKA GRUPA ZBROJENIOWA S.A.", "0000489456")
GRUPA_AZOTY = ResearchedOwner("GRUPA AZOTY S.A.", "0000075450")

RESEARCHED_OWNERS: dict[str, Researched] = {
    # POSTDATA S.A. (Bydgoszcz), Poczta Polska's IT company.
    "0000117218": Researched(
        (
            ResearchedOwner("POCZTA POLSKA S.A.", "0000334972", "51%"),
            ResearchedOwner("ASSECO POLAND S.A.", "0000033391", "49%"),
        ),
        "https://www.poczta-polska.pl/o-firmie/grupa-pp/postdata-s-a/",
    ),
    # PZU ZDROWIE S.A.: PZU's own 80% plus PZU Życie's 20%. Its clinics
    # (Elvita Jaworzno III, Centrum Medyczne Medica Płock) follow it.
    "0000395215": Researched(
        (
            ResearchedOwner("POWSZECHNY ZAKŁAD UBEZPIECZEŃ S.A.", "0000009831", "80%"),
            ResearchedOwner(
                "POWSZECHNY ZAKŁAD UBEZPIECZEŃ NA ŻYCIE S.A.", "0000030211", "20%"
            ),
        ),
        "https://www.pzu.pl/grupa-pzu/o-nas/struktura-grupy",
    ),
    # GRUPA CZH S.A. (formerly Centrala Zaopatrzenia Hutnictwa). Its terminals
    # at Sławków and the Obroki wholesale market follow it.
    "0000075706": Researched(
        (
            dataclasses.replace(ARP, share="76%"),
            ResearchedOwner("SKARB PAŃSTWA", share="11%"),
        ),
        "https://czh.pl/o-firmie/historia/",
    ),
    # FUNDUSZ TRANSFORMACJI WOJEWÓDZTWA ŚLĄSKIEGO S.A.
    "0001055483": Researched(
        (
            ResearchedOwner("SKARB PAŃSTWA", share="99.85%"),
            dataclasses.replace(ARP, share="0.15%"),
        ),
        "https://ftws.pl/o-nas/akcjonariusze/",
    ),
    # PORT LOTNICZY LUBLIN S.A.
    "0000092480": Researched(
        (
            ResearchedOwner("GMINA LUBLIN", share="51.5%"),
            ResearchedOwner("WOJEWÓDZTWO LUBELSKIE", share="46.8%"),
            ResearchedOwner("GMINA MIEJSKA ŚWIDNIK", share="1.7%"),
            ResearchedOwner("POWIAT ŚWIDNICKI"),
        ),
        "https://www.lubelskie.pl/aktualnosci/unijna-dotacja-nie-odleci-z-lubelskiego-lotniska/",
    ),
    # PORT LOTNICZY WROCŁAW S.A.
    "0000086071": Researched(
        (
            ResearchedOwner("GMINA WROCŁAW", share="49.15%"),
            ResearchedOwner("WOJEWÓDZTWO DOLNOŚLĄSKIE", share="31.11%"),
            # The state enterprise, struck off since it became this company.
            ResearchedOwner("POLSKIE PORTY LOTNICZE S.A.", "0001025154", "19.74%"),
        ),
        "https://airport.wroclaw.pl/en/about-company/",
    ),
    # GÓRNOŚLĄSKIE TOWARZYSTWO LOTNICZE S.A., Katowice Airport, after the
    # voivodeship and the city bought out Węglokoks in 2025.
    "0000023650": Researched(
        (
            ResearchedOwner("WOJEWÓDZTWO ŚLĄSKIE", share="61.2%"),
            ResearchedOwner("MIASTO KATOWICE", share="21.0%"),
            ResearchedOwner("POLSKIE PORTY LOTNICZE S.A.", "0001025154", "17.3%"),
        ),
        "https://sfpp.org.pl/2025/11/24/wojewodztwo-slaskie-i-katowice-przejmuja-wiekszosciowe-udzialy-w-lotnisku-pyrzowice/",
    ),
    # TS PODBESKIDZIE S.A.
    "0000390966": Researched(
        (ResearchedOwner("GMINA BIELSKO-BIAŁA", share="65%"),),
        "https://tomygorale.pl/wladze-podbeskidzia-prezes-wlasciciel-to-my-gorale/",
    ),
    # WKS ŚLĄSK WROCŁAW S.A., bought back by the city.
    "0000070008": Researched(
        (ResearchedOwner("GMINA WROCŁAW", share="99.11%"),),
        "https://www.radiowroclaw.pl/articles/view/53180/Miasto-ponownie-kontroluje-Slask-Wroclaw-Jest-nowy-udzialowiec",
    ),
    # ZAKSA S.A., the volleyball club (on the site as "ZAK").
    "0000195237": Researched(
        (
            ResearchedOwner(
                "GRUPA AZOTY ZAKŁADY AZOTOWE KĘDZIERZYN S.A.", "0000008993", "91.67%"
            ),
        ),
        "https://zaksa.pl/poznaj-mnie-lepiej-grupa-azoty-zaklady-azotowe-kedzierzyn-s-a/",
    ),
    # GRUPA AZOTY ZAKŁADY AZOTOWE KĘDZIERZYN S.A.
    "0000008993": Researched(
        (dataclasses.replace(GRUPA_AZOTY, share="93.48%"),),
        "https://zak.grupaazoty.com/spolka/akcjonariat",
    ),
    # GRUPA AZOTY POLYOLEFINS S.A. (Police), as of its 2021-22 capital increase.
    "0000577195": Researched(
        (
            ResearchedOwner(
                'GRUPA AZOTY ZAKŁADY CHEMICZNE "POLICE" S.A.', "0000015501", "34.41%"
            ),
            dataclasses.replace(GRUPA_AZOTY, share="30.52%"),
            ResearchedOwner("ORLEN S.A.", "0000028860", "17.3%"),
        ),
        "https://www.money.pl/gielda/zch-police-obejma-akcje-grupy-azoty-polyolefins-za-334-97-mln-zl-6512920674834049a.html",
    ),
    # FABRYKA KOTŁÓW "SEFAKO" S.A.
    "0000029367": Researched(
        (
            ResearchedOwner(
                'TOWARZYSTWO FINANSOWE "SILESIA" SP. Z O.O.', "0000002710", "95.97%"
            ),
        ),
        "https://sedziszow.pl/aktualnosci/fabryka-kotlow-sefako-s-a-ma-nowego-wlasciciela/",
    ),
    # TRAKCJA S.A., taken over by PKP PLK in 2022-24.
    "0000084266": Researched(
        (
            ResearchedOwner("PKP POLSKIE LINIE KOLEJOWE S.A.", "0000037568", "88.39%"),
            dataclasses.replace(ARP, share="5.57%"),
        ),
        "https://www.plk-sa.pl/o-spolce/biuro-prasowe/informacje-prasowe/szczegoly/plk-podpisaly-umowe-objecia-akcji-firmy-trakcja-sa-7222",
    ),
    # TORPOL S.A.: CPK bought TF Silesia's 38%.
    "0000407013": Researched(
        (
            ResearchedOwner(
                "CENTRALNY PORT KOMUNIKACYJNY SP. Z O.O.", "0000759991", "38%"
            ),
        ),
        "https://www.biznesradar.pl/a/115053,cpk-zawarl-przedwstepna-umowe-kupna-38-akcji-torpolu",
    ),
    # WARYŃSKI S.A. GRUPA HOLDINGOWA, through PGZ's MARS FIZ.
    "0000099611": Researched(
        (dataclasses.replace(PGZ, share=">90%"),),
        "https://www.warynski.pl/o-nas/akcjonariusze/",
    ),
    # CENTRUM BANKOWO-FINANSOWE "NOWY ŚWIAT" S.A., PGZ's since 2022.
    "0000044482": Researched(
        (dataclasses.replace(PGZ, share="90%"),),
        "https://pl.wikipedia.org/wiki/Centrum_Bankowo-Finansowe_%E2%80%9ENowy_%C5%9Awiat%E2%80%9D",
    ),
    # CENTRUM GIEŁDOWE S.A.
    "0000035062": Researched(
        (
            ResearchedOwner(
                'CENTRUM BANKOWO-FINANSOWE "NOWY ŚWIAT" S.A.', "0000044482", "59.49%"
            ),
            ResearchedOwner(
                "GIEŁDA PAPIERÓW WARTOŚCIOWYCH W WARSZAWIE S.A.", "0000082312", "24.79%"
            ),
            ResearchedOwner(
                "KRAJOWY DEPOZYT PAPIERÓW WARTOŚCIOWYCH S.A.", "0000081582", "15.72%"
            ),
        ),
        "https://pl.wikipedia.org/wiki/Centrum_Gie%C5%82dowe",
    ),
    # PCO S.A., military optics: PGZ's, the rest its employees'. Its own
    # companies (Łucznik, Zakłady Mechaniczne "Tarnów") follow it.
    "0000169830": Researched(
        (dataclasses.replace(PGZ, share="91.48%"),),
        "https://pcosa.com.pl/pl/dla-akcjonariuszy",
    ),
    # PIT-RADWAR S.A., military radars. Its page says it belongs to PGZ and
    # gives no share.
    "0000297470": Researched(
        (PGZ,),
        "https://www.pitradwar.com/o-firmie",
    ),
    # ZAKŁADY METALOWE "DEZAMET" S.A., artillery ammunition.
    "0000044261": Researched(
        (
            dataclasses.replace(PGZ, share="45.99%"),
            ResearchedOwner("MESKO S.A.", "0000041811", "39.94%"),
        ),
        "https://dezamet.com.pl/dla-akcjonariuszy-2/struktura-wlasnosciowa",
    ),
    # ZAKŁADY MECHANICZNE "TARNÓW" S.A., in the PGZ group.
    "0000036320": Researched(
        (
            ResearchedOwner("PCO S.A.", "0000169830", "66.6%"),
            ResearchedOwner("PIT-RADWAR S.A.", "0000297470", "23.08%"),
            ResearchedOwner("POLSKI HOLDING OBRONNY SP. Z O.O.", "0000027151", "3.17%"),
        ),
        "https://zmt.tarnow.pl/pl/o-firmie/dla-akcjonariuszy/akcjonariat",
    ),
    # PRZEDSIĘBIORSTWO ZBOŻOWO-MŁYNARSKIE "PZZ" W STOISŁAWIU S.A.: the Treasury
    # left the register in 2013 by selling 70% to Krajowa Spółka Cukrowa.
    "0000306013": Researched(
        (ResearchedOwner("KRAJOWA GRUPA SPOŻYWCZA S.A.", "0000084678", "70%"),),
        "https://ekoszalin.pl/artykul/3240-Prywatyzacja-PZZ-Stoislaw",
    ),
    # TOWARZYSTWO BUDOWNICTWA SPOŁECZNEGO "KRAK-SYSTEM" S.A.
    "0000080611": Researched(
        (
            ResearchedOwner('PBP "CHEMOBUDOWA - KRAKÓW" S.A.', "0000035770", "83.0%"),
            ResearchedOwner("GMINA MIEJSKA KRAKÓW", share="17.0%"),
        ),
        "https://krak-system.com.pl/o-spolce/akcjonariat/",
    ),
    # ENERGOMONTAŻ-PÓŁNOC GDYNIA S.A., in ARP's Grupa Przemysłowa Baltic.
    "0000563117": Researched(
        (ARP,),
        "https://www.money.pl/gielda/arp-zlozyla-w-uokik-wniosek-ws-przejecia-spolki-energomontaz-polnoc-gdynia-6369141489366657a.html",
    ),
    # TRANSGAZ S.A. (Zalesie): PKP Cargo Connect appoints three of the five
    # supervisory board members; the split of the shares is not published.
    "0000061159": Researched(
        (ResearchedOwner("PKP CARGO CONNECT SP. Z O.O.", "0000006291"),),
        "https://wydarzenia.interia.pl/kraj/news-skad-gaz-bierze-polski-gaz-i-kto-teraz-rzadzi-w-transgazie,nId,7898680",
    ),
    # PRZEDSIĘBIORSTWO USŁUG KOMUNALNYCH S.A. (Kalisz): the city's minority,
    # the rest its staff.
    "0000130027": Researched(
        (ResearchedOwner("MIASTO KALISZ", share="39.84%"),),
        "https://www.faktykaliskie.info/artykul/58565,mieszkania-autobusy-i-piekarnia-przeglad-kaliskich-spolek",
    ),
    # ELEKTROCIEPŁOWNIA BIAŁYSTOK S.A., merged into Enea Wytwarzanie in 2014.
    "0000023369": Researched(
        (ResearchedOwner("ENEA WYTWARZANIE S.A.", "0000060541", "100%"),),
        "https://ir.enea.pl/pr/291347/polaczenie-enea-wytwarzanie-s-a-z-elektrocieplownia-bialystok-s-a-elektrowniami-wodnymi-sp-z-o-o-i-dobitt-energia-sp-z-o-o",
    ),
    # ENERGA ELEKTROWNIE OSTROŁĘKA S.A.: public already, by REGON's code and the
    # hardcoded list, but owned by nobody on its page, as the register names no
    # shareholder of an SA. The other 10.36% is not named.
    "0000061837": Researched(
        (ResearchedOwner("ENERGA WYTWARZANIE S.A.", "0000512140", "89.64%"),),
        "https://energaostroleka.pl/elektrownia/kapital-zakladowy",
    ),
    # The two KOWR breeding farms that own Green Lab.
    "0000041394": Researched(
        (ResearchedOwner("KRAJOWY OŚRODEK WSPARCIA ROLNICTWA", share="100%"),),
        "https://www.gov.pl/web/kowr/spolki",
    ),
    "0000044641": Researched(
        (ResearchedOwner("KRAJOWY OŚRODEK WSPARCIA ROLNICTWA", share="100%"),),
        "https://www.gov.pl/web/kowr/spolki",
    ),
    # ENERGOSERWIS KLESZCZÓW: 100% Fundacja Rozwoju Gminy Kleszczów, which the
    # gmina founded, since PGE left on 2025-07-10.
    "0000143043": Researched(
        (ResearchedOwner("FUNDACJA ROZWOJU GMINY KLESZCZÓW", "0000114731", "100%"),),
        "https://rejestr.io/krs/143043/energoserwis-kleszczow",
    ),
    # SKILLSPOLAND: Fundacja Rozwoju Systemu Edukacji (the Treasury's) and PARP.
    "0000899574": Researched(
        (
            ResearchedOwner("FUNDACJA ROZWOJU SYSTEMU EDUKACJI", "0000024777"),
            ResearchedOwner("POLSKA AGENCJA ROZWOJU PRZEDSIĘBIORCZOŚCI"),
        ),
        "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000899574?rejestr=P&format=json",
    ),
    # SPOŁECZNA INICJATYWA MIESZKANIOWA "KZN-ZACHODNI": KZN and the city of Kalisz.
    "0000920074": Researched(
        (
            ResearchedOwner("KRAJOWY ZASÓB NIERUCHOMOŚCI"),
            ResearchedOwner("MIASTO KALISZ"),
        ),
        "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000920074?rejestr=P&format=json",
    ),
    # PGO "EKO-MAZURY": owned by a union of gminas, which `JstIndex` does not
    # place. `public_bodies` names such owners, so the register alone now makes
    # it public in `CompaniesKRS` too; this keeps the source on record.
    "0000289055": Researched(
        (ResearchedOwner('ZWIĄZEK MIĘDZYGMINNY "GOSPODARKA KOMUNALNA"'),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000289055?rejestr=P&format=json",
    ),
    # SPOŁECZNA INICJATYWA MIESZKANIOWA "KZN-WIELKOPOLSKA": the Treasury through
    # KZN and 22 gminas, as its own page lists its members' meeting. The register
    # names none of them, each holding under 10%.
    "0000991780": Researched(
        (
            ResearchedOwner(
                "SKARB PAŃSTWA REPREZENTOWANY PRZEZ KRAJOWY ZASÓB NIERUCHOMOŚCI"
            ),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA BOJANOWO"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA CZŁOPA"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA DĄBIE"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA KACZORY"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA KROBIA"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA KROTOSZYN"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA KRZYWIŃ"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA ŁOBŻENICA"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA MIEJSKA GÓRKA"),
            ResearchedOwner("GMINA WIEJSKA MIELESZYN"),
            ResearchedOwner("GMINA WIEJSKA MIEŚCISKO"),
            ResearchedOwner("GMINA WIEJSKA OSTROWITE"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA OSTRZESZÓW"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA PLESZEW"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA PRZEDECZ"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA RAWICZ"),
            ResearchedOwner("GMINA WIEJSKA SIEROSZEWICE"),
            ResearchedOwner("GMINA MIEJSKA SŁUPCA"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA SOMPOLNO"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA TRZCIANKA"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA TUCZNO"),
            ResearchedOwner("GMINA MIEJSKO-WIEJSKA WOLSZTYN"),
        ),
        "https://simkzn-wielkopolska.pl/o-nas/",
    ),
    # "WODOCIĄGI I KANALIZACJA-ZGIERZ": the register lists only the water
    # association, the city's own 7.49% being under the 10% it lists. Public
    # through the association's REGON code alone (133, mixed with a public
    # majority); this keeps the city's stake on record and draws its edge.
    "0000046134": Researched(
        (
            ResearchedOwner("ZGIERSKA SPÓŁKA WODNA", share="92.51%"),
            ResearchedOwner("GMINA MIASTO ZGIERZ", share="7.49%"),
        ),
        "https://www.umz.zgierz.pl/bip/?bip_umz_did=164",
    ),
}


#: Closed-end investment funds (FIZ) whose certificates a public company holds,
#: by the fund's REGON. A fund has no KRS number and no entry in REGON's public
#: catalogue, so the companies the register names it as the owner of read as
#: private; `CompaniesKRS.add_owners_by_regon` joins them to the holder instead.
FUND_HOLDERS: dict[str, FundHolder] = {
    # Owner of the MDR and MP housing companies, Projekt Municypalny Zgorzelec 1
    # among them. PFR bought all of its certificates from BGK on 2021-12-09.
    "363692465": FundHolder(
        "FUNDUSZ SEKTORA MIESZKAŃ DLA ROZWOJU FIZAN",
        PFR,
        "https://strefainwestorow.pl/wiadomosci/20211210/pfr-odkupil-certyfikaty-inwestycyjne-od-bgk-w-dwoch-funduszach-rynku",
    ),
    # 49% of Budimex Parking Wrocław. Set up by BGK and PIR, now PFR, for
    # local-government and PPP projects.
    "361977212": FundHolder(
        "PFR FUNDUSZ INWESTYCJI SAMORZĄDOWYCH FIZAN",
        PFR,
        "https://www.bankier.pl/wiadomosc/BGK-i-PIR-utworza-trzy-fundusze-ze-srodkami-na-poziomie-lacznie-6-5-mld-zl-3370813.html",
    ),
    # 90% of PPP Venture. The third of the BGK and PIR funds.
    "361976980": FundHolder(
        "PFR FUNDUSZ INWESTYCYJNY FIZAN",
        PFR,
        "https://www.pfrtfi.pl/en/fundusz/pfr-fundusz-inwestycyjny-fiz",
    ),
}
