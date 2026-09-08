# PSL (i sąsiadujące partie) w Grupie PKP, 2023-09-07 – 2026-09-07

Robocze ustalenia z researchu prasowego + KRS/PKW nad obsadą stanowisk w
spółkach Grupy PKP przez osoby z udokumentowanym powiązaniem politycznym
(najczęściej PSL, ale nie wyłącznie). Cel researchu **nie jest** sam w sobie
lista nazwisk — jest nim znalezienie **luk w pipeline'ie koryta.pl**: ludzi,
o których pisze prasa, a których nasz automatyczny KRS/PKW pipeline nie
złapał albo nie opublikował. Ten dokument to snapshot na 2026-09-07/08,
przeznaczony jako kontekst do wznowienia pracy w innej sesji.

## Zakres i metodologia (skrótowo)

- Okno: ostatnie trzy lata, 2023-09-07 do 2026-09-07.
- "Grupa PKP" tu oznacza: PKP S.A. i spółki-córki/wnuczki (PKP Cargo, PKP
  Intercity, PKP PLK, PKP Energetyka, PKP Informatyka, PKP Telkol, PKP LHS,
  WARS, Xcity Investment, CS Natura Tour, PKP Cargo Connect, Trakcja SA,
  ZRK-DOM, DOLKOM, Pomorskie Przedsiębiorstwo Mechaniczno-Torowe, Fundacja
  Grupy PKP, CARGOTOR), plus spółki samorządowe blisko powiązane z tym samym
  wątkiem obsadowym (Koleje Mazowieckie, Warszawska Kolej Dojazdowa) — mimo że
  formalnie nie są własnością PKP S.A.
- Dane strukturalne: KRS "recent changes" crawl + PKW (rejestr kandydatów) +
  status publikacji na koryta.pl. 346 osób objęło zarejestrowane stanowisko
  (zarząd/RN/prokurent) w spółce kolejowej w oknie; 249 w Grupie PKP właściwej.
- Dane prasowe: śledztwa Onet ("Zielona fala nakryła polską kolej", XI 2024),
  Gazeta Wyborcza ("pajęczyna PSL", "duży i mały Darek"), niezalezna.pl
  ("ponad 20 nazwisk"), money.pl, oraz — w drugiej rundzie — bezpośrednio
  dwumiesięcznik kolejowy **"Z Biegiem Szyn"** (zbs.net.pl, red. Karol
  Trammer) i interpelacje poselskie (sejm.gov.pl / api.sejm.gov.pl).
- Każde nowe twierdzenie o powiązaniu politycznym przechodziło adwersaryjną
  weryfikację (2 niezależni "obalacze"; domyślnie refuted=true przy
  wątpliwości) — mechanizm złapał już jeden fałszywy pozytyw (patrz niżej).

## Trzy typy luk pipeline'u, każdy inny mechanizm

To jest sedno tego researchu — trzy różne powody, dla których automatyczny
pipeline (KRS crawl → PKW match → publikacja) nie widzi kogoś, kogo widzi
prasa:

**1. Luka w samym crawlu KRS, nie w dopasowaniu.** Angelika Rybak-Gawkowska
(Rada Nadzorcza Warszawskiej Kolei Dojazdowej od marca 2023, żona wicepremiera
Krzysztofa Gawkowskiego, Lewica) jest nieobecna nawet w surowym crawlu zmian
KRS dla WKD (tylko 9 rekordów, żaden jej nie dotyczy). Potwierdzone
niezależnie przez oficjalne, nieautoryzowane API `api-krs.ms.gov.pl` (wpis
nr 67, data 10.03.2023, bez wykreślenia — nadal w składzie). To pierwszy
udokumentowany przypadek, gdzie dziura jest w samym crawlu źródłowym, a nie na
etapie dopasowania nazwiska czy publikacji.

**2. Luka zakresu: strukturalne wykrywanie widzi tylko PSL.** Marek Lipiński
(Zarząd WKD ds. finansowych od XII 2024) JEST złapany przez KRS crawl (rola
"Zarząd" w roster.json), ale jego powiązanie polityczne to **Koalicja
Obywatelska** (radny Bemowa, eks-burmistrz/wiceburmistrz dzielnicy) — pliki
dopasowań PKW/PSL poprawnie go pomijają, bo szukają wyłącznie PSL
(`psl_candidacy=false`). Wniosek: dopóki wykrywanie strukturalne ograniczone
jest do PSL, każdy polityk innej partii w zarządzie spółki kolejowej jest
niewidoczny bez czytania prasy wprost.

**3. Luka zakresu KRS jako takiego: dyrektorzy/specjaliści są niewidoczni.**
Znane już wcześniej (Michał Postek, Olga Samsonowicz), potwierdzone ponownie
przez Konrada Grzejszczaka (dyrektor departamentu nadzoru właścicielskiego w
MI — stanowisko ministerialne nadzorujące spółki, nie zatrudnienie w samej
spółce) i przez odrzucony lead Katarzyny Jankowskiej (patrz niżej) — KRS
rejestruje tylko organy spółki (zarząd/RN/prokurent), nie stanowiska
dyrektorskie czy specjalistyczne.

## Nowe osoby znalezione w rundzie 2 (sweep "Z Biegiem Szyn")

| Osoba | Spółka / rola | Powiązanie | Status weryfikacji | Dlaczego pipeline jej nie miał |
|---|---|---|---|---|
| Angelika Rybak-Gawkowska | WKD, Rada Nadzorcza, od III 2023 | żona wicepremiera Krzysztofa Gawkowskiego (Lewica) | **confirmed** (2/2 nie obaliło, niezależnie potw. przez API KRS) | nieobecna w surowym crawlu KRS (luka typu 1) |
| Marek Lipiński | WKD, Zarząd ds. finansowych, od XII 2024 | radny Koalicji Obywatelskiej, Bemowo; eks-burmistrz/wiceburmistrz | **confirmed** (2/2 nie obaliło) | złapany przez KRS, ale poza zakresem "tylko PSL" (luka typu 2) |
| Katarzyna Jankowska | Koleje Mazowieckie, "główna specjalistka ds. dostępności" | radna KO, Praga-Płn. | **refuted** (2/2 obaliło — jedyne źródło samo nazywa się "nieoficjalne", spółka odmówiła potwierdzenia) | dobry przykład że weryfikacja działa w obie strony |

Źródło pierwotne obu potwierdzonych: *Z Biegiem Szyn* nr 6 (139),
listopad-grudzień 2025, dział POLITYKA, artykuł "Warszawska Koalicja
Dojazdowa" (https://www.zbs.net.pl/zbs139.pdf).

## Nowy kanał źródłowy: interpelacje poselskie

Interpelacja nr 16425 (poseł Michał Moskal, Konfederacja, 7.04.2026,
https://www.sejm.gov.pl/Sejm10.nsf/interpelacja.xsp?typ=INT&nr=16425) to
najbardziej bezpośrednio trafiająca w temat interpelacja całej kadencji —
nazywa wprost 8 osób (Dariusz Grajda, Jolanta Sobczyk, Radosław Sołtysiak,
Mikołaj Grzyb, Miłosz Wojnarowski, Michał Franas, Elżbieta Nawrocka, Konrad
Grzejszczak — wszystkie już znane) i cytuje artykuł Gazety Wyborczej
"Pajęczyna PSL oplotła spółki PKP" (kwiecień 2026, Jarosław Osowski).
Odpowiedź Ministerstwa Infrastruktury (wiceminister Piotr Malepszak,
8.06.2026) **odmawia odniesienia się do zarzutów partyjnych**, powołując się
na brak rejestru przynależności partyjnej członków organów spółek — poseł
złożył ponowną interpelację (16425p, 15.06.2026), bez odpowiedzi merytorycznej
na 2026-09-07. To dobry, ustrukturyzowany kanał źródłowy do powtarzania w
przyszłych sweepach: `api.sejm.gov.pl/sejm/term10/interpellations`.

## Największa niezamknięta luka: wyborcza.pl

Cała domena wyborcza.pl (włącznie z lokalnymi oddziałami) jest **niedostępna
dla WebFetch** (błąd pobierania, nie paywall — próby przez Google Translate
proxy i 12ft.io też zawiodły). Zidentyfikowano z samych tytułów 6 artykułów
Warszawa/Lublin.Wyborcza.pl ze stycznia-czerwca 2026 o "pajęczynie PSL" w
PKP — dokładnie tę "nową falę" nazwisk z 2025-2026, analogiczną do śledztwa z
listopada 2024:

1. "PSL obsadził spółki PKP. Ludzie Kosiniaka-Kamysza, Struzika, Klimczaka…" (6.04.2026)
2. "Ludzie PSL w spółkach PKP. Masowo wstawiają do zarządów i rad nadzorczych kolejne osoby" (7.04.2026)
3. "Pajęczyna PSL oplotła spółki PKP. Tak 'duży Darek' i 'mały Darek' rządzą polską koleją" (kwiecień 2026, Jarosław Osowski)
4. "PKP i jej spółki córki obsadzone działaczami PSL. Dlaczego politycy od 25 lat nie mogą dokończyć zmian na kolei?" (20.04.2026)
5. "PKP LHS. Nepotyzm w kolejowej spółce i znowu polityk PSL-u" (Lublin.Wyborcza.pl, 11.01.2026)
6. "Koleje Mazowieckie łupem polityków. Żona ministra Kierwińskiego zarabia tu więcej niż prezydent Warszawy" (1.06.2026) — ten akurat udało się częściowo odzyskać przez przedruk WP.pl, stąd Agnieszka Gierzyńska-Kierwińska i Krzysztof Stępień w tabeli "spoza ścisłej listy PSL" niżej.

Interpelacja 16425 sugeruje, że artykuł nr 3 (Osowski) wymienia dodatkowo
ogólnikowo "radnych powiatowych, wójtów, pracowników biur poselskich PSL i
osób z lokalnych struktur partii" — bez podania z imienia i nazwiska w
źródłach wtórnych, do których był dostęp. **To najbardziej prawdopodobne
miejsce, gdzie chowają się kolejne nienazwane jeszcze osoby** — wymaga
ręcznego dostępu do wyborcza.pl albo innego narzędzia.

Inne nietknięte tropy: Piotr Malepszak zapowiedział w VI 2026 "czystkę" w
zarządach spółek kolejowych (konflikt z ministrem Klimczakiem o obsadę PSL,
nakolei.pl) — warto sprawdzić nominacje po tej dacie; artykuł Bankier.pl o
nowej Radzie Nadzorczej PKP Cargo (VI 2026) nieosiągalny technicznie.
Sprawdzone i **odrzucone z powodu zakresu** (nie dowodu): Mateusz Masłowski
(26-letni działacz PSL, dyrektor DSDiK od III 2025 — DSDiK to instytucja
samorządu woj. dolnośląskiego, nie spółka Grupy PKP) i Mariusz Wiśniewski
(Koleje Wielkopolskie, IV 2026 — spółka samorządowa jak Koleje Mazowieckie,
ale bez potwierdzonego związku partyjnego w dostępnych źródłach).

NIK: brak jakiejkolwiek kontroli/raportu z okna 2023-2026 dot. obsady
kadrowej lub konfliktu interesów w Grupie PKP.

## Korroboracje spoza ścisłej listy PSL

Cztery osoby potwierdzone/korroborowane w rundzie 2, które **nie są** w tabeli
52 kandydatów niżej — bo ta tabela to ściśle "PSL" (`final_candidates.json`),
a te albo mają powiązanie z inną partią, albo ich stanowisko nie mieściło się
w oknie/kryteriach budowy tamtej listy:

| Osoba | Spółka / rola | Powiązanie | Źródło |
|---|---|---|---|
| Szymon Sobczak | Koleje Mazowieckie (Zarząd) / prezes ZSPK od IV 2025 | PSL — członek zarządu mazowieckiego PSL | zbs140.pdf |
| Piotr Smogorzewski | CS Natura Tour, Zarząd | brat wieloletniego prezydenta Legionowa Romana Smogorzewskiego (nie PSL, samorządowiec) | nakolei.pl |
| Krzysztof Stępień | PKP S.A., naczelnik wydziału/biura | radny KO, syn prezesa Kolei Mazowieckich Roberta Stępnia (też KO) | WP.pl |
| Agnieszka Gierzyńska-Kierwińska | Koleje Mazowieckie, dyrektor ds. strategii i rozwoju | radna KO Warszawy, żona ministra Marcina Kierwińskiego (KO) | WP.pl, niezalezna.pl |

Szymon Sobczak jest o tyle ciekawy, że JEST PSL, a mimo to nie trafił do
ścisłej listy 52 — warto sprawdzić w rundzie 3, czy to luka w oknie czasowym
(jego miejsce w zarządzie Kolei Mazowieckich mogło zacząć się przed
2023-09-07) czy w kryteriach budowy `final_candidates.json`.

## Pełna lista: 52 potwierdzonych kandydatów z powiązaniem PSL

Kolumna "koryta.pl" pokazuje status publikacji i czy istnieje edge
zatrudnienia na stronie, niezależnie od statusu publikacji osoby.

| Nazwisko | Spółka / stanowisko | Powiązanie | Pewność | koryta.pl |
|---|---|---|---|---|
| Agnieszka Gonczaryk | 2024-10-03 CS Natura Tour (Rada Nadzorcza) | inne (darczyńca PSL + podwładna marszałka Adama Struzika z PSL) | high | PUBLISHED (edge) |
| Andrzej Melon | 2024-10-03 CS Natura Tour (Rada Nadzorcza) | inne | low | DRAFT (edge) |
| Andrzej Pawłowski | 2026-03-19 Polregio (Zarząd) | candidacy/site-label |  | DRAFT (edge) |
| Artur Bagieński | 2024-06-04 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | czlonek/wladze PSL | high | DRAFT (edge) |
| Bogdan Banaszczak | 2024-08-02 WARS (Rada Nadzorcza) | radny z poparciem PSL | high | DRAFT (edge) |
| Bogusław Nadolnik | 2024-06-07 PKP Cargo (Rada Nadzorcza) | candidacy/site-label |  | PUBLISHED (edge) |
| Cezary Gabryjączyk | 2024-05-07 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Rada Nadzorcza) do 2024-11-26 | kandydat z listy PSL | high | NOT_ON_SITE (brak edge) |
| Czesław Sulima | Koleje Mazowieckie – KM sp. z o.o. — Członek Zarządu / dyrektor eksploatacyjny (w zarządzie od 30.11.2004) (2004-11-30) | inne | low | NOT_ON_SITE (brak edge) |
| Dariusz Grajda | 2024-05-09 PKP SA (Zarząd) | czlonek/wladze PSL | high | PUBLISHED (edge) |
| Elżbieta Nawrocka | 2024-08-02 WARS (Rada Nadzorcza) | czlonek/wladze PSL | high | NOT_ON_SITE (brak edge) |
| Emil Sawicki | 2024-10-15 Warszawska Kolej Dojazdowa (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Filip Chrzanowski | 2026-04-03 Fundacja Grupy PKP (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Franciszek Marszałek | 2024-03-28 Koleje Wielkopolskie (Rada Nadzorcza) do 2026-06-15 | candidacy/site-label |  | DRAFT (edge) |
| Hanna Jażdżyk | 2024-07-25 PKP Intercity (Zarząd) | rodzina polityka PSL | medium | DRAFT (edge) |
| Ireneusz Gliszczyński | 2024-08-08 Xcity Investment (Zarząd) | inne | medium | NOT_ON_SITE (brak edge) |
| Jacek Grabek | 2024-09-24 PKP LHS (Zarząd) do 2025-03-10 | kandydat z listy PSL | high | DRAFT (edge) |
| Jarosław Dąbrowski | 2025-11-25 Warszawska Kolej Dojazdowa (Zarząd) | candidacy/site-label |  | DRAFT (edge) |
| Jarosław Grzesiak | 2026-05-28 TK Telekom (Rada Nadzorcza) | candidacy/site-label |  | NOT_ON_SITE (brak edge) |
| Jarosław Mioduski | 2024-04-30 PNiUIK Krakow (Rada Nadzorcza) do 2025-08-04 | czlonek/wladze PSL | high | DRAFT (edge) |
| Jolanta Sobczyk | 2024-08-28 CS Natura Tour (Zarząd) | kandydat z listy PSL | high | DRAFT (edge) |
| Jolanta Łuniewska Bury | 2024-08-09 PKP SKM w Trojmiescie (Rada Nadzorcza) do 2026-08-13 | kandydat z listy PSL | high | PUBLISHED (brak edge) |
| Juliusz Engelhardt | 2026-06-24 Polregio (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Karol Bielski | 2024-07-19 PKP Telkol (Rada Nadzorcza) do 2026-07-23 | kandydat z listy PSL | high | DRAFT (edge) |
| Kinga Błaszczyk | PKP Intercity — Pracownica spółki (stanowisko nieujawnione) (2025) | radny z poparciem PSL | medium | NOT_ON_SITE (brak edge) |
| Konrad Grzejszczak | 2026-04-10 CARGOTOR (Rada Nadzorcza) | czlonek/wladze PSL | medium | PUBLISHED (brak edge) |
| Krzysztof Krupa | 2025-03-10 PKP LHS (Zarząd) do 2025-06-24 | candidacy/site-label |  | NOT_ON_SITE (brak edge) |
| Leszek Stachowiak | 2024-07-12 PKP Informatyka (Zarząd) | kandydat z listy PSL | high | NOT_ON_SITE (brak edge) |
| Marcin Grabowski | 2024-06-05 PKP Intercity Remtrak (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Marcin Mikos | 2024-08-08 Xcity Investment (Rada Nadzorcza) do 2026-01-13 | kandydat z listy PSL | high | DRAFT (edge) |
| Marcin Protas | 2025-06-12 PKP LHS (Zarząd) do 2026-04-03 | kandydat z listy PSL | high | DRAFT (edge) |
| Marcin Skorupiński | 2026-02-10 PKP SA (Rada Nadzorcza) | pracownik biura politycznego PSL | high | DRAFT (edge) |
| Marek Bieniek | 2024-10-29 Koleje Dolnoslaskie (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Marzena Słomka | 2026-08-13 PKP SKM w Trojmiescie (Rada Nadzorcza) | candidacy/site-label |  | PUBLISHED (edge) |
| Michał Andrzej Rak | 2026-04-09 PKP Informatyka (Rada Nadzorcza) | kandydat z listy PSL | high | DRAFT (edge) |
| Michał Dziubak | 2024-07-12 PKP Informatyka (Rada Nadzorcza) | pracownik biura politycznego PSL | high | PUBLISHED (brak edge) |
| Michał Franas | 2024-06-05 PKP Intercity Remtrak (Zarząd) | radny z poparciem PSL | high | PUBLISHED (brak edge) |
| Michał Postek | PKP S.A. — Zastępca dyrektora Biura Zarządzania Strategicznego (2024) | kandydat z listy PSL | high | NOT_ON_SITE (brak edge) |
| Mieczysław Łuczak | 2024-10-18 PKP Cargo Connect (Rada Nadzorcza) do 2024-11-20 | czlonek/wladze PSL | high | DRAFT (edge) |
| Mikołaj Grzyb | 2024-10-03 CS Natura Tour (Rada Nadzorcza) | rodzina polityka PSL | high | PUBLISHED (brak edge) |
| Miłosz Wojnarowski | 2024-10-16 CS Natura Tour (Rada Nadzorcza) | rodzina polityka PSL | high | PUBLISHED (brak edge) |
| Olga Samsonowicz | PKP S.A. — Dyrektorka biura komunikacji (2024-11-15) | inne | medium | NOT_ON_SITE (brak edge) |
| Radosław Konieczny | 2024-10-01 Fundacja Grupy PKP (Zarząd) | inne | medium | DRAFT (edge) |
| Radosław Sołtysiak | Grupa PKP — spółka nieustalona — stanowisko kierownicze (nieustalone) (2024) | inne (środowisko marszałka Adama Struzika z PSL) | low | NOT_ON_SITE (brak edge) |
| Rafał Dąbrowski | 2024-09-02 PGE EK Operator (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Robert Pilarczyk | 2025-06-07 Polregio (Rada Nadzorcza) | candidacy/site-label |  | NOT_ON_SITE (brak edge) |
| Roman Warchoł | 2024-06-13 PKP Intercity (Rada Nadzorcza) | kandydat z listy PSL | high | PUBLISHED (brak edge) |
| Waldemar Kuliński | Koleje Mazowieckie – KM sp. z o.o. (poza Grupą PKP — 100% Województwo Mazowieckie) — Przewodniczący Rady Nadzorczej (2024) | czlonek/wladze PSL | medium | NOT_ON_SITE (brak edge) |
| Wojciech Brzeski | 2024-11-13 CS Natura Tour (Zarząd) do 2026-01-27 | radny z poparciem PSL | high | DRAFT (edge) |
| Wojciech Legawiec | 2024-06-24 PKP LHS (Rada Nadzorcza) | pracownik biura politycznego PSL | high | PUBLISHED (edge) |
| Wojciech Robert Szczepanik | 2024-06-04 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | kandydat z listy PSL | high | DRAFT (edge) |
| Wojciech Smoliński | 2024-05-16 Koleje Dolnoslaskie (Rada Nadzorcza) | candidacy/site-label |  | DRAFT (edge) |
| Łukasz Borkowski | 2024-11-27 Xcity Investment (Rada Nadzorcza) do 2026-03-10 | candidacy/site-label |  | DRAFT (edge) |

## Znane luki strukturalne (niezmienione od rundy 1)

- Powiązania rodzinne/towarzyskie (Jażdżyk, Grzyb, Wojnarowski, Sobczyk,
  Gliszczyński, Smogorzewski, Melon) nie wynikają z list PKW ani z etykiet na
  stronie — trzeba ich czytać wprost z prasy.
- Precyzja dopasowania PKW zawodzi nawet przy zgodnym roczniku urodzenia:
  Krzysztof Krupa (zarząd PKP LHS 2025) okazał się radnym **KO** z Zamościa,
  nie PSL — pierwszy znany fałszywy pozytyw tego mechanizmu.
- 16 twierdzeń w `need_verify.json` (z rundy 1) nadal bez adwersaryjnej
  weryfikacji.

## Co zostało do zrobienia

1. **300 z 346 nazwisk z pełnego rostera KRS nigdy nie sprawdzonych
   indywidualnie** pod kątem powiązań politycznych (nie tylko PSL) —
   `chunk_00..09.txt` w scratchu są gotowe do podania agentom, workflow padł
   raz na limicie sesji.
2. Ręczny dostęp do 6 artykułów wyborcza.pl wypisanych wyżej — najbardziej
   prawdopodobne źródło kolejnych, jeszcze nienazwanych osób z 2025-2026.
3. Sprawdzić nominacje/odwołania w zarządach spółek kolejowych po
   zapowiedzianej przez Malepszaka "czystce" (VI 2026).
4. Adwersaryjna weryfikacja 16 twierdzeń z `need_verify.json`.
5. Rozważyć rozszerzenie strukturalnego wykrywania poza samo PSL (luka typu 2
   wyżej) — przynajmniej dla partii już napotkanych w tym oknie (KO, Lewica).

---
Surowe dane i skrypty (nie w tym repo, lokalny cache):
`~/.cache/koryta/scratch-bridge-cse-01R9P/` — `STATE.md` tam ma pełną historię
obu rund i kolejność uruchamiania skryptów.
