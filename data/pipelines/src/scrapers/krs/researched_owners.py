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
A mutual insurer (TUW) a state group holds counts the same (decision on
2026-11-19). Checked 2026-10-09, the three defence companies 2026-10-20,
Energa Elektrownie Ostrołęka 2026-10-30, the 31 the likely-public read found
2026-11-19; a sale changes it, so a source older than a year or two is worth
reading again before a page quotes it.
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
KGHM = ResearchedOwner("KGHM POLSKA MIEDŹ S.A.", "0000023302")
ORLEN = ResearchedOwner("ORLEN S.A.", "0000028860")
PZU = ResearchedOwner("POWSZECHNY ZAKŁAD UBEZPIECZEŃ S.A.", "0000009831")
GPW = ResearchedOwner("GIEŁDA PAPIERÓW WARTOŚCIOWYCH W WARSZAWIE S.A.", "0000082312")
ENEA = ResearchedOwner("ENEA S.A.", "0000012483")
SKARB_PANSTWA = ResearchedOwner("SKARB PAŃSTWA")

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
    # Found by the likely-public read of 2026-11-19: S.A.s with several
    # shareholders, which the register does not name, and companies struck off
    # with none listed.
    # GÓRNOŚLĄSKA AGENCJA ROZWOJU REGIONALNEGO: Województwo Śląskie's majority
    # until 2014-04-15, when Fundusz Górnośląski bought it and then took GARR
    # over; struck off 2015-01-26.
    "0000065064": Researched(
        (ResearchedOwner("FUNDUSZ GÓRNOŚLĄSKI S.A.", "0000042922", ">50%"),),
        "https://nik.gov.pl/kontrole/wyniki-kontroli-nik/pobierz,lka~p_14_019_201404250756291398412589~id2~01,typ,kj.pdf",
    ),
    # MORSKA STOCZNIA REMONTOWA "GRYFIA": the rest is its employees'.
    "0000009273": Researched(
        (ResearchedOwner("FUNDUSZ ROZWOJU SPÓŁEK S.A.", "0000285139", "92.36%"),),
        "https://www.nik.gov.pl/kontrole/wyniki-kontroli-nik/pobierz,lsz~p_22_081_202302081129291675852169~01,typ,kk.pdf",
    ),
    # STOCZNIA REMONTOWA NAUTA: the majority MARS took from ARP in 2010; in the
    # PGZ group since 2014. The fund has no KRS number, so it draws no edge.
    "0000047582": Researched(
        (ResearchedOwner("MARS FUNDUSZ INWESTYCYJNY ZAMKNIĘTY"),),
        "https://pl.wikipedia.org/wiki/Stocznia_Remontowa_Nauta",
    ),
    # GAS-TRADING: PGNiG's own 43.41%, ORLEN's since the 2022 merger, and the
    # 36.17% its subsidiary bought from Bartimpex in 2015.
    "0000039178": Researched(
        (
            dataclasses.replace(ORLEN, share="43.41%"),
            ResearchedOwner("GAS ASSETS MANAGEMENT SP. Z O.O.", share="36.17%"),
        ),
        "https://decyzje.uokik.gov.pl/bp/dec_prez.nsf/43104c28a7a1be23c1257eac006d8dd4/565cbc152c4ea48ac1257ec6007ba926/$FILE/DKK1_421_11_15_SZ_GAM_PGNiG_GASTrading_dec.pdf",
    ),
    # KONSORCJUM OLEJÓW PRZEPRACOWANYCH (KOOP), at ORLEN Południe's Jedlicze
    # refinery: on ORLEN's list of its group's companies, which does not say
    # which of them holds it, so no edge is drawn.
    "0000059362": Researched(
        (ResearchedOwner("GRUPA KAPITAŁOWA ORLEN"),),
        "https://www.pzu.pl/_fileserver/item/1566428",
    ),
    # ZAKŁAD MECHANICZNY "BUMAR-MIKULCZYCE", PGZ group.
    "0000126115": Researched(
        (
            ResearchedOwner(
                'ZAKŁADY MECHANICZNE "BUMAR-ŁABĘDY" S.A.', "0000016872", "79.46%"
            ),
            ResearchedOwner(
                "POLSKI HOLDING OBRONNY SP. Z O.O.", "0000027151", "19.88%"
            ),
        ),
        "https://bumar-mikulczyce.pl/dla-akcjonariuszy/akcjonariat/",
    ),
    # CENTRALNE BIURO KONSTRUKCJI KOTŁÓW: Sefako's since 2012, Sefako being
    # Towarzystwo Finansowe Silesia's.
    "0000096004": Researched(
        (ResearchedOwner('FABRYKA KOTŁÓW "SEFAKO" S.A.', "0000029367", "98.5%"),),
        "https://www.cbkk.pl/dla_akcjonariuszy-1-1078.html",
    ),
    "0000900868": Researched(  # GPW LOGISTICS
        (dataclasses.replace(GPW, share="95%"),),
        "https://www.gpw.pl/pub/GPW/files/raporty_roczne/GPW_Group_Integrated_Report_2023.pdf",
    ),
    # POLSKA AGENCJA RATINGOWA, struck off 2026-06-03: a third each of GPW,
    # PFR and BIK in 2019.
    "0000515329": Researched(
        (
            dataclasses.replace(GPW, share="35.86%"),
            dataclasses.replace(PFR, share="33%"),
        ),
        "https://bank.pl/co-dalej-z-polska-agencja-ratingowa/",
    ),
    # RE58 (formerly Sigma BIS): PZU's alone from 2015 to 2019, still in the
    # PZU group's structure in its 2025 report.
    "0000534906": Researched(
        (PZU,),
        "https://annualreport2025.pzu.pl/en/about-pzu-group/group-characteristics/structure-of-the-pzu-group/",
    ),
    # REGIONALNA AGENCJA ROZWOJU I RESTRUKTURYZACJI "ODNOWA", struck off 2007:
    # its liquidation closed at the Ministry of the Treasury, its single founder.
    "0000039459": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000039459?rejestr=P&format=json",
    ),
    "0000061116": Researched(  # TARGI LUBLIN
        (
            ResearchedOwner("GMINA LUBLIN"),
            ResearchedOwner("WOJEWÓDZTWO LUBELSKIE"),
            ResearchedOwner("MIĘDZYNARODOWE TARGI POZNAŃSKIE SP. Z O.O.", "0000202703"),
        ),
        "https://medycyna.lublin.eu/cluster-members/lublin-trade-fairs-s-a/?lang=en",
    ),
    # GORZOWSKI RYNEK HURTOWY: series A and B, 86.9%, are local governments'.
    "0000152226": Researched(
        (
            ResearchedOwner("MIASTO GORZÓW WIELKOPOLSKI", share="34.5%"),
            ResearchedOwner("MIASTO KOSTRZYN NAD ODRĄ"),
        ),
        "https://bip.grh.pl/pobierz/31",
    ),
    # FUNDUSZ ROZWOJU I PROMOCJI WOJEWÓDZTWA WIELKOPOLSKIEGO; its FINANSOWANIE I
    # DORADZTWO follows it.
    "0000094064": Researched(
        (ResearchedOwner("WOJEWÓDZTWO WIELKOPOLSKIE", share="60%"),),
        "https://nik.gov.pl/kontrole/wyniki-kontroli-nik/pobierz,lpo~p_14_019_201404250756291398412589~id0~01,typ,kj.pdf",
    ),
    "0000336380": Researched(  # GKS GIEKSA KATOWICE
        (ResearchedOwner("MIASTO KATOWICE", share="89.75%"),),
        "https://pl.wikipedia.org/wiki/GKS_Katowice_(pi%C5%82ka_no%C5%BCna)",
    ),
    "0000018162": Researched(  # MPEC "TERMAL", Lubin
        (ResearchedOwner("GMINA MIEJSKA LUBIN", share="100%"),),
        "https://nik.gov.pl/kontrole/wyniki-kontroli-nik/pobierz,lwr~p_14_019_201404250756291398412589~id1~01,typ,kj.pdf",
    ),
    "0000516088": Researched(  # MKS ZAGŁĘBIE LUBIN
        (dataclasses.replace(KGHM, share="100%"),),
        "https://pl.wikipedia.org/wiki/Zag%C5%82%C4%99bie_Lubin_(pi%C5%82ka_no%C5%BCna)",
    ),
    # LUBELSKI WĘGIEL "BOGDANKA", listed: Enea's majority. RG "Bogdanka" and
    # Górnik Łęczna follow it.
    "0000004549": Researched(
        (dataclasses.replace(ENEA, share="64.57%"),),
        "https://www.stockwatch.pl/inwestor/enea-sa-wraz-z-enea-wytwarzanie-sp-z-o-o.aspx",
    ),
    # FABRYKA OBRABIAREK RAFAMET, listed: ARP's majority of the capital.
    "0000069588": Researched(
        (dataclasses.replace(ARP, share="50.47%"),),
        "https://www.stockwatch.pl/inwestor/agencja-rozwoju-przemyslu-sa.aspx",
    ),
    # Minority stakes, public by the any-stake rule (decision on 2026-10-07).
    # TELEFONY PODLASKIE: the rest is Orange Polska's TP Invest (89% in 2011).
    "0000033429": Researched(
        (ResearchedOwner("GMINA SOKOŁÓW PODLASKI", share="1.25%"),),
        "https://sokolowpodlaski.biuletyn.net/fls/bip_pliki/2024_05/BIPF61907B9381704Z/Informacja-dodatkowa__korekta_2022.pdf",
    ),
    # GÓRNIK ZABRZE: the city sold the club to LP Holding in 2026 and kept one
    # share, with a seat on the supervisory board.
    "0000106227": Researched(
        (ResearchedOwner("MIASTO ZABRZE", share="1 share"),),
        "https://cms.law/en/pol/news-information/cms-advises-city-of-zabrze-on-gornik-zabrze-privatisation",
    ),
    # WIELKOPOLSKA SIEĆ SZEROKOPASMOWA: the voivodeship's after INEA took up new
    # shares in 2014 (25.17%), cut to 14% from 2016.
    "0000343277": Researched(
        (ResearchedOwner("WOJEWÓDZTWO WIELKOPOLSKIE", share="14%"),),
        "https://www.telepolis.pl/wiadomosci/inea-wiekszosciowym-akcjonariuszem-wss",
    ),
    "0000359854": Researched(  # MOTOR LUBLIN, privately held since 2020
        (ResearchedOwner("MIASTO LUBLIN", share="14.10%"),),
        "https://pl.wikipedia.org/wiki/Motor_Lublin_(pi%C5%82ka_no%C5%BCna)",
    ),
    # PEC W WAŁBRZYCHU: the gmina had sold half of its 29.99% by 2014.
    "0000062924": Researched(
        (ResearchedOwner("GMINA WAŁBRZYCH", share="15%"),),
        "https://nik.gov.pl/kontrole/wyniki-kontroli-nik/pobierz,lwr~p_14_019_201404250756291398412589~id0~01,typ,kj.pdf",
    ),
    # ŁÓDZKI RYNEK HURTOWY "ZJAZDOWA": the city is among the shareholders its
    # own page shows; the stake is not given.
    "0000042894": Researched(
        (ResearchedOwner("MIASTO ŁÓDŹ"),),
        "https://zjazdowa.com.pl/",
    ),
    "0000260820": Researched(  # GÓRNIK ŁĘCZNA, the rest the club association's
        (ResearchedOwner('LUBELSKI WĘGIEL "BOGDANKA" S.A.', "0000004549", "35%"),),
        "https://ri.lw.com.pl/pobierz/5690/sprawozdanie-zarzadu-z-dzialalnosci-grupy-kapitalowej-lw-bogdanka-s-a-za-rok-2008-pdf",
    ),
    # EKSTRAKLASA: each top-flight club holds 5.1555%, PZPN 7.201%. Public
    # through the two clubs the public owns.
    "0000239140": Researched(
        (
            ResearchedOwner("MKS ZAGŁĘBIE LUBIN S.A.", "0000516088", "5.1555%"),
            ResearchedOwner("GKS GIEKSA KATOWICE S.A.", "0000336380", "5.1555%"),
        ),
        "https://pl.wikipedia.org/wiki/Ekstraklasa_SA",
    ),
    # Mutual insurers a state group holds, public by the decision on
    # 2026-11-19. TUW PZUW: PZU is its founding member and has consolidated it
    # at 100% since 2015.
    "0000587260": Researched(
        (PZU,),
        "https://www.bankier.pl/wiadomosc/PZU-utworzy-towarzystwo-ubezpieczen-wzajemnych-3434697.html",
    ),
    # POLSKI GAZ TUW, in liquidation: set up by PGNiG for its group, ORLEN's
    # 100% after the merger, PZU's since 2024.
    "0000643093": Researched(
        (PZU,),
        "https://inwestycje.pl/gielda/pzu-ma-zgode-knf-na-przejecie-polski-gaz-tuw-i-polski-gaz-tuwnz/",
    ),
    # TUW "CUPRUM": KGHM's group held 99.49% at the end of 2022.
    "0000050696": Researched(
        (dataclasses.replace(KGHM, share="93.8%"),),
        "https://raportcsr2022.kghm.com/en/noty_objasniajace/12-11",
    ),  # A state enterprise, an SPZOZ or a research institute struck off: its
    # founding organ (organ założycielski) is what it belongs to, and only the
    # odpis pełny names it, the odpis aktualny of a struck-off entry being
    # empty. A wojewoda or a minister founds for the Treasury. Found by the
    # likely-public read of 2026-11-06, each organ read off the register.
    # WZZ HERBAPOL in privatisation: WOJEWODA MAZOWIECKI.
    "0000052831": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000052831?rejestr=P&format=json",
    ),
    # Szpital Wojewódzki OLK in Przemyśl: MINISTER TRANSPORTU I GOSPODARKI MORSKIEJ.
    "0000005169": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000005169?rejestr=S&format=json",
    ),
    # The Brudziński children's hospital, merged into UCK WUM: MINISTER
    # ZDROWIA, then WARSZAWSKI UNIWERSYTET MEDYCZNY.
    "0000158332": Researched(
        (ResearchedOwner("WARSZAWSKI UNIWERSYTET MEDYCZNY"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000158332?rejestr=S&format=json",
    ),
    # BZLiP BEZALIN: WOJEWODA ŚLĄSKI.
    "0000062895": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000062895?rejestr=P&format=json",
    ),
    # the Ziętek rheumatology hospital in Ustroń: WOJEWODA KATOWICKI.
    "0000174051": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000174051?rejestr=S&format=json",
    ),
    # PUHiT Kraków: WOJEWODA MAŁOPOLSKI.
    "0000056563": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000056563?rejestr=P&format=json",
    ),
    # SPZOZ w Gostycynie: GMINA GOSTYCYN.
    "0000002454": Researched(
        (ResearchedOwner("GMINA GOSTYCYN"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000002454?rejestr=S&format=json",
    ),
    # ZOZ w Lubinie: STAROSTWO POWIATOWE W LUBINIE.
    "0000011395": Researched(
        (ResearchedOwner("POWIAT LUBIŃSKI"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000011395?rejestr=S&format=json",
    ),
    # ZOZ w Złotoryi: WOJEWODA LEGNICKI.
    "0000019042": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000019042?rejestr=S&format=json",
    ),
    # PDPS PZL-Bielsko: WOJEWODA ŚLĄSKI.
    "0000021144": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000021144?rejestr=P&format=json",
    ),
    # Wojewódzki Szpital Bródnowski: SAMORZĄD WOJEWÓDZTWA MAZOWIECKIEGO.
    "0000026621": Researched(
        (ResearchedOwner("WOJEWÓDZTWO MAZOWIECKIE"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000026621?rejestr=S&format=json",
    ),
    # RPRD w Rybniku: WOJEWODA ŚLĄSKI.
    "0000036343": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000036343?rejestr=P&format=json",
    ),
    # CF "CEFARM" Warszawa: WOJEWODA MAZOWIECKI.
    "0000039792": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000039792?rejestr=P&format=json",
    ),
    # Fabryka Tarcz Ściernych: WOJEWODA WARSZAWSKI.
    "0000041921": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000041921?rejestr=P&format=json",
    ),
    # SPZOZ w Brzezinach: POWIAT ŁÓDZKI WSCHODNI, then POWIAT BRZEZIŃSKI.
    "0000047145": Researched(
        (ResearchedOwner("POWIAT BRZEZIŃSKI"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000047145?rejestr=S&format=json",
    ),
    # PP Pracownie Konserwacji Zabytków: MINISTER SKARBU PAŃSTWA.
    "0000065931": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000065931?rejestr=P&format=json",
    ),
    # OPAKOMET in privatisation: WOJEWODA MAŁOPOLSKI.
    "0000067518": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000067518?rejestr=P&format=json",
    ),
    # Instytut Medycyny Pracy i Zdrowia Środowiskowego: RADA MINISTRÓW, then
    # MINISTER ZDROWIA.
    "0000084423": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000084423?rejestr=P&format=json",
    ),
    # PPKS w Świdwinie: WOJEWODA ZACHODNIOPOMORSKI.
    "0000095659": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000095659?rejestr=P&format=json",
    ),
    # PPKS w Żywcu: WOJEWODA BIELSKI, then WOJEWODA ŚLĄSKI.
    "0000120006": Researched(
        (SKARB_PANSTWA,),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000120006?rejestr=P&format=json",
    ),
}


TOTALIZATOR = ResearchedOwner("TOTALIZATOR SPORTOWY SP. Z O.O.", "0000007411")
KRAKOW = ResearchedOwner("GMINA MIEJSKA KRAKÓW")
#: GUS's list of general-government (S.13) units, 31.12.2024: dane.gov.pl
#: dataset 1609, CC BY 4.0. It names each unit and its subsector, not its
#: founder; S.1311 is central government, S.1313 local government.
GUS_S13 = "https://dane.gov.pl/pl/dataset/1609"

#: Foundations and associations a public body set up, and so public by Szymon's
#: rule of 2026-11-11 ("the public founder counts"), as a public shareholder
#: makes a company public. The register never names a foundation's founder, so
#: each was found by hand: 23 by the koryciarze leads of 2026-10-09, 17 by the
#: likely-public read of 2026-11-19, the rest by GUS counting them in the
#: general-government sector, with the founder read off the source given
#: beside it. One public founder is enough, beside private ones too (decision
#: on 2026-11-19).
#:
#: A founder is not a shareholder, so `CompaniesKRS.add_public_founders` puts
#: it in `founded_by` rather than among the owners: the site lists it under
#: „Właściciele”, labelled as the founder, and nothing that reads the ownership
#: graph takes it for a shareholder. The flag still carries down to what the
#: body itself owns: Progress and Business's incubator, Fundacja Rozwoju Gminy
#: Kleszczów's companies. A founder with neither a KRS number nor a TERYT code
#: (a university, the Polish Academy of Sciences) is named here only.
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
            ResearchedOwner("POLSKI HOLDING NIERUCHOMOŚCI S.A.", "0000383595"),
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
    # Found by the likely-public read of 2026-11-19.
    "0000037031": Founded(  # FUNDACJA ORLEN, first ORLEN - DAR SERCA
        (ORLEN,),
        "https://www.orlen.pl/en/about-the-company/our-support/orlen-group-foundations",
    ),
    # FUNDACJA KRAJOWEJ GRUPY SPOŻYWCZEJ "POMAGANIE KRZEPI": its statute names
    # Krajowa Spółka Cukrowa, now KGS, which appoints both of its boards.
    "0000653638": Founded(
        (ResearchedOwner("KRAJOWA GRUPA SPOŻYWCZA S.A.", "0000084678"),),
        "https://www.pomaganie-krzepi.pl/plik,15447,statut-fundacji-vii-2025-pdf.pdf",
    ),
    "0000956394": Founded(  # FUNDACJA LEGNICKIEJ SPECJALNEJ STREFY EKONOMICZNEJ
        (ResearchedOwner("LEGNICKA SPECJALNA STREFA EKONOMICZNA S.A.", "0000033018"),),
        "https://miedziowefakty.pl/legnicka-specjalna-strefa-ekonomiczna-powolala-swoja-fundacje",
    ),
    # FUNDACJA WSSE "INVEST-PARK", put into liquidation by the zone company's
    # board in 2026.
    "0001013443": Founded(
        (
            ResearchedOwner(
                'WAŁBRZYSKA SPECJALNA STREFA EKONOMICZNA "INVEST-PARK" SP. Z O.O.',
                "0000059084",
            ),
        ),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0001013443?rejestr=S&format=json",
    ),
    # FAPA: set up in 1992 by the Minister of Agriculture for the Treasury.
    "0000033110": Founded(
        (SKARB_PANSTWA,), "https://www.fapa.org.pl/fapa-1992-2017/fapa-1992-2017"
    ),
    "0000182507": Founded(  # SAPERE AUSO, by the voivodeship's sejmik in 2003
        (ResearchedOwner("WOJEWÓDZTWO MAŁOPOLSKIE"),), "https://dzieje.pl/node/83788"
    ),
    "0000139886": Founded(  # CONVENTION BUREAU - WROCŁAW
        (
            ResearchedOwner("GMINA WROCŁAW"),
            ResearchedOwner(
                'WROCŁAWSKIE PRZEDSIĘBIORSTWO "HALA LUDOWA" SP. Z O.O.', "0000051000"
            ),
        ),
        "https://convention.wroclaw.pl/wp-content/uploads/2022/08/Statut-Convention-Bureau-Wroclaw.pdf",
    ),
    "0000253076": Founded(  # FUNDUSZ GRANTOWY DLA PŁOCKA
        (
            ResearchedOwner("GMINA MIASTO PŁOCK"),
            ORLEN,
            ResearchedOwner("BASELL ORLEN POLYOLEFINS SP. Z O.O.", "0000143578"),
        ),
        "https://www.wilcoproject.eu/book/chapters/50-foundation-grant-fund-for-plock/",
    ),
    # ZAKŁAD NARODOWY IM. OSSOLIŃSKICH: a foundation the Act of 5 January 1995
    # set up, under the culture minister's supervision.
    "0000090878": Founded(
        (SKARB_PANSTWA,),
        "https://api.sejm.gov.pl/eli/acts/DU/1995/121/text/U/D19950121Lj.pdf",
    ),
    "0000730670": Founded(  # FUNDACJA INTELIGENTNA MAŁOPOLSKA, at MARR's office
        (
            ResearchedOwner(
                "MAŁOPOLSKA AGENCJA ROZWOJU REGIONALNEGO S.A.", "0000033198"
            ),
        ),
        "https://archiwum.marr.pl/wp-content/uploads/2019/07/serwis-prasowy-MARR-S.A.-01.07.2019.pdf",
    ),
    "0000526089": Founded(  # REVITA, Płock
        (
            ResearchedOwner(
                "AGENCJA REWITALIZACJI STARÓWKI ARS SP. Z O.O.", "0000044769"
            ),
        ),
        "https://nowybip.plock.eu/dokumenty/nowybip/dok/2025/MGT8SnzW/0d8b3a3ef6772d2ef10883694f6f3ff3.pdf",
    ),
    # FUNDACJA ENEA - ENERGIA WSPÓLNOTY: registered at Enea's head office in
    # 2025 as Enea wound the older Fundacja Enea down.
    "0001162550": Founded(
        (ENEA,),
        "https://biznes.interia.pl/polska-agencja-prasowa/news-fundacja-enea-energia-wspolnoty-inspiruje-do-dzialan-na-rzec,nId,22598632",
    ),
    # FUNDACJA UZDROWISKA SZCZAWNO-JEDLINA "STOKROTKA", struck off 2026: under
    # the spa company's name and at its address; the spa is the voivodeship's.
    "0000586292": Founded(
        (ResearchedOwner("UZDROWISKO SZCZAWNO-JEDLINA S.A.", "0000110745"),),
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000586292?rejestr=S&format=json",
    ),
    # FUNDACJA PGE ENERGIA CIEPŁA, first Fundacja Elektrowni Rybnik, struck off
    # 2021: one of PGE's two corporate foundations.
    "0000204954": Founded(
        (ResearchedOwner("PGE ENERGIA CIEPŁA S.A.", "0000013479"),),
        "https://raportzintegrowany2019.gkpge.pl/en/spoleczenstwo/zaangazowanie-spoleczne/",
    ),
    # Set up by public and private founders together: public, since any public
    # founder counts (decision on 2026-11-19). The private ones are not listed.
    "0000051191": Founded(  # PODLASKA FUNDACJA ROZWOJU REGIONALNEGO
        (SKARB_PANSTWA,), "https://pfrr.pl/o-fundacji/"
    ),
    # FUNDACJA ROZWOJU OŚRODKA AKADEMICKIEGO, Rzeszów: the voivode, the city and
    # the region's public universities, besides the diocese and an MP.
    "0000036081": Founded(
        (
            SKARB_PANSTWA,
            ResearchedOwner("GMINA MIASTO RZESZÓW"),
            ResearchedOwner("POLITECHNIKA RZESZOWSKA"),
        ),
        "https://bazhum.muzhp.pl/media/texts/resovia-sacra-studia-teologiczno-filozoficzne-diecezji-rzeszowskiej/2009-tom-16/resovia_sacra_studia_teologiczno_filozoficzne_diecezji_rzeszowskiej-r2009-t16-s287-298.pdf",
    ),
    # FUNDACJA OCHRONY WIELKICH JEZIOR MAZURSKICH: two voivodes and the lakes'
    # towns and gminas, besides seven private persons.
    "0000042009": Founded(
        (
            SKARB_PANSTWA,
            ResearchedOwner("MIASTO GIŻYCKO"),
            ResearchedOwner("MIASTO KĘTRZYN"),
            ResearchedOwner("MIASTO MRĄGOWO"),
            ResearchedOwner("GMINA RUCIANE-NIDA"),
        ),
        "https://jeziora.com.pl/o-nas/",
    ),
}


@dataclasses.dataclass(frozen=True)
class Members:
    """Who an association's ordinary members are, all of them public bodies."""

    members: str
    source: str


#: Associations, unions and employers' organisations whose ordinary (voting)
#: members are all public bodies - gminas, powiaty, województwa, their unions,
#: public hospitals, municipal or state companies - and so public by the
#: decision on 2026-11-19, as a public founder makes a foundation public. One
#: with private ordinary members too stays private (the same decision);
#: supporting members without a vote do not count either way. The register
#: never lists members, so each was checked by hand, with the source given
#: beside it. No member is drawn as an owner: `CompaniesKRS.add_public_members`
#: marks the body itself.
PUBLIC_MEMBERS: dict[str, Members] = {
    # Checked on 2026-10-09 among the koryciarze leads.
    "0000214552": Members(  # "POMORSKIE W UNII EUROPEJSKIEJ"
        "Samorząd Województwa Pomorskiego, cities, powiaty and gminas: all 32"
        " ordinary members; 20 supporting members",
        "https://pomorskieregion.eu/en/about-us/",
    ),
    "0000010489": Members(  # "DOLNY ŚLĄSK W UNII EUROPEJSKIEJ"
        "17 local governments of Dolnośląskie",
        "https://umwd.dolnyslask.pl/index.php?id=3338",
    ),
    # STOWARZYSZENIE POLSKICH REGIONÓW KORYTARZA TRANSPORTOWEGO BAŁTYK-ADRIATYK
    "0000421737": Members(
        "the voivodeships along the corridor; supporting members without a vote",
        "https://bac.pl/statut/",
    ),
    # ZWIĄZEK PRACODAWCÓW PODMIOTÓW LECZNICZYCH SAMORZĄDU WOJEWÓDZTWA MAZOWIECKIEGO
    "0000241357": Members(
        "medical entities the Mazowieckie voivodeship owns",
        "https://www.pfsz.org/szpitalne-organizacje-partnerskie/",
    ),
    "0000040079": Members(  # ZWIĄZEK REGIONALNYCH PORTÓW LOTNICZYCH
        "11 regional airport companies, owned by voivodeships, cities and PPL",
        "https://rejestr.io/krs/40079/zwiazek-regionalnych-portow-lotniczych",
    ),
    # FUNDACJA "DOLNOŚLĄSKIE FORUM WODOCIĄGOWE": a foundation with members.
    "0000049893": Members(
        "about 51 municipal water companies of Dolnośląskie and Dresden's",
        "https://www.kierunekwodkan.pl/konferencja,2318,108690.html",
    ),
    # Checked on 2026-11-19 by the likely-public read: every ordinary member
    # a public body, as the statute or the members list says.
    # STOWARZYSZENIE GMIN I POWIATÓW MAŁOPOLSKI
    "0000182275": Members(
        (
            "94 gminas and 7 powiats of historical Małopolska; statute §7: an ordinary "
            "member can only be a gmina, powiat or województwo"
        ),
        "https://sgpm.krakow.pl/",
    ),
    # EUROREGION NYSA
    "0000055755": Members(
        "46 members: 39 gminas, 6 powiats and the Dolnośląskie województwo",
        "https://www.euroregion-nysa.pl/index.php/pl/start-pln/gminy-czlonkowskie",
    ),
    # STOWARZYSZENIE GMIN POLSKICH EUROREGIONU POMERANIA
    "0000005393": Members(
        (
            "92 gminas and powiats of zachodniopomorskie; statute §10.1: an ordinary "
            "member can only be a gmina or powiat of that województwo"
        ),
        "https://pomerania.org.pl/?page_id=460",
    ),
    # STOWARZYSZENIE GMIN UZDROWISKOWYCH RZECZPOSPOLITEJ POLSKIEJ
    "0000136278": Members(
        (
            "47 spa and resort gminas (Krynica-Zdrój, Ciechocinek, Kołobrzeg, Sopot, "
            "Kraków...); statute §4.1: ordinary members are gminas"
        ),
        "http://sgurp.pl/pl/1028/0/czlonkowie.html",
    ),
    # STOWARZYSZENIE GMIN I POWIATÓW "DOLNOŚLĄSKA KRAINA ROWEROWA"
    "0000098618": Members(
        "14 gminas and 2 powiats (milicki, trzebnicki)",
        "http://dolnoslaskakrainarowerowa.pl/o-nas",
    ),
    # STOWARZYSZENIE GMIN POLSKICH EUROREGIONU GLACENSIS
    "0000094436": Members(
        (
            "38: 34 gminas and 4 powiats; statute: 'Członkiem zwyczajnym może być każda"
            " gmina'"
        ),
        "https://euroregion-glacensis.ng.pl/37",
    ),
    # KONWENT WSPÓŁPRACY SAMORZĄDOWEJ POLSKA-UKRAINA
    "0000372491": Members(
        (
            "26 local governments of every level; statute §9-10: ordinary members can "
            "only be Polish local government units"
        ),
        (
            "https://bip.gmina.kolobrzeg.pl/fileadmin/bip_files/ugkolobrzeg/statut_KWSP"
            "U_.pdf"
        ),
    ),
    # STOWARZYSZENIE GMIN POLSKA SIEĆ ENERGIE CITES
    "0000129013": Members(
        (
            "40 cities and gminas (Warszawa, Bydgoszcz, Bielsko-Biała, Konin, Zamość, "
            "Żory...), Metropolia Bydgoszcz and a Lithuanian gmina; statute..."
        ),
        "https://www.pnec.org.pl/pl/stowarzyszenie/czlonkowie-zwyczajni",
    ),
    # STOWARZYSZENIE "METROPOLIA WARSZAWA"
    "0000203026": Members(
        (
            "79: 70 gminas including m.st. Warszawa, and 9 powiats; statute §11.1: "
            "gminas and powiats of the Warsaw capital region"
        ),
        "https://sm.waw.pl/gminy-stowarzyszone/",
    ),
    # ZWIĄZEK GMIN WIEJSKICH RZECZYPOSPOLITEJ POLSKIEJ
    "0000088063": Members(
        (
            "About 650 rural and urban-rural gminas; statute §10.1: any rural or "
            "urban-rural gmina"
        ),
        "https://www.zgwrp.pl/lista-gmin-czlonkowskich/",
    ),
    # STOWARZYSZENIE GMIN POLSKICH EUROREGIONU PRADZIAD
    "0000036957": Members(
        (
            "47: 42 gminas and 5 powiats of Opolskie; statute §11.1: gminas and powiats"
            " of the Opolskie województwo"
        ),
        "https://europradziad.pl/o-euroregionie-pradziad/czlonkowie/gminy-polskie/",
    ),
    # ZWIĄZEK GMIN POMORSKICH
    "0000055250": Members(
        "Gminas only: 89 in September 2019; statute §9: ordinary members are gminas",
        (
            "https://rada.wladyslawowo.pl/pliki/wladyslawowo/zalaczniki/671/zal-nr-1-do"
            "-iv-65-2024.pdf"
        ),
    ),
    # STOWARZYSZENIE GMIN I POWIATÓW WIELKOPOLSKI
    "0000062601": Members(
        (
            "179: 154 gminas and cities including Poznań, and 25 powiats; statute §8: "
            "the association groups gminas and powiats"
        ),
        "https://sgipw.wlkp.pl/cms/8563/czlonkowie",
    ),
    # STOWARZYSZENIE GMIN POLSKICH EUROREGIONU "PRO EUROPA VIADRINA"
    "0000078219": Members(
        "28 gminas and 3 powiats of northern Lubuskie; statute §10: gminas and powiats",
        "https://www.euroregion-viadrina.pl/czlonkowie.html",
    ),
    # ZWIĄZEK GMIN I POWIATÓW SUBREGIONU ZACHODNIEGO WOJEWÓDZTWA ŚLĄSKIEGO Z SIEDZIBĄ W
    # RYBNIKU
    "0000107150": Members(
        (
            "28: 25 gminas and cities and 3 powiats; an ordinary member can only be a "
            "gmina or powiat of the subregion"
        ),
        "https://subregion.pl/stowarzyszenie/czlonkowie/",
    ),
    # FEDERACJA REGIONALNYCH ZWIĄZKÓW GMIN I POWIATÓW RP
    "0000227293": Members(
        (
            "18 regional associations of local governments (SGiPM, Związek Gmin "
            "Pomorskich, SGU RP, PSST, Związek Miast i Gmin Morskich...), together..."
        ),
        "https://lubliniec.starostwo.gov.pl/pobierz/309aea457b8f49864e35df8e5263b28f",
    ),
    # STOWARZYSZENIE GMIN GÓRNICZYCH W POLSCE
    "0000041508": Members(
        (
            "21 gminas listed as members by a KRS-data aggregator (Bestwina, Bieruń, "
            "Czerwionka-Leszczyny, Gierałtowice, Pszów, Radlin, Wałbrzych,..."
        ),
        "https://krs-pobierz.pl/gmin-gorniczych-w-polsce-i0000041508",
    ),
    # STOWARZYSZENIE AGLOMERACJA WROCŁAWSKA
    "0000476062": Members(
        (
            "35 gminas and powiats of the Wrocław agglomeration; statute §8: gminas and"
            " powiats"
        ),
        (
            "https://www.oborniki-slaskie.pl/sites/default/files/projekt_aglomeracja_wr"
            "oclawska.pdf"
        ),
    ),
    # STOWARZYSZENIE "EUROREGION NIEMEN"
    "0000060828": Members(
        "35: the Podlaskie województwo, 6 powiats, 6 cities and 22 gminas",
        "https://niemen.org.pl/czlonkowie/",
    ),
    # KUJAWSKO-POMORSKIE SAMORZĄDOWE STOWARZYSZENIE SALUTARIS
    "0000438932": Members(
        (
            "108 members, local government units paying per-resident fees (gminas, "
            "powiats, the województwo)"
        ),
        (
            "https://bip.kujawsko-pomorskie.pl/download/attachment/83667/informacja-o-d"
            "zialalnosci-kujawsko-pomorskiego-samorzadowego-stowarzyszenia-salutaris.pd"
            "f"
        ),
    ),
    # ZRZESZENIE GMIN WOJEWÓDZTWA LUBUSKIEGO
    "0000003707": Members(
        "all 82 gminas of the Lubuskie voivodeship",
        (
            "https://lubuskie.pl/wiadomosci/25046/dialog-i-zintegrowane-dzialania-to-kl"
            "ucz-do-rozwoju-lubuskiego-.pdf"
        ),
    ),
    # STOWARZYSZENIE POWIATÓW I GMIN DORZECZA BZURY
    "0000130227": Members(
        (
            "powiats and gminas of the Bzura basin; registered statute clause: 'jest "
            "stowarzyszeniem jednostek samorządu terytorialnego związanych z..."
        ),
        "https://rejestr.io/krs/0000130227",
    ),
    # STOWARZYSZENIE JEDNOSTEK SAMORZĄDU TERYTORIALNEGO NA RZECZ BUDOWY DRÓG
    # EKSPRESOWYCH S-8
    "0000314359": Members(
        "gminas and powiats along the S-8 and S-14 routes; no list or count found",
        "https://www.gov.pl/attachment/b25a00be-a04a-4cc1-b6f1-2bf37f9ad849",
    ),
    # METROPOLIA POZNAŃ
    "0000384961": Members(
        "23 local governments: Miasto Poznań, Powiat Poznański and 21 gminas and towns",
        "https://www.metropoliapoznan.pl/o-nas",
    ),
    # STOWARZYSZENIE AGLOMERACJA KONIŃSKA
    "0000929270": Members(
        "16: Miasto Konin, Powiat Koniński and 14 gminas",
        "https://aglomeracjakoninska.org/o-nas/czlonkowie/",
    ),
    # STOWARZYSZENIE GMIN RZECZYPOSPOLITEJ POLSKIEJ REGION KOZŁA
    "0000164296": Members(
        "6 gminas: Babimost, Kargowa, Siedlec, Zbąszyń, Zbąszynek, Trzciel",
        "https://pl.wikipedia.org/wiki/Region_Kozła",
    ),
    # STOWARZYSZENIE SĄDECKI OBSZAR FUNKCJONALNY
    "0000914712": Members(
        "17: Miasto Nowy Sącz and 16 gminas of powiat nowosądecki",
        "https://gminagrybow.pl/edc_media/Manager/Projekt-strategii-zit-sof.pdf",
    ),
    # STOWARZYSZENIE GMIN "MAŁE TRÓJMIASTO KASZUBSKIE"
    "0000051326": Members(
        "3 towns: Wejherowo, Reda, Rumia",
        "https://pl.wikipedia.org/wiki/Małe_Trójmiasto_Kaszubskie",
    ),
    # STOWARZYSZENIE AGLOMERACJA KALISKO-OSTROWSKA
    "0000547613": Members(
        (
            "25 local governments: Kalisz, Ostrów Wielkopolski, 7 urban-rural and 13 "
            "rural gminas, 3 powiats"
        ),
        "https://sako-info.pl/o-nas/czlonkowie/",
    ),
    # WIELKOPOLSKI OŚRODEK KSZTAŁCENIA I STUDIÓW SAMORZĄDOWYCH
    "0000078584": Members(
        (
            "279 local governments: 249 gminas from six voivodeships and 30 "
            "Wielkopolska powiats; statute: ordinary members are local government units"
        ),
        "http://www2.wokiss.pl/o-wokiss/",
    ),
    # STOWARZYSZENIE GMIN I POWIATÓW ZLEWNI RZEKI JEZIORKI
    "0000036195": Members(
        "12: powiats grójecki, piaseczyński, żyrardowski and 9 gminas",
        (
            "https://www.konstancinjeziorna.pl/news/zastepczyni-burmistrza-nowa-prezesk"
            "a-zarzadu-krainy-jeziorki"
        ),
    ),
    # STOWARZYSZENIE ZDROWYCH MIAST POLSKICH
    "0000196073": Members(
        "38 cities and gminas; statute § 6: ordinary members are gminas or powiats",
        "https://www.szmp.pl/staff",
    ),
    # STOWARZYSZENIE GORLICKI OBSZAR FUNKCJONALNY
    "0000930319": Members(
        (
            "3 gminas: Miasto Gorlice, Gmina Gorlice, Gmina Sękowa (its founders, "
            "October 2021)"
        ),
        "https://gof.gorlice.pl/o-nas/",
    ),
    # ZWIĄZEK MIAST I GMIN NADWIŚLAŃSKICH
    "0000062847": Members(
        (
            "cities on the Vistula, 24 in 2013 (named Związek Miast Nadwiślańskich "
            "until its statute was rewritten in 2026)"
        ),
        (
            "https://mst-solec-kujawski.arch.rbip.mojregion.info/wp-content/uploads/sit"
            "es/122/2012/07/statut_ZMN_2012.pdf"
        ),
    ),
    # STOWARZYSZENIE SAMORZĄDÓW POWIATU TOMASZOWSKIEGO
    "0000064144": Members(
        (
            "all local governments of powiat tomaszowski (Lubelskie): the powiat and "
            "its gminas; founders were Powiat Tomaszowski, Miasto Tomaszów..."
        ),
        (
            "https://www.kronikatygodnia.pl/artykul/56593,jubileusz-stowarzyszenia-samo"
            "rzadow-powiatu-tomaszowskiego-wspolnie-dzialaja-od-25-lat"
        ),
    ),
    # STOWARZYSZENIE GMIN ZACHODNIEGO MAZOWSZA MAZOVIA
    "0000211876": Members(
        (
            "7 gminas: Błonie, Brwinów, Leszno, Michałowice, Milanówek, Nadarzyn, "
            "Podkowa Leśna"
        ),
        "https://www.brwinow.pl/aktualnosci/839-20-lecie-stowarzyszenia-mazovia.html",
    ),
    # STOWARZYSZENIE JEDNOSTEK SAMORZĄDU TERYTORIALNEGO NA RZECZ BUDOWY DROGI
    # EKSPRESOWEJ S-12
    "0000266482": Members(
        (
            "17 local governments: powiats sieradzki, piotrkowski, zwoleński, "
            "jarociński; Radom, Pionki; gminas Sulejów, Opatówek, Jaraczewo, Zwoleń,..."
        ),
        (
            "https://wartowiedziec.pl/komunikacja-i-transport/32550-samorzdy-na-rzecz-b"
            "udowy-drogi-ekspersowej-s12"
        ),
    ),
    # MAZOWIECKIE STOWARZYSZENIE GMIN NA RZECZ ROZWOJU SPOŁECZEŃSTWA INFORMACYJNEGO
    "0000306210": Members(
        (
            "Mazowsze gminas; founders (Sochaczew, February 2008) included Błonie, "
            "Ciechanów, Gostynin, Grodzisk Mazowiecki, Kozienice, Legionowo and..."
        ),
        "https://mssi.pl/o-nas/",
    ),
    # STOWARZYSZENIE SAMORZĄDÓW EUROREGION ROZTOCZE
    "0000846540": Members(
        (
            "local governments of Roztocze in Lubelskie and Podkarpackie (Powiat "
            "Tomaszowski sits on its board); no count or full list found"
        ),
        (
            "https://www.zpp.pl/storage/library/2024-08/169f1d8c40f4a97ff6203f3aaef49c7"
            "d.pdf"
        ),
    ),
    # STOWARZYSZENIE OBSZARU PROWADZENIA POLITYKI TERYTORIALNEJ POWIATU INOWROCŁAWSKIEGO
    "0001015510": Members(
        (
            "7: Powiat Inowrocławski (leader) and gminas Kruszwica, Janikowo, Pakość, "
            "Złotniki Kujawskie, Gniewkowo, Dąbrowa Biskupia"
        ),
        (
            "https://cms-v2-files.idcom-jst.pl/sites/12/wiadomosci/120987/files/za._1_s"
            "trategia_terytorialna_oppt_inowrocawia-2025_08_15.pdf"
        ),
    ),
    # POROZUMIENIE GMIN GÓRSKICH RZECZYPOSPOLITEJ POLSKIEJ
    "0001040259": Members(
        (
            "mountain gminas meeting statutory conditions, reported as close to 20, "
            "e.g. Szczyrk, Wisła, Istebna, Świeradów-Zdrój, Duszniki-Zdrój,..."
        ),
        "https://wiadomosci.ox.pl/istebna-tez-za-porozumieniem,85770",
    ),
    # PODKARPACKIE STOWARZYSZENIE SAMORZĄDÓW TERYTORIALNYCH
    "0000008338": Members(
        (
            "147 Podkarpackie local governments: the województwo, 18 powiats, 15 "
            "cities, 28 urban-rural gminas, 85 rural gminas"
        ),
        "https://psst.rzeszow.pl/index.php/czlonkostwo/czlonkowie",
    ),
    # STOWARZYSZENIE GMIN DORZECZA GÓRNEJ ODRY Z SIEDZIBĄ W RACIBORZU
    "0000004694": Members(
        (
            "22 gminas of powiats raciborski, głubczycki, rybnicki and wodzisławski "
            "(Polish side of Euroregion Silesia)"
        ),
        "https://www.euroregion-silesia.pl/index,czlonkowie-strony-polskiej,31.html",
    ),
    # STOWARZYSZENIE GMIN RZECZYPOSPOLITEJ POLSKIEJ EUROREGION BAŁTYK
    "0000042453": Members(
        (
            "43: 42 gminas of Pomorskie and Warmińsko-Mazurskie (incl. Gdańsk, Gdynia, "
            "Elbląg, Olsztyn) and Powiat Bartoszycki"
        ),
        (
            "https://eurobalt.org.pl/stowarzyszenie-gmin-rp-euroregion-baltyk/gminy-czl"
            "onkowskie-stowarzyszenia-gmin-rp-euroregionu-baltyk/"
        ),
    ),
    # STOWARZYSZENIE GMIN, POWIATÓW I WOJEWÓDZTW "DROGA S11"
    "0000271208": Members(
        (
            "55 gminas, powiats and województwa along the planned S11 in "
            "Zachodniopomorskie, Wielkopolskie, Opolskie and Śląskie (59 in 2016)"
        ),
        "https://www.koszalin.pl/pl/printpdf/10774",
    ),
    # STOWARZYSZENIE METROPOLIA KRAKOWSKA
    "0000514292": Members(
        (
            "15 gminas: Kraków and Biskupice, Czernichów, Igołomia-Wawrzeńczyce, "
            "Kocmyrzów-Luborzyca, Liszki, Michałowice, Mogilany, Niepołomice,..."
        ),
        "http://www.metropoliakrakowska.pl/stowarzyszenie/o-nas",
    ),
    # STOWARZYSZENIE SAMORZĄDÓW EUROREGIONU "BUG"
    "0000047411": Members(
        (
            "65 Lubelskie local governments per the site (62 listed): Województwo "
            "Lubelskie, 4 powiats (bialski, łęczyński, parczewski, włodawski),..."
        ),
        "https://euroregionbug.pl/czlonkowie-stowarzyszenia/",
    ),
    # ZWIĄZEK GMIN I POWIATÓW SUBREGIONU CENTRALNEGO WOJEWÓDZTWA ŚLĄSKIEGO
    "0000485018": Members(
        "81 gminas and powiats of Śląskie",
        "https://subregioncentralny.pl/o-nas",
    ),
    # ZWIĄZEK GMIN I POWIATÓW SUBREGIONU PÓŁNOCNEGO WOJEWÓDZTWA ŚLĄSKIEGO
    "0000821458": Members(
        (
            "34: 31 gminas (incl. Częstochowa, Myszków, Kłobuck) and 3 powiats "
            "(częstochowski, kłobucki, myszkowski)"
        ),
        "https://www.subregion-polnocny.pl/stowarzyszenie/czlonkowie/",
    ),
    # ZWIĄZEK MIAST I GMIN MORSKICH
    "0000045355": Members(
        (
            "27 coastal cities and gminas (e.g. Gdańsk, Gdynia, Sopot, Szczecin, "
            "Świnoujście, Kołobrzeg, Elbląg, Hel, Łeba)"
        ),
        "https://zmigm.org.pl/delagaci-2024-2029/",
    ),
    # ZWIĄZEK MIAST POLSKICH
    "0000069153": Members(
        "390 cities",
        "https://pl.wikipedia.org/wiki/Związek_Miast_Polskich",
    ),
    # ZWIĄZEK POWIATÓW POLSKICH
    "0000094303": Members(
        "315 powiats and cities with powiat rights",
        "https://pl.wikipedia.org/wiki/Związek_Powiatów_Polskich",
    ),
    # ZWIĄZEK SAMORZĄDÓW POLSKICH
    "0000689669": Members(
        "gminas, powiats and województwa, over 100 members in 2023",
        "https://api.sejm.gov.pl/sejm/term9/prints/3284/3284.pdf",
    ),
    # ZWIĄZEK WOJEWÓDZTW RZECZYPOSPOLITEJ POLSKIEJ
    "0000117252": Members(
        "all 16 województwa",
        "https://pl.wikipedia.org/wiki/Związek_Województw_Rzeczypospolitej_Polskiej",
    ),
    # ŁÓDZKI OBSZAR METROPOLITALNY
    "0000511578": Members(
        (
            "27: Miasto Łódź, 4 powiats (brzeziński, łódzki wschodni, pabianicki, "
            "zgierski) and 22 gminas, as founding members"
        ),
        "https://www.lom.lodz.pl/wp-content/uploads/Statut_tekst_jedn_29_09_22.pdf",
    ),
    # ŚLĄSKI ZWIĄZEK GMIN I POWIATÓW
    "0000070883": Members(
        "170: 154 gminas and 16 powiats of Śląskie",
        "https://silesia.org.pl/gminy-i-powiaty/",
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
