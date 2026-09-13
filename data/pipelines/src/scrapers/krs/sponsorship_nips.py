"""The sponsorship recipients the wykaz could not turn into a KRS number.

`scrapers.krs.nip_lookup` resolves a NIP through the Ministry of Finance's
wykaz podatnikow VAT, and that channel has one structural blind spot: it holds
only **VAT-registered** entities. A foundation below the VAT threshold is
absent from it entirely -- by NIP and by REGON alike, both of which answer
``subject: null`` rather than erroring, so the miss looks like an answer.

That blind spot lands squarely on the population this work is about. Measured
over the 2025 and 2026 "pakiet promocyjny" lists (2,205 contracts, 71.8 m PLN,
1,156 distinct NIPs):

* the wykaz resolved **254** recipients to a KRS number;
* **361** more state a KRS legal form in their own registered name --
  fundacje, stowarzyszenia, kluby, OSP, spolki -- and resolved to nothing;
* those 361 carry **18,138,274.00 PLN**.

The worked example is Fundacja "Bez Granic" (NIP 7743261776, REGON 389262158,
6 contracts, 92,700 PLN). A foundation is necessarily in KRS, and the wykaz
holds nothing for it either way.

Four further NIPs matched the same description and are **deliberately not
here**, because they fail their own check digit: 7743528969, 5231844247, and
8211709997 / 8211809998. The last two are misspellings of Agencja Rozwoju
Miasta Siedlce, which resolved correctly from its third, valid NIP (KRS
0000221599) -- so they are typos in the published spreadsheet rather than
companies we are missing, and asking rejestr.io about them would buy four calls
that can only fail. Their 106,600 PLN is real money against a body we already
hold.

So this is the worklist for a channel the automated path did not have when it
was written. It has one now: `scrapers.krs.search.search_subjects` posts to the
register's own search, which takes a NIP, spans both `P` and `S`, and is free.
``src/scripts/sponsorship_rejestrio.py resolve`` walks this list through it and
files every answer in the crawled bucket, so the resolution happens once and a
rerun reads it back. Fundacja "Bez Granic" resolves to KRS 0000907937 that way.

Two things about that search are worth knowing before trusting it. It returns
**one row per register queried**, so a subject in both `P` and `S` arrives
twice with the same number -- `parse_search` collapses them, and reading the
row count as a subject count is what made this look unable to find the very
foundation it was written for. And it is throttled: `REQUEST_INTERVAL` between
calls, or answers start coming back empty, which is indistinguishable from "no
such NIP".

GUS BIR1 (api.stat.gov.pl) remains the alternative -- free, every registered
entity, SOAP, and a production key by email. Worth having if the search ever
closes, and unnecessary while it is open.

Ordered by contract value descending, so a run stopped halfway has covered the
money rather than an arbitrary third of the alphabet.

Hardcoded on purpose, for now. This is a measurement of one source on one day,
not something to derive at runtime: rebuilding it needs both spreadsheets and
38 of the wykaz's 100 daily requests, and the point of writing it down is that
nobody spends those again to learn which companies are still missing.
"""

import typing
from dataclasses import dataclass


@dataclass(frozen=True)
class Recipient:
    """One body that took sponsorship money and has no KRS number yet."""

    nip: str
    #: The registered name as the spreadsheet wrote it, trimmed of the address.
    #: Kept because it is what a human will search rejestr.io with.
    name: str
    #: Zloty across both years.
    paid: float
    contracts: int


#: The rejestr.io connection queries worth asking of a company once its KRS is
#: known. Both are needed and they are not interchangeable: `aktualne` is who
#: sits there now, `historyczne` is everyone who used to -- and a politician who
#: resigned the month before the money arrived is only in the second.
REJESTRIO_QUERIES = ("aktualne", "historyczne")

#: Zloty per rejestr.io call, matching `scrapers.krs.scrape.RejestrIOQuery.cost`.
PLN_PER_CALL = 0.05


def rejestrio_urls(krs: str, with_org_record: bool = False) -> tuple[str, ...]:
    """Both connection lists for one KRS number, and the org record on request.

    The org record is off by default: it carries no connections, and its name,
    city and teryt are already in the free api-krs odpis.
    """
    padded = str(krs).rjust(10, "0")
    base = f"https://rejestr.io/api/v2/org/{padded}"
    connections = tuple(
        f"{base}/krs-powiazania?aktualnosc={a}" for a in REJESTRIO_QUERIES
    )
    return (base, *connections) if with_org_record else connections


def cost_pln(companies: int, with_org_record: bool = False) -> float:
    """What asking rejestr.io about this many companies costs.

    Two calls each -- the connection lists, which are the only ones that carry
    people. ``with_org_record=True`` adds the company's own entry at 0.05 PLN
    more each, which is worth it only for rejestr.io's teryt.
    """
    per_company = len(REJESTRIO_QUERIES) + (1 if with_org_record else 0)
    return companies * per_company * PLN_PER_CALL


UNRESOLVED: tuple[Recipient, ...] = (
    Recipient("9710723801", "Fundacja Dobrych Serc „TAK”", 298900.00, 3),
    Recipient("7743294391", "Fundacja Dla Bezpieczeństwa", 257500.00, 9),
    Recipient("1182097476", "Fundacja na rzecz Rozwoju Polskiego Sportu", 250000.00, 4),
    Recipient("1181531002", "Fundacja „Świat Tańca”", 245000.00, 4),
    Recipient("5342494574", "Fundacja Muzeum Motoryzacji i Techniki", 244000.00, 4),
    Recipient("5662012542", "Stowarzyszenie Ciechanowski Klub Sportowy \"Jurand", 192000.00, 3),
    Recipient("7761649462", "Ludowy Klub Sportowy „Sparta” Mochowo", 188000.00, 5),
    Recipient("1251636144", "Klub Sportowy Akademia Młodego Piłkarza GOOL Sp. z o.o.", 180000.00, 5),
    Recipient("8231667872", "Fundacja „ITA”", 180000.00, 6),
    Recipient("9482633782", "Stowarzyszenie „Paczka Radomskich”", 180000.00, 3),
    Recipient("7582016295", "Ostrołęckie Towarzystwo Sportowe Korona", 179000.00, 3),
    Recipient("6010093348", "Fundacja Promocji i Rozwoju Zalewu Domaniowskiego", 174000.00, 3),
    Recipient("5222993725", "Fundacja Artystycznego Rozwoju Twórczości", 166000.00, 2),
    Recipient("9710683409", "Fundacja Promocji i Rozwoju \"Lepszy Gostynin", 162500.00, 5),
    Recipient("7742955206", "Agencja Reklamy MixDigital Nina Pawlewska", 152500.00, 4),
    Recipient("8212694738", "Stowarzyszenie im. Franciszka Ossolińskiego w Niwiskach", 150000.00, 5),
    Recipient("9710733372", "Stowarzyszenie Pozytywny Gostynin", 150000.00, 2),
    Recipient("5291857445", "Fundacja FineARTE", 148000.00, 6),
    Recipient("9482649748", "FUNDACJĄ „W GŁOWIE SIĘ NIE MIEŚCI”", 145000.00, 5),
    Recipient("9512566212", "Fundacja Pawła Zagumnego", 134000.00, 6),
    Recipient("7743222902", "Fundacja „VIVAT POLONIA!”", 130000.00, 3),
    Recipient("9482652360", "Stowarzyszenie Aktywności Społecznej", 130000.00, 4),
    Recipient("7582387962", "Fundacja OPERAKCJA", 129900.00, 1),
    Recipient("9511985160", "Agencja HHS Paweł Grabeus", 129900.00, 1),
    Recipient("1182232508", "Fundacja AWF Warszawa", 129000.00, 1),
    Recipient("5322051112", "IRIJ – Fundacja na rzecz Mazowieckiego Centrum Neuropsychiatrii", 129000.00, 1),
    Recipient("9710721647", "Agencja Rozwoju i Promocji Zamek Spółką z o. o.", 129000.00, 3),
    Recipient("9710736229", "Stowarzyszenie Sportowy Gostynin", 127000.00, 3),
    Recipient("7582401426", "Fundacja Serce Regionu", 125000.00, 3),
    Recipient("7743286842", "Stowarzyszenie Rozwijamy Skrzydła", 125000.00, 4),
    Recipient("9482641511", "Fundacja Bliskościowa", 125000.00, 4),
    Recipient("7743295775", "Stowarzyszenie FutbolGang 2019", 124500.00, 3),
    Recipient("9710735767", "Stowarzyszenie Pokochaj Gostynin", 124000.00, 3),
    Recipient("5311724932", "Stowarzyszenie LEO", 120000.00, 1),
    Recipient("7761708880", "Stowarzyszenie Zielony Sierpc", 120000.00, 3),
    Recipient("7962127109", "Radomski Okręgowy Związek Piłki Nożnej", 120000.00, 2),
    Recipient("8212693466", "Stowarzyszenie Kultury Fizycznej Orlik Mokobody", 120000.00, 4),
    Recipient("9710735916", "Stowarzyszenie Kulturalny Gostynin", 120000.00, 3),
    Recipient("9710735922", "Stowarzyszenie Przyjazny Gostynin", 120000.00, 1),
    Recipient("7962875047", "„Łaźnia”- Radomski Klub Środowisk Twórczych i Galerią", 118750.00, 6),
    Recipient("7743295143", "Cristal Clean non profil sp. z o.o.", 115000.00, 4),
    Recipient("7010893144", "Fundacja Kultura i Historia", 114000.00, 1),
    Recipient("5211616031", "AGENCJA ARTYSTYCZNA JP", 110000.00, 4),
    Recipient("5253047129", "Fundacja Kultura Interaktywna", 110000.00, 1),
    Recipient("5661614405", "Towarzystwo Miłośników Ziemi Ciechanowskiej im. Dr Franciszka Rajkowskiego", 110000.00, 1),
    Recipient("1231267502", "Młodzieżowy Klub Sportowy Piaseczno", 107000.00, 3),
    Recipient("5272825102", "Fundacja Kultury i Sportu 44", 105000.00, 3),
    Recipient("5223027553", "Stowarzyszanie GROM", 103000.00, 4),
    Recipient("8212686957", "Stowarzyszenie Przyjaciół Zespołu Szkół Ponadpodstawowych nr 3 w Siedlcach; ul. ks. J. Popiełuszki 8; 08-110 Siedlce", 100500.00, 5),
    Recipient("7582061769", "Ogólnopolskie Stowarzyszenie Osób Niepełnosprawnych", 100000.00, 4),
    Recipient("7582390964", "Stowarzyszenie \"MOTOMIKOŁAJE OSTROŁĘKA", 100000.00, 2),
    Recipient("7743213429", "Fundacja Innowacji i Społeczeństwa Obywatelskiego", 100000.00, 1),
    Recipient("8212638390", "Siedleckie Stowarzyszenie Miłośników Techniki Zabytkowej KORBA", 100000.00, 2),
    Recipient("8262225425", "Stowarzyszenie Wspierające Rozwój Edukacyjno – Artystyczny", 100000.00, 3),
    Recipient("5252628700", "Fundacja Kasi Dulnik", 95000.00, 1),
    Recipient("8212241770", "Ochotnicza Straż Pożarna w Wólce Proszewskiej", 95000.00, 4),
    Recipient("8212699641", "Stowarzyszenie Zawsze Młodzi Gmina Mokobody", 95000.00, 4),
    Recipient("8241655712", "Towarzystwo Miłośników Ziemi Węgrowskiej", 95000.00, 3),
    Recipient("7743261776", "Fundacja \"Bez Granic", 92700.00, 6),
    Recipient("7743283430", "Stowarzyszenie Lepsze Jutro Mazowsza", 90200.00, 6),
    Recipient("1251698323", "Fundacja Kultura z Pasją", 90000.00, 2),
    Recipient("5291822843", "Fundacja W Podróży", 90000.00, 1),
    Recipient("8111769392", "Uczniowski Międzyszkolny Klub Sportowy „Orlęta” Zwoleń", 90000.00, 2),
    Recipient("8261474959", "Ochotnicza Straż Pożarna w Garwolinie", 90000.00, 3),
    Recipient("9452255683", "Fundacja SIMBIOSIS", 87000.00, 4),
    Recipient("7011032438", "Fundacja Dobrzy Ludzie, al. Jana Pawła II 20, 05-250 Radzymin", 86000.00, 4),
    Recipient("1231533323", "FLO-Fundacja Na Rzecz Leczenia Otyłości", 85000.00, 2),
    Recipient("5361980850", "Fundacja ,, Zielone Wzgórza''", 83300.00, 5),
    Recipient("7581949955", "Ochotnicza Straż Pożarna w Olszewie-Borkach", 83000.00, 3),
    Recipient("5252228219", "Izba Architektów Rzeczypospolitej Polskiej", 80000.00, 1),
    Recipient("5361995478", "Fundacja Kultura, Pasja, Ruch ul. Bolesława Chrobrego 50B, 05-120 Legionowo", 80000.00, 1),
    Recipient("8212614745", "Stowarzyszenie Rodziców Dzieci Niepełnosprawnych MGIEŁKA", 80000.00, 4),
    Recipient("8222423314", "Fundacja Musicalowa Akademia Talentów", 80000.00, 1),
    Recipient("8262210493", "Fundacja Pomocy Rodzinie Noela", 80000.00, 3),
    Recipient("6010086934", "Lokalne Stowarzyszenie Kobiet", 77500.00, 2),
    Recipient("7743236962", "Stowarzyszeniem „Pomagaj Pomagać Różaland”", 75000.00, 2),
    Recipient("8212233569", "Ochotnicza Straż Pożarna w Niwiskach", 75000.00, 3),
    Recipient("8212698558", "Stowarzyszenie Program Siedlce", 75000.00, 4),
    Recipient("7743258969", "Stowarzyszenie Aktywne Mazowsze", 70000.00, 3),
    Recipient("8381817824", "Fundacja Lwów i Kresy Południowo-Wschodnie", 68925.00, 2),
    Recipient("8111729286", "Stowarzyszenie „Dziedzictwo i Rozwój”", 66850.00, 4),
    Recipient("8211006274", "Katolickie Stowarzyszenie Młodzieży Diecezji Siedleckiej", 65000.00, 2),
    Recipient("8212644700", "Fundacja „Mazowiecka Micha Szlachecka”", 65000.00, 3),
    Recipient("7582371228", "fundacja Twój Kierunek", 62000.00, 3),
    Recipient("8212682238", "Fundacja NIEPRZECIĘTNI", 62000.00, 3),
    Recipient("5223360206", "Fundacja Freestyle Life", 60000.00, 1),
    Recipient("5342325854", "Stowarzyszenie Edukacji Rolniczej i Leśnej Europea Polska", 60000.00, 1),
    Recipient("7582356223", "Stowarzyszenie Przyjaciół Dzieci Niepełnosprawnych przy Specjalnym Ośrodku Szkolno - Wychowawczym w Ostrołęce \"Dajmy Im Radość", 60000.00, 4),
    Recipient("7582377892", "Stowarzyszenie \"OSTROŁĘKA 5.0\" ul. Janusza Korczaka 4, 07-410 Ostrołęka", 60000.00, 2),
    Recipient("7743295002", "Agencja Eventowa IMPULS spółka z ograniczoną odpowiedzialnością", 60000.00, 2),
    Recipient("7962976096", "Stowarzyszenie Co Za Jazda", 60000.00, 1),
    Recipient("8212244981", "Ochotnicza Straż Pożarna w Kisielanach-Żmichach", 60000.00, 2),
    Recipient("8212453549", "Regionalne Stowarzyszenie Kulturalno-Oświatowym „Kornel”, Borki-Wyrki 17, 08-106 Zbuczyn", 60000.00, 2),
    Recipient("8212636669", "Ochotnicza Straż Pożara w Kownaciskach", 60000.00, 2),
    Recipient("8212665056", "Bajkowa Wyspa spółka z ograniczoną odpowiedzialnością", 60000.00, 2),
    Recipient("8212689022", "Stowarzyszenie Przyjaciół Siedleckiego Ekonomika", 60000.00, 2),
    Recipient("7963007637", "Chwałowickie Stowarzyszenie Na Rzecz Dzieci i Młodzieży z Niepełnosprawnościami „SERCE ZA SERCE”; Chwałowice 247, 27-100 Iłża", 59000.00, 3),
    Recipient("5311724412", "Stowarzyszenie \"Razem dla Powiatu Nowodworskiego", 57000.00, 3),
    Recipient("9482554829", "Stowarzyszenie „Wrzosowisko”", 55600.00, 3),
    Recipient("1251662006", "Fundacja Konkursu Historycznego Patria Nostra", 55000.00, 2),
    Recipient("5223192192", "Fundacja Instytut Aktywności", 55000.00, 3),
    Recipient("7591755891", "Uczniowski Klub Sportowy \"Wąsewska Wieża", 55000.00, 3),
    Recipient("7962200875", "Bokserskie Towarzystwo Sportowe 1926 „Broń” Radom", 55000.00, 2),
    Recipient("8212688376", "FUNDACJA DLA KAŻDEGO", 55000.00, 3),
    Recipient("8241793526", "Stowarzyszenie Edukacyjnym Ziemi Węgrowskiej", 55000.00, 1),
    Recipient("9482592824", "Uczniowski Klub Sportow \"Szkółka Piłkarska Talencik", 55000.00, 3),
    Recipient("1251053738", "Stowarzyszenie Bractwo Strzeleckie \"Salwa\" ul. Korsaka, 4- 05-200 Wołomin", 54000.00, 1),
    Recipient("8222213143", "Stowarzyszenie \"Jesteśmy Razem", 54000.00, 2),
    Recipient("1132783927", "Fundacja Kultury i Sztuki artHOLDING", 52000.00, 1),
    Recipient("7162844631", "Stowarzyszenie Liga Niezwykłych", 52000.00, 1),
    Recipient("5252962014", "Fundacja Formula Future Team Poland", 50640.00, 1),
    Recipient("1231558731", "Stowarzyszenie Dziki Zryw", 50000.00, 1),
    Recipient("5212937091", "Instytut Wiedzy i Umiejętności", 50000.00, 2),
    Recipient("5223184181", "FUNDACJA POLSKA AKADEMIA SPORTÓW LOTNICZYCH \"AVIATORNIA", 50000.00, 1),
    Recipient("5223230142", "Fundacja Polskiej Sztafety 4x400 M", 50000.00, 1),
    Recipient("5262759220", "Mazowiecki Związek Brydża Sportowego", 50000.00, 1),
    Recipient("5361972661", "Stowarzyszenie Wspierania Folkloru „Mazowsze Leśne”", 50000.00, 1),
    Recipient("7380010013", "Włodzimierz Słyś WS.art Agencja Artystyczna", 50000.00, 2),
    Recipient("7582389441", "Stowarzyszenie Przyjazne Osiedla Ostrołęka", 50000.00, 2),
    Recipient("7761711824", "Stowarzyszenie Lelice Inicjatywy Lokalne", 50000.00, 1),
    Recipient("8121926290", "Stowarzyszenie „Trochę Popkultury”", 50000.00, 1),
    Recipient("8121928248", "Stowarzyszenie Razem Dla Miasta i Gminy Głowaczów", 50000.00, 2),
    Recipient("8212103789", "Stowarzyszenie Kultury Fizycznej Powiatowe Zrzeszenie Ludowe Zespoły Sportowe", 50000.00, 2),
    Recipient("8212514452", "Ochotnicza Straż Pożarna w Osinach Dolnych", 50000.00, 2),
    Recipient("8212514469", "Ochotnicza Straż Pożarna w Świniarach", 50000.00, 2),
    Recipient("8222099345", "Ochotnicza Straż Pożarna w Latowiczu", 50000.00, 2),
    Recipient("8231674984", "Fundacja Promocji Sportu i Turystyki MPP", 50000.00, 1),
    Recipient("8262195960", "Stowarzyszenie Miłośników Piłki Nożnej Progres Garwolin, Celejów 11, 08-470 Wilga", 50000.00, 1),
    Recipient("8212645556", "Stowarzyszenie Triathlon Siedlce Club", 49000.00, 5),
    Recipient("7582095478", "Towarzystwo Przyjaciół Goworowszczyzny", 46200.00, 2),
    Recipient("4960181534", "Powiatowe Stowarzyszenie Animatorów Kultury w Łosicach", 45000.00, 2),
    Recipient("4960235891", "Ochotnicza Straż Pożarna w Mostowie", 45000.00, 2),
    Recipient("5311697891", "Stowarzyszenie Rozbiegamy Nowy Dwór Mazowiecki", 45000.00, 4),
    Recipient("5361945782", "Stowarzyszenie „Legionowo Live Art”", 45000.00, 1),
    Recipient("7582398813", "Stowarzyszenie \"Aktywni Razem", 45000.00, 3),
    Recipient("7971517287", "Klub Sportowy Warka", 45000.00, 2),
    Recipient("8212191931", "Ochotnicza Straż Pożarna w Podnieśnie", 45000.00, 2),
    Recipient("8212694282", "Stowarzyszenie Wybieram Hokej", 45000.00, 2),
    Recipient("8222182388", "Ochotnicza Straż Pożarna w Żakowie", 45000.00, 3),
    Recipient("8231481096", "Ochotnicza Straż Pożarna „CUKROWNIA” w Sokołowie Podlaskim", 45000.00, 2),
    Recipient("1132454081", "Międzyszkolny Uczniowski Klub Sportowy „Euro 6”", 44000.00, 2),
    Recipient("5223121921", "Stowarzyszenie Honorowych Dawców Krwi Legion", 42500.00, 2),
    Recipient("7591268174", "Miejski Klub Sportowy „Ostrowianka” w Ostrowi Mazowieckiej", 42000.00, 2),
    Recipient("7582108749", "Uczniowski Klub Sportowy \"Borki", 41000.00, 3),
    Recipient("1182150035", "Stowarzyszenie ATP Stare Babice", 40000.00, 1),
    Recipient("1231224881", "Fundacja Wspierania Kultury i Sztuki oraz promocji Polski \"Polski Znak", 40000.00, 1),
    Recipient("4960185940", "Ochotnicza Straż Pożarna w Bejdach, Bejdy 31A, 08-207 Olszanka", 40000.00, 2),
    Recipient("5110299267", "Stowarzyszenie Zwykłe „Dotyk Motyla”", 40000.00, 1),
    Recipient("5321844247", "Międzyszkolny Klub Sportowy Karczew", 40000.00, 1),
    Recipient("5361966117", "Taneczny Klub Sportowy Brothers Dance Studio", 40000.00, 1),
    Recipient("7582396257", "Fundacja MazoArt", 40000.00, 1),
    Recipient("7743288887", "FUNDACJA NIEMOŻLIWE STAJE SIĘ MOŻLIWE", 40000.00, 1),
    Recipient("7811908174", "Fundacja \"Szybciej - Wyżej - Dalej", 40000.00, 1),
    Recipient("7831685582", "Polski Związek Futbolu Stołowego", 40000.00, 1),
    Recipient("7962975926", "Stowarzyszenie Tango Radom", 40000.00, 2),
    Recipient("7962998123", "Fundacja Radom Arte", 40000.00, 1),
    Recipient("7963012874", "Klub Sportowy Jedlanka, Jedlanka 38m, 26-660 Jedlińsk", 40000.00, 1),
    Recipient("7972089439", "Stowarzyszenie Dragon Racing", 40000.00, 1),
    Recipient("8212554380", "Stowarzyszenie Ludowy Klub Sportowy Wektra Zbuczyn", 40000.00, 2),
    Recipient("8212695525", "Stowarzyszenie Steal Dart Siedlce", 40000.00, 2),
    Recipient("8221739050", "Ochotnicza Straż Pożarna w Kałuszynie", 40000.00, 2),
    Recipient("8221869031", "Towarzystwo Przyjaciół Ziemi Stanisławowskiej", 40000.00, 2),
    Recipient("8221941627", "Ochotnicza Straż Pożarna w Lubominie", 40000.00, 2),
    Recipient("8222055106", "Ochotnicza Straż Pożarną w Mlęcinie, Mlęcin 51B, 05-307 Dobre", 40000.00, 1),
    Recipient("8262227022", "Fundacja Spotkajmy się w Miastkowie", 40000.00, 1),
    Recipient("9482652696", "Fundacja \"Dziedzictwo Serca", 40000.00, 1),
    Recipient("9522235072", "Fundacja Żyj z Radością", 40000.00, 1),
    Recipient("8231672672", "Stowarzyszenie Przyjaciół Jabłonny Średniej", 39500.00, 2),
    Recipient("5662015753", "Stowarzyszenie Akademia Piłki Nożnej Olimp Ciechanów", 39000.00, 3),
    Recipient("7962999648", "Stowarzyszenie \"Teatr Resursa", 38000.00, 1),
    Recipient("9482644509", "Radomskie Otwarte Zwykłe Brydżowe Stowarzyszenie", 38000.00, 3),
    Recipient("7742751165", "Stowarzyszenie Przyjaciół Płockiego ZOO „Tapir”", 37000.00, 2),
    Recipient("5321716124", "Ochotnicza Straż Pożarna w Karczewie", 36000.00, 2),
    Recipient("8262211104", "Uczniowski Klub Sportowy Kordaszewscy Garwolin", 36000.00, 2),
    Recipient("1130800159", "Agencja Artystyczna Ministerstwo Gwiazd Dorota Wardyńska", 35000.00, 1),
    Recipient("8121929319", "Stowarzyszenie „Kuźnia Garbatki”", 35000.00, 2),
    Recipient("8211960497", "Izba Adwokacka w Siedlcach", 35000.00, 1),
    Recipient("8212651255", "Stowarzyszenie Aktywny Senior Gminy Zbuczyn", 35000.00, 2),
    Recipient("8212655721", "Stowarzyszenie Aktywnych Kobiet w Krzesku, Krzesk-Królowa Niwa 154, 08-111 Krzesk", 35000.00, 2),
    Recipient("8222119214", "Ochotnicza Straż Pożarna w Mistowie", 35000.00, 2),
    Recipient("5253037869", "Fundacja Trampolina Rozwoju", 34200.00, 3),
    Recipient("8261928751", "Ochotnicza Straż Pożarna w Parysowie", 33500.00, 2),
    Recipient("7591403436", "OSTROWSKI KLUB KARATE KYOKUSHINKAI", 32000.00, 2),
    Recipient("8241530212", "Węgrowski Klub Sportowy \"SFINKS", 31250.00, 2),
    Recipient("4960175798", "Ochotnicza Straż Pożarna w Lipnie", 30000.00, 2),
    Recipient("5213633128", "Mazowiecko-Warszawski Związek Kolarskim", 30000.00, 1),
    Recipient("5223288271", "Stowarzyszenie „Warszawa44”", 30000.00, 1),
    Recipient("5291842030", "Stowarzyszenie Aktorzy i Przyjaciele Teatru 36 zł", 30000.00, 1),
    Recipient("5311708146", "Stowarzyszenie Centrum Aktywności Lokalnej", 30000.00, 1),
    Recipient("5311725251", "Stowarzyszenie „Odnowa”", 30000.00, 1),
    Recipient("5361988001", "Stowarzyszenie Narew", 30000.00, 3),
    Recipient("7182119181", "Katolickim Stowarzyszeniem Młodzieży Diecezji Łomżyńskiej, pl. Jana Pawła II 1, 18-400 Łomża", 30000.00, 1),
    Recipient("7582327670", "Stowarzyszenie Mazowieckie Inicjatywy Społeczne", 30000.00, 1),
    Recipient("7622007234", "Stowarzyszenie Przyjaciół Rewii Dziecięcej „Sylaba”", 30000.00, 1),
    Recipient("7961085828", "MULTIAGENCJA Robert Wasiak", 30000.00, 1),
    Recipient("7962974016", "Stowarzyszenie Ag Tenis Chorzowska", 30000.00, 1),
    Recipient("7962982702", "Klub Sportowy Pop Gym Sport", 30000.00, 1),
    Recipient("7981393527", "Ochotnicza Straż Pożarna w Kaszowie", 30000.00, 1),
    Recipient("8111470807", "Towarzystwo Miłośników Miasta Zwolenia imienia Jana Kochanowskiego", 30000.00, 2),
    Recipient("8111726307", "Gminny Klub Sportowy „Iłżanka” Kazanów", 30000.00, 1),
    Recipient("8212115835", "Ogólnopolskie Stowarzyszenie Internowanych i Represjonowanych", 30000.00, 1),
    Recipient("8212195900", "Ochotnicza Straż Pożarna w Radzikowie Wielkim", 30000.00, 2),
    Recipient("8212241787", "Ochotnicza Straż Pożarna w Ziomakach", 30000.00, 1),
    Recipient("8212526455", "Ludowy Klub Sportowy „Grodzisk” Krzymosze", 30000.00, 1),
    Recipient("8212678716", "Jakub Okniński Agencja Reklamowa Pagadi", 30000.00, 2),
    Recipient("8212692604", "Stowarzyszenie Przyjaciół Doliny Liwca", 30000.00, 2),
    Recipient("8221717309", "Stowarzyszenie Ochotnicza Straż Pożarna w Wiśniewie", 30000.00, 2),
    Recipient("8221785802", "Ochotnicza Straż Pożarna w Ładzyniu", 30000.00, 1),
    Recipient("8222032542", "Ochotnicza Straż Pożarna w Łaziskach", 30000.00, 2),
    Recipient("8241593342", "Ochotnicza Straż Pożarna w Baczkach, Baczki 134, 07-130 Łochów", 30000.00, 1),
    Recipient("9482278950", "Ochotnicza Straż Pożarna w Dębie", 30000.00, 1),
    Recipient("9482637952", "Fundacja Guzowianki", 30000.00, 1),
    Recipient("9482643042", "Fundacja Podróżnicza Górołaz", 30000.00, 1),
    Recipient("9710722227", "Klub Sportowy \"Błyskawica\" Lucień, Lucień 62, 09-500 Gostynin", 30000.00, 1),
    Recipient("7591755750", "Fundacja Venator Polska", 29000.00, 1),
    Recipient("5262294399", "Fundacja \"Świat na Tak", 28500.00, 1),
    Recipient("1251343324", "Klub Sportowy Fanaberia", 28000.00, 1),
    Recipient("1251618258", "Ochotnicza Straż Pożarna w Nadmie", 27000.00, 1),
    Recipient("5291690353", "Stowarzyszenie Gmin Zachodniego Mazowsza MAZOVIA", 27000.00, 3),
    Recipient("5361989590", "Fundacja Human Freedom", 27000.00, 1),
    Recipient("7582385354", "Stowarzyszenie AS", 27000.00, 2),
    Recipient("8222167302", "Ochotnicza Straż Pożarna w Olszewicach", 27000.00, 2),
    Recipient("1251790750", "Fundacja Healthy Habits", 26000.00, 2),
    Recipient("7761713415", "Stowarzyszenie „Mroczydła”", 25150.00, 1),
    Recipient("1130738874", "Agencja Artystyczna „LAURA” Laura Łącz", 25000.00, 2),
    Recipient("5321340133", "Agencja Reklamowa 220V PIOTR STEFAŃSKI", 25000.00, 1),
    Recipient("5321614464", "Ludowy Klub Sportowy Mazur Karczew", 25000.00, 1),
    Recipient("7582338484", "Ostrołęckie Stowarzyszenie Promocji Zdrowia i Trzeźwości \"ARKADIA", 25000.00, 3),
    Recipient("7591617189", "Ostrowskie Towarzystwo Inicjatyw Kulturalno-Oświatowych \"OTIKO", 25000.00, 1),
    Recipient("7962959726", "Stowarzyszenie „Biegiem Radom!”", 25000.00, 1),
    Recipient("8212304619", "Stowarzyszenie Ochotnicza Straż Pożarna w Czerniejewie", 25000.00, 1),
    Recipient("8222343963", "Ochotnicza Straż Pożarna w Falbogach", 25000.00, 1),
    Recipient("8241736729", "Ochotnicza Straż Pożarna w Gałkach", 25000.00, 1),
    Recipient("9482493476", "UCZNIOWSKI KLUB SPORTOWY \"TECHNIK\"; ul. Bolesława Limanowskiego 26/30, 26-600 Radom", 25000.00, 1),
    Recipient("9482613756", "Stowarzyszenie Radomskie Klasyki", 25000.00, 2),
    Recipient("9512330780", "Stowarzyszenie HATO JUDO", 25000.00, 1),
    Recipient("8121922820", "Fundacja KOLBE", 22500.00, 1),
    Recipient("9710502112", "Ochotnicza Straż Pożarna w Łącku", 22000.00, 1),
    Recipient("5252358436", "Fundacja Polonia Union", 21909.00, 2),
    Recipient("1231008605", "Klub Sportowy Orzeł Baniocha", 20000.00, 1),
    Recipient("4960164984", "Towarzystwo Przyjaciół Ziemi Łosickiej", 20000.00, 1),
    Recipient("5242807269", "Mazowiecki Związek Tańca Sportowego", 20000.00, 1),
    Recipient("5252687358", "Polska Fundacja Zabezpieczenia Społecznego ETOS", 20000.00, 1),
    Recipient("5272838116", "Fundacja Across Music Foundation", 20000.00, 2),
    Recipient("5311711473", "Stowarzyszenie Aktywni Dla Mazowsza", 20000.00, 2),
    Recipient("5311726090", "Stowarzyszenie „Działajmy Razem”", 20000.00, 1),
    Recipient("7581899720", "Paweł Wędracki \"Pro Agencja", 20000.00, 1),
    Recipient("7582249674", "Ostrołęckie Stowarzyszenie Tenisowe", 20000.00, 1),
    Recipient("7582360561", "INTEGRACYJNY KLUB SPORTOWY „RAZEM”", 20000.00, 1),
    Recipient("7582391107", "Fundacja Kynologiczna Psiogress", 20000.00, 2),
    Recipient("7742810525", "Ludowy Klub Sportowy Wicher Cieszewo", 20000.00, 1),
    Recipient("7962690141", "Stowarzyszenie „Owadów – Wieś z Przyszłością”, Owadów 130, 26-631 Jastrzębia", 20000.00, 1),
    Recipient("7962979350", "Fundacja \"Nie rób dymu", 20000.00, 1),
    Recipient("7971870687", "Ochotnicza Straż Pożarna w Laskach, Laski 4A, 05-660 Warka", 20000.00, 1),
    Recipient("8212173761", "Ochotnicza Straż Pożarna w Woli Suchożebrskiej", 20000.00, 1),
    Recipient("8212195892", "Ochotnicza Straż Pożarna w Wyczółkach", 20000.00, 1),
    Recipient("8212225972", "Ochotnicza Straż Pożarna w Grochówce", 20000.00, 1),
    Recipient("8212544275", "Stowarzyszeniem Kulturalno-Oświatowym NADZIEJA", 20000.00, 1),
    Recipient("8212636327", "Ochotnicza Straż Pożarna w Teodorowie", 20000.00, 1),
    Recipient("8212692107", "Stowarzyszenie Przyjaciół Policji", 20000.00, 1),
    Recipient("8221951962", "Ochotnicza Straża Pożarna w Starej Niedziałce", 20000.00, 1),
    Recipient("8221965987", "Ochotnicza Straż Pożarna w Stanisławowie", 20000.00, 1),
    Recipient("8221971516", "Ochotnicza Straż Pożarna w Mieni", 20000.00, 1),
    Recipient("8222012404", "Ochotnicza Straż Pożarna w Rządzy", 20000.00, 1),
    Recipient("8222077450", "UCZNIOWSKO-PARAFIALNO-LUDOWY KLUB SPORTOWY \"TĘCZA\" STANISŁAWÓW", 20000.00, 1),
    Recipient("8222187919", "Ochotnicza Straż Pożarna w Guzewie przy ulicy Strażackiej 7, 05-320 Guzew", 20000.00, 1),
    Recipient("8222217460", "Ochotnicza Straż Pożarna w Brzozowicy", 20000.00, 1),
    Recipient("8231490190", "Ochotnicza Straż Pożarna w Skrzeszewie", 20000.00, 1),
    Recipient("8231566415", "Stowarzyszenie Rozwoju i Promocji Kultury, Sportu i Rekreacji Gminy Jabłonna Lacka „Jabłoń”", 20000.00, 1),
    Recipient("8261912566", "Ochotnicza Straż Pożarna w Woli Miastkowskiej", 20000.00, 1),
    Recipient("8261953482", "Ochotnicza Straż Pożarna w Pilawie, al. Wyzwolenia 124, 08-440 Pilawa", 20000.00, 1),
    Recipient("8261986501", "Ochotnicza Straż Pożarna w Woli Starogrodzkiej", 20000.00, 1),
    Recipient("8262057821", "Ochotnicza Straż Pożarna w Garwolinie Leszczynach", 20000.00, 1),
    Recipient("8262075109", "Ochotnicza Straż Pożarna w Woli Życkiej", 20000.00, 1),
    Recipient("8381372256", "Żyrardowskie Towarzystwo Cyklistów", 20000.00, 1),
    Recipient("8561874568", "Fundacja Kultury Bezpieczeństwa", 20000.00, 1),
    Recipient("9482642686", "STOWARZYSZENIE SPORT 4EVER", 20000.00, 1),
    Recipient("9522246124", "Wawerskie Stowarzyszenie Sportowe", 20000.00, 1),
    Recipient("7962893915", "Stowarzyszenie Zakrzewiaki", 19000.00, 1),
    Recipient("8212636847", "Stowarzyszenie Edukacyjno-Krajoznawcze „TRAMP-EK”", 18000.00, 1),
    Recipient("8222397060", "Fundacja Kultura na Okrągło", 18000.00, 1),
    Recipient("9512475449", "Stowarzyszenie Ninja Academy Warszawa", 18000.00, 1),
    Recipient("5361725052", "Stowarzyszenie \"Młodzi Dla Rozwoju - EMKA", 17500.00, 1),
    Recipient("4960254204", "Stowarzyszenie „Korniczanki”", 17000.00, 1),
    Recipient("4960148502", "Ochotnicza Straż Pożarna w Starych Szpakach", 15000.00, 1),
    Recipient("4960157843", "Ochotnicza Straż Pożarna w Platerowie", 15000.00, 1),
    Recipient("4960187784", "Ochotnicza Straż Pożarna w Starych Łepkach", 15000.00, 1),
    Recipient("4960234041", "Stowarzyszenie Rozwoju Wsi Mostów", 15000.00, 1),
    Recipient("4960247598", "Stowarzyszenie \"Szkoła w Szydłówce", 15000.00, 1),
    Recipient("4960258426", "Fundacja iKropka, Wyczółki 14, 08-207 Olszanka", 15000.00, 1),
    Recipient("5252895128", "Stowarzyszenie Polska Siatkówka Masters i Amator, al. Solidarności 117 lok. 207, 00-140 Warszawa", 15000.00, 1),
    Recipient("5311727310", "Fundacja Grupa Modlin", 15000.00, 1),
    Recipient("7582143473", "Stowarzyszenie Osób i Rodziców Dzieci Niepełnosprawnych \"Jesteśmy Betanią", 15000.00, 1),
    Recipient("7582388878", "Ludowy Klub Sportowym „Kurpie”, Olszewka 80, 07-402 Lelis", 15000.00, 2),
    Recipient("7591693546", "Stowarzyszenie - Ziemia Wąsewska", 15000.00, 1),
    Recipient("7621032715", "ANDRZEJ RĘBOWSKI KLUB \"2012\" PRZY TOWARZYSTWIE OLIMPIJCZYKÓW POLSKICH", 15000.00, 1),
    Recipient("7742752070", "Stowarzyszenie Pomocowe w Zakrzewie \"Bliżej Siebie", 15000.00, 2),
    Recipient("7742949453", "Stowarzyszenie Lokalna Grupa Działania \"Razem Dla Rozwoju", 15000.00, 1),
    Recipient("7981300520", "Związek Gmin Radomka", 15000.00, 1),
    Recipient("8212155125", "Ochotnicza Straż Pożarna w Ozorowie, Ozorów 47, 08-114 Skórzec", 15000.00, 1),
    Recipient("8212171561", "Ochotnicza Straż Pożarna w Wiśniewie", 15000.00, 1),
    Recipient("8212652177", "Stowarzyszenie Ochotnicza Straż Pożarna w Dąbrowie", 15000.00, 1),
    Recipient("8212668959", "Fundacja Instytut Art", 15000.00, 1),
    Recipient("8212695778", "Fundacja Zagroda nad Witką", 15000.00, 1),
    Recipient("8221928101", "Ochotnicza Straż Pożarna RYNIA", 15000.00, 1),
    Recipient("8221971551", "Ochotnicza Straż Pożarna Kędzierak w Mińsku Mazowieckim", 15000.00, 1),
    Recipient("8222012462", "Stowarzyszenie \"Wspieranie Rozwoju Dziecka", 15000.00, 2),
    Recipient("8222330682", "Stowarzyszenie Przyjaciół Grzebowilka", 15000.00, 1),
    Recipient("8222351879", "Ochotnicza Straż Pożarna w Wąsach", 15000.00, 1),
    Recipient("8261884350", "Ochotnicza Straż Pożarna Stodzew", 15000.00, 1),
    Recipient("9482278967", "Ochotnicza Straż Pożarna we Wrzosie, Wrzos 24, 26-650 Przytyk", 15000.00, 1),
    Recipient("9482610278", "Stowarzyszenie Kolegium Odbudowy Zamku Królewskiego w Radomiu im. Króla Kazimierza Wielkiego", 15000.00, 1),
    Recipient("1251664614", "Fundacja Przyjaciele Marek", 14300.00, 1),
    Recipient("1182223722", "Uczniowski Klub Sportowy FLASH", 14000.00, 1),
    Recipient("5691897939", "Stowarzyszenie Joker Mława", 13000.00, 2),
    Recipient("7582365759", "Stowarzyszenie „Projekt Radomir”", 13000.00, 2),
    Recipient("7582382924", "Stowarzyszenie Kulturalna Ostrołęka", 13000.00, 2),
    Recipient("9482137014", "Międzyszkolny Klub Sportowy Wodnik", 12800.00, 1),
    Recipient("8261887041", "Ochotnicza Straż Pożarna w Żelechowie", 12600.00, 2),
    Recipient("8212290946", "Ochotnicza Straż Pożarna w Błogoszczy", 12500.00, 1),
    Recipient("4960171398", "OCHOTNICZA STRAŻ POŻARNA W OLSZANCE", 12000.00, 1),
    Recipient("7581955335", "Ochotnicza Strażą Pożarną w Łęgu Przedmiejskim", 12000.00, 1),
    Recipient("7582398747", "Stowarzyszenie Przyjaciół Szkoły Podstawowej im. Armii Krajowej w Drwęczy", 12000.00, 1),
    Recipient("7591742782", "Stowarzyszenie Klub Motocyklowy \"STAJNIA\" Małkinia Górna", 12000.00, 1),
    Recipient("8262230455", "Stowarzyszenie Inżynierów Garwolina", 12000.00, 1),
    Recipient("5090066665", "Klub Sportowy „Video” w Ciepielowie", 11500.00, 1),
    Recipient("4960148471", "Ochotnicza Straż Pożarna w Hruszniewie", 10000.00, 1),
    Recipient("4960233107", "Ochotnicza Straż Pożarna w Nowych Szpakach", 10000.00, 1),
    Recipient("5213630880", "Warszawsko-Mazowieckim Okręgowy Związek Bokserski", 10000.00, 1),
    Recipient("5214054786", "Fundacja ArtGaja", 10000.00, 1),
    Recipient("6090083167", "Fundacja Polish Champs", 10000.00, 1),
    Recipient("7582400496", "Uczniowski Klub Sportowy Kurpiowskie Talenty", 10000.00, 1),
    Recipient("7582400674", "Stowarzyszenie Zwykłe ,,Przyjaciele Szkoły Podstawowej im. Jana Pawła II w Baranowie’’", 10000.00, 1),
    Recipient("7963010220", "Fundacja Po Sąsiedzku", 10000.00, 1),
    Recipient("8212155131", "Ochotnicza Straż Pożarna w Dąbrówce-Stanach", 10000.00, 1),
    Recipient("8212380135", "Ochotnicza Straż Pożarna w Czuryłach", 10000.00, 1),
    Recipient("8212512648", "Stowarzyszenie Kulturalno-Oświatowe \"Logos", 10000.00, 1),
    Recipient("8212597521", "Związek Zawodowy Rolników Polskich", 10000.00, 1),
    Recipient("8212635635", "Miejski Klub Rugby Pogoń Siedlce", 10000.00, 1),
    Recipient("8212677119", "Stowarzyszenie Aktywne Mokobody", 10000.00, 1),
    Recipient("8222081753", "Ochotnicza Straż Pożarna w Wężyczynie", 10000.00, 1),
    Recipient("8222346335", "Stowarzyszenie \"Nasza Wólka", 10000.00, 1),
    Recipient("8261877344", "Ochotnicza Straż Pożarna w Miętnem", 10000.00, 1),
    Recipient("8261887064", "Ochotnicza Straż Pożarna w Piastowie", 10000.00, 1),
    Recipient("8262208289", "Stowarzyszenie Sympatyków Klubu Seniora w Garwolinie", 10000.00, 1),
    Recipient("7582373150", "Stowarzyszenie Kurpiowska Akademia Sportowa", 9000.00, 1),
    Recipient("7962298503", "Integracyjny Klub Tenisa Stołowego „BROŃ” Radom", 9000.00, 1),
    Recipient("7582350485", "Klub Sportowy Orz Goworowo", 8800.00, 1),
    Recipient("8222355009", "Stowarzyszenie „Sport 4Kids”", 8000.00, 1),
    Recipient("9710734779", "Stowarzyszenie Grupa Motocyklowa Dolina Przysowy, Krubin 23, 09-540 Sanniki", 8000.00, 1),
    Recipient("1251798556", "Stowarzyszenie Międzyszkolny Klub Sportowy Ząbki", 7500.00, 1),
    Recipient("7591667632", "Towarzystwo Rozwoju Ziemi Andrzejewskiej", 7000.00, 1),
    Recipient("5251985266", "Towarzystwo Przyjaciół Warszawy", 6000.00, 1),
    Recipient("5291664723", "Ochotnicza Straż Pożarna w Skułach ul. Strażacka 9, 96-321 Bartoszówka", 6000.00, 1),
    Recipient("7963033103", "Fundacja LAS RĄK", 6000.00, 1),
    Recipient("1230688897", "Integracyjny Klub Sportowy Konstancin", 5000.00, 1),
    Recipient("5311706615", "Stowarzyszenie Zespół Pieśni i Tańca Ziemi Nowodworskiej Soli Deo", 5000.00, 1),
    Recipient("7571338730", "Ochotnicza Straż Pożarna w Dąbrówce", 5000.00, 1),
    Recipient("7742550165", "Ochotnicza Straż Pożarna w Drobinie", 5000.00, 1),
    Recipient("7571338865", "Ochotnicza Straż Pożarna w Makowie Mazowieckim", 4600.00, 1),
    Recipient("1132777973", "Fundacja Domowe Hospicjum Dziecięce Promyczek", 1300.00, 1),
)


def by_value(limit: int | None = None) -> tuple[Recipient, ...]:
    """The list, richest first, optionally just the top `limit`."""
    return UNRESOLVED[:limit] if limit else UNRESOLVED


def total_paid(recipients: typing.Iterable[Recipient] | None = None) -> float:
    return sum(r.paid for r in (recipients if recipients is not None else UNRESOLVED))


def nips(recipients: typing.Iterable[Recipient] | None = None) -> tuple[str, ...]:
    return tuple(r.nip for r in (recipients if recipients is not None else UNRESOLVED))
