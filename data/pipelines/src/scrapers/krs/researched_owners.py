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
class Founded:
    """Who set up a foundation or association, where a public body did."""

    founders: tuple[ResearchedOwner, ...]
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


KGHM = ResearchedOwner("KGHM POLSKA MIEDŹ S.A.", "0000023302")
TOTALIZATOR = ResearchedOwner("TOTALIZATOR SPORTOWY SP. Z O.O.", "0000007411")
SKARB_PANSTWA = ResearchedOwner("SKARB PAŃSTWA")
KRAKOW = ResearchedOwner("GMINA MIEJSKA KRAKÓW")
#: GUS's list of general-government (S.13) units, 31.12.2024: dane.gov.pl
#: dataset 1609, CC BY 4.0. It names each unit and its subsector, not its
#: founder; S.1311 is central government, S.1313 local government.
GUS_S13 = "https://dane.gov.pl/pl/dataset/1609"

#: Foundations and associations a public body set up, and so public by Szymon's
#: rule of 2026-11-11 ("the public founder counts"), as a public shareholder
#: makes a company public. The register never names a foundation's founder, so
#: each was found by hand: 23 by the koryciarze leads of 2026-10-09, the rest
#: by GUS counting them in the general-government sector, with the founder read
#: off the source given beside it.
#:
#: A founder is not a shareholder, so `CompaniesKRS.add_public_founders` draws
#: no ownership edge to it and the founder is named here for the record only.
#: The flag still carries down to what the body itself owns: Progress and
#: Business's incubator, Fundacja Rozwoju Gminy Kleszczów's companies.
#:
#: Left out: Zakłady Kórnickie, which GUS counts in S.1311 but the Zamoyskis
#: founded in 1925 (expected_public_companies.csv files it not public), and
#: Polska Fundacja Przedsiębiorczości, also S.1311, whose founder no source
#: names and whose own page traces it to the Canada-Poland Entrepreneurs
#: Foundation: not public, Szymon judged on 2026-11-11, and filed so in the
#: same file. GUS's code alone does not make a body public.
PUBLIC_FOUNDERS: dict[str, Founded] = {
    # Found by the koryciarze leads of 2026-10-09.
    "0000064452": Founded(
        (KRAKOW,),
        "https://www.bip.krakow.pl/zarzadzenia/2007/793/X19UUF9fMTA3NTg=/zp_793_2_07.pdf",
    ),
    # Fundacja CBOS: set up by the Act of 20 February 1997.
    "0000070275": Founded(
        (SKARB_PANSTWA,),
        "https://cbos.bip-e.pl/cbs/status-prawny/1665,Status-prawny.html",
    ),
    "0000042901": Founded(
        (
            ResearchedOwner("UNIWERSYTET JAGIELLOŃSKI"),
            KRAKOW,
            SKARB_PANSTWA,
        ),
        "https://pl.wikipedia.org/wiki/Fundacja_Centrum_Dokumentacji_Czynu_Niepodleg%C5%82o%C5%9Bciowego",
    ),
    # Era Parowozów.
    "0000241695": Founded(
        (ResearchedOwner("PKP CARGO S.A.", "0000027702"),),
        "https://eraparowozow.org.pl/o-nas/",
    ),
    # Fundacja Gdańska, with the Pomorska Izba Przemysłowo-Handlowa.
    "0000052463": Founded(
        (ResearchedOwner("GMINA MIASTA GDAŃSKA"),),
        "https://fundacjagdanska.pl/o-nas/",
    ),
    "0000499069": Founded(
        (ResearchedOwner("POLSKIE KOLEJE PAŃSTWOWE S.A.", "0000019193"),),
        "https://www.pkp.pl/pl/fundacja-aktualnosci/3127-czyn-dobro-i-dziel-sie-dobrem-przekaz-1-podatku-fundacji-grupy-pkp",
    ),
    # Patronus Animalium.
    "0000376820": Founded(
        (
            ResearchedOwner(
                "INSTYTUT ZOOTECHNIKI - PAŃSTWOWY INSTYTUT BADAWCZY", "0000125481"
            ),
        ),
        "https://fundacjaiz.pl/o-fundacji/",
    ),
    # Kaliski Inkubator Przedsiębiorczości.
    "0000064811": Founded(
        (ResearchedOwner("MIASTO KALISZ"),),
        "https://calisia.pl/25-lat-dzialalnosci-kaliskiego-inkubatora-przedsiebiorczosci,42201",
    ),
    "0000154740": Founded((KGHM,), "http://fundacjakghm.pl/en/o-fundacji-kghm"),
    # Fundacja LOTTO im. Haliny Konopackiej.
    "0000345434": Founded((TOTALIZATOR,), "https://www.fundacjalotto.pl/"),
    "0000667056": Founded((PGZ,), "https://fundacjapgz.pl/o-fundacji/statut/"),
    # Fundacja Promocji Kultury Miasta Krakowa.
    "0000251136": Founded((KRAKOW,), "https://www.bip.krakow.pl/?id=44"),
    "0000627669": Founded(
        (
            ResearchedOwner(
                "POLSKA WYTWÓRNIA PAPIERÓW WARTOŚCIOWYCH S.A.", "0000062594"
            ),
        ),
        "https://fundacjapwpw.pl/misja-i-cele/",
    ),
    "0000053778": Founded(
        (ResearchedOwner("POWSZECHNY ZAKŁAD UBEZPIECZEŃ S.A.", "0000009831"),),
        "https://fundacja.pzu.pl/o-fundacji",
    ),
    "0000045713": Founded(
        (ResearchedOwner("UNIWERSYTET GDAŃSKI"),),
        "https://old.ug.edu.pl/uniwersytet/struktura_ug/fundacje_i_spolki",
    ),
    "0000966052": Founded(
        (TOTALIZATOR,),
        "https://www.fundacja.totalizator.pl/Uploads/sprawozdanie-merytoryczne-fts-2024.pdf",
    ),
    # MKS Zagłębie Lubin: the state copper combine's works club, from 1966.
    "0000126455": Founded(
        (KGHM,),
        "https://pl.wikipedia.org/wiki/Zag%C5%82%C4%99bie_Lubin_(pi%C5%82ka_r%C4%99czna_m%C4%99%C5%BCczyzn)",
    ),
    # Polska Fundacja Narodowa: seventeen state companies.
    "0000655791": Founded(
        (
            ResearchedOwner("ORLEN S.A.", "0000028860"),
            ResearchedOwner("PGE POLSKA GRUPA ENERGETYCZNA S.A.", "0000059307"),
            ResearchedOwner(
                "POLSKIE GÓRNICTWO NAFTOWE I GAZOWNICTWO S.A.", "0000059492"
            ),
            ResearchedOwner("POWSZECHNY ZAKŁAD UBEZPIECZEŃ S.A.", "0000009831"),
            ResearchedOwner(
                "POWSZECHNA KASA OSZCZĘDNOŚCI BANK POLSKI S.A.", "0000026438"
            ),
            KGHM,
            ResearchedOwner("TAURON POLSKA ENERGIA S.A.", "0000271562"),
            ResearchedOwner("ENEA S.A.", "0000012483"),
            ResearchedOwner("ENERGA S.A.", "0000271591"),
            GRUPA_AZOTY,
            ResearchedOwner("GRUPA LOTOS S.A.", "0000106150"),
            ResearchedOwner(
                "GIEŁDA PAPIERÓW WARTOŚCIOWYCH W WARSZAWIE S.A.", "0000082312"
            ),
            TOTALIZATOR,
            PGZ,
            ResearchedOwner("POLSKIE KOLEJE PAŃSTWOWE S.A.", "0000019193"),
            ResearchedOwner("POLSKI HOLDING NIERUCHOMOŚCI S.A."),
            ResearchedOwner(
                "POLSKA WYTWÓRNIA PAPIERÓW WARTOŚCIOWYCH S.A.", "0000062594"
            ),
        ),
        "https://www.phnsa.pl/pl/aktualnosc/podpisanie-aktu-zalozycielskiego-i-statutu-polskiej-fundacji-narodowej",
    ),
    # Polska Fundacja Promocji Kadr, in liquidation.
    "0000094560": Founded(
        (SKARB_PANSTWA, ARP),
        "https://arp.pl/pl/aktualnosci/polska-fundacja-promocji-kadr-weszla-do-klastra-centrum-inzynierii-biomedycznej/",
    ),
    # Unia Metropolii Polskich: an association of seven cities.
    "0000129432": Founded(
        (
            ResearchedOwner("GMINA MIASTA GDAŃSKA"),
            ResearchedOwner("MIASTO KATOWICE"),
            ResearchedOwner("GMINA LUBLIN"),
            ResearchedOwner("MIASTO ŁÓDŹ"),
            ResearchedOwner("GMINA MIASTO SZCZECIN"),
            ResearchedOwner("MIASTO STOŁECZNE WARSZAWA"),
            ResearchedOwner("GMINA WROCŁAW"),
        ),
        "https://metropolie.pl/o-nas/statut",
    ),
    # Fundacja WKS Śląsk Wrocław: the club's company, the city's.
    "0000868751": Founded(
        (
            ResearchedOwner(
                'WROCŁAWSKI KLUB SPORTOWY "ŚLĄSK WROCŁAW" S.A.', "0000070008"
            ),
        ),
        "https://www.slaskwroclaw.pl/fundacja",
    ),
    # Mokotowska Fundacja Warszawianka - Wodny Park.
    "0000039836": Founded(
        (ResearchedOwner("MIASTO STOŁECZNE WARSZAWA"),),
        "https://www.wodnypark.com.pl/o-fundacji/",
    ),
    # Związek Pracodawców Polska Miedź: KGHM and its group, with local
    # governments and public hospitals among the members.
    "0000126828": Founded((KGHM,), "https://pracodawcy.pl/lista-firm-czlonkowskich/"),
    # GUS S.13, 2026-10-14, and Szymon asking about the first on 2026-11-11.
    # Fundacja Agencji Rozwoju Przemysłu: S.1311. No source seen names the
    # founder; ARP's own name is on it.
    "0000765394": Founded((ARP,), GUS_S13),
    # Centrum Europejskie Natolin: "a foundation established by the Polish State".
    "0000021941": Founded((SKARB_PANSTWA,), "https://www.natolin.edu.pl/en/about/"),
    # Orły Sportu: S.1311, which the Sejm sport committee (term 10) heard
    # called a state foundation the finance minister set up.
    "0000037541": Founded((SKARB_PANSTWA,), GUS_S13),
    # Platforma Przemysłu Przyszłości: art. 4 of its Act, Dz.U. 2019 poz. 229.
    "0000784300": Founded(
        (SKARB_PANSTWA,), "https://eli.gov.pl/eli/DU/2019/229/ogl/pol/pdf"
    ),
    # Pro Arte et Historia: S.1311, there to keep ARP's castles at Krasiczyn and
    # Baranów Sandomierski.
    "0000518786": Founded(
        (ARP,),
        "https://www.krasiczyn.com.pl/en/castle/10th-anniversary-of-the-pro-arte-et-historia-foundation",
    ),
    # Progress and Business: AGH, the Jagiellonian University and the Polish
    # Academy of Sciences among its founders, with the Danish Technological
    # Institute.
    "0000155141": Founded(
        (
            ResearchedOwner("AKADEMIA GÓRNICZO-HUTNICZA IM. STANISŁAWA STASZICA"),
            ResearchedOwner("UNIWERSYTET JAGIELLOŃSKI"),
            ResearchedOwner("POLSKA AKADEMIA NAUK"),
        ),
        "https://polsa.gov.pl/baza-podmiotow/progress-and-business-foundation",
    ),
    # Fundacja Solidarności Międzynarodowej (Solidarity Fund PL).
    "0000024453": Founded(
        (SKARB_PANSTWA,), "https://www.gov.pl/web/polishaid/solidarity-fund-pl"
    ),
    # Fundacja Rozwoju Gminy Kleszczów: S.1313, the gmina's by its name.
    "0000114731": Founded((ResearchedOwner("GMINA KLESZCZÓW"),), GUS_S13),
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
