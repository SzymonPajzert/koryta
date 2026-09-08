# 300 nazwisk z rostera KRS bez indywidualnego sprawdzenia

Uzupełnienie do `psl-pkp-appointments-2023-2026.md`. Tamten dokument zamyka listę
52 osób z powiązaniem **PSL**; ten jest resztą rostera — 300 osób, które objęły
zarejestrowane stanowisko (zarząd / rada nadzorcza / prokurent) w spółce kolejowej
między 2023-09-07 a 2026-09-07 i **nigdy nie zostały sprawdzone indywidualnie**.
213 z nich jest w Grupie PKP właściwej.

## Co się zmieniło: wykrywanie nie jest już ograniczone do PSL

Luka typu 2 z tamtego dokumentu ("strukturalne wykrywanie widzi tylko PSL") jest
zamknięta po stronie danych. Skaner PKW klasyfikuje teraz **każdy** komitet do rodziny
partyjnej (`party_map.py` w scratchu), zamiast filtrować po PSL. Efekt na całym rosterze
346 osób: **108 osób z sygnałem partyjnym zamiast 41 — 2,6x więcej.**

W samej Grupie PKP (249 osób) rozkład wygląda tak, że teza o kolonizacji przez PSL
nie broni się jako *rozkład*:

| rodzina | osób |
|---|---|
| PSL | 22 |
| KO/PO | 18 |
| PiS | 17 |
| Lewica | 16 |
| Samoobrona | 2 |
| Konfederacja | 1 |
| Kukiz | 1 |
| **bez sygnału** | **173** |

PSL prowadzi, ale nie dominuje — KO/PO, PiS i Lewica razem to 51 wobec 22. To
spójne z wcześniejszym ustaleniem, że "desant PSL na koleje" jest historią o
konkretnych ludziach (Grajda, Natura Tour), a nie o wskaźniku.

## Jak czytać kolumnę "sygnał"

- `PKW: <rodzina>` — kandydował z listy tego środowiska, **i rocznik urodzenia się zgadza**
  z rejestrem KRS. To jest przesłanka, nie dowód: mechanizm dał już fałszywy pozytyw
  (Krzysztof Krupa, zgodny rocznik, a jednak radny KO a nie PSL). Do potwierdzenia prasą.
- `strona: <partia>` — etykieta partii już wpisana na koryta.pl.
- `tylko lokalny KWW` — kandydował wyłącznie z komitetu wyborców. Słaby sygnał: bywa
  bezpartyjnym samorządowcem, bywa partyjnym startującym pod lokalnym szyldem.
- `tylko imiennik w PKW` — jest kandydat o tym nazwisku, ale **rocznik się nie zgadza**.
  Traktować jako sygnał do odrzucenia, nie do potwierdzenia.
- `—` — brak jakiegokolwiek śladu w PKW i na stronie. Tu prasa jest jedynym kanałem.

## Zadanie do wykonania na tej liście

Dla każdej osoby ustalić, czy ma udokumentowane powiązanie polityczne **jakiejkolwiek**
partii (nie tylko PSL): członkostwo lub władze partii, kandydowanie z listy, mandat
z poparciem partii, praca w biurze poselskim lub gabinecie politycznym, pokrewieństwo
z politykiem, działalność w organizacji satelickiej. Wynik "brak powiązania" jest
pełnoprawnym wynikiem i trzeba go zapisać razem z tym, czego się szukało.


## Grupa PKP (213)

| # | Osoba | ur. | Stanowisko | Sygnał partyjny | koryta.pl |
|---|---|---|---|---|---|
| 1 | Magdalena Maria Merlak Gajewska | 1978-04-25 | 2023-09-08 ZRK-DOM Poznan (PLK) (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 2 | Marek Olkiewicz | 1970-01-19 | 2023-09-11 PKP Cargotabor (Rada Nadzorcza) do 2024-02-13 | PKW: Lewica/PiS | DRAFT |
| 3 | Jadwiga Burzyńska | 1966-01-26 | 2023-09-13 DOLKOM Wroclaw (PLK) (Rada Nadzorcza) do 2025-07-14 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 4 | Andrzej Morel | 1966-10-20 | 2023-09-18 PKP Cargotabor (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 5 | Mariusz Stanisław Goraj | 1977-03-09 | 2023-09-18 PKP Cargotabor (Rada Nadzorcza) do 2023-09-26 | PKW: PiS | NOT_ON_SITE |
| 6 | Anna Woźniak | 1955-08-09 | 2023-09-18 PKP Cargotabor (Rada Nadzorcza) do 2024-06-26 | PKW: PiS | DRAFT |
| 7 | Marek Furman | 1981-12-20 | 2023-09-18 PKP Cargotabor (Rada Nadzorcza) do 2024-06-26 | PKW: PiS | DRAFT |
| 8 | Zenon Kozendra | 1963-06-20 | 2023-09-18 PKP Cargotabor (Rada Nadzorcza) do 2024-08-06 | — | NOT_ON_SITE |
| 9 | Marlena Jabłonka | 1993-10-15 | 2023-10-02 MDR Szczecin Starkiewicza (Rada Nadzorcza) do 2025-04-14; 2023-10-26 MDR Wroclaw Bialowieska (Rada Nadzorcza) do 2025-05-21; 2024-01-10 MDR Wroclaw Hermanowska (Rada Nadzorcza) do 2025-02-14 | — | NOT_ON_SITE |
| 10 | Michał Ulatowski | 1976-05-27 | 2023-10-16 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 11 | Magdalena Sawicka | 1981-08-14 | 2023-10-26 MDR Wroclaw Bialowieska (Rada Nadzorcza) | PKW: PiS | NOT_ON_SITE |
| 12 | Bogusław Kusion | 1966-09-11 | 2023-12-05 WARS (Rada Nadzorcza) do 2025-08-08 | — | NOT_ON_SITE |
| 13 | Tomasz Mostowski | 1979-09-13 | 2023-12-08 Cargosped Terminal Braniewo (Rada Nadzorcza) do 2025-05-30 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 14 | Martyna Teresa Spasińska | 1986-04-16 | 2023-12-12 Dekada Konin (Zarząd) do 2025-04-02 | — | NOT_ON_SITE |
| 15 | Krystyna Krysztofiak | 1967-03-12 | 2023-12-14 PKP Telkol (Zarząd) do 2024-03-20 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 16 | Kazimierz Karolczak | 1974-02-13 | 2023-12-21 Koleje Slaskie (Rada Nadzorcza) do 2024-10-09; 2024-10-15 PKP PLK (Rada Nadzorcza) do 2025-11-06 | PKW: Lewica | DRAFT |
| 17 | Mariusz Wiórek | 1964-07-08 | 2024-01-10 MDR Wroclaw Hermanowska (Rada Nadzorcza); 2024-08-09 PKP SKM w Trojmiescie (Rada Nadzorcza) | PKW: PiS | DRAFT |
| 18 | Michał Glinka | 1972-08-30 | 2024-01-10 MDR Wroclaw Hermanowska (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 19 | Jarosław Rafał Bagniewski | 1966-11-22 | 2024-03-14 PKP Cargo (Prokurent) do 2024-08-07 | — | NOT_ON_SITE |
| 20 | Piotr Wyborski | 1977-12-29 | 2024-03-14 PKP PLK (Rada Nadzorcza) do 2024-05-07; 2024-03-14 PKP PLK (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 21 | Maciej Kaczorek | 1984-08-28 | 2024-03-14 PKP PLK (Rada Nadzorcza) do 2024-05-10; 2024-03-14 PKP PLK (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 22 | Piotr Kubicki | 1977-12-02 | 2024-03-14 PKP PLK (Rada Nadzorcza) do 2024-05-10; 2024-03-14 PKP PLK (Zarząd) do 2025-02-07 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 23 | Jakub Majewski | 1976-02-12 | 2024-03-14 PKP PLK (Rada Nadzorcza) do 2025-08-06; 2025-09-16 PKP PLK (Rada Nadzorcza) | tylko lokalny KWW | DRAFT |
| 24 | Małgorzata Anna Lubińska | 1976-05-12 | 2024-03-20 PKP Telkol (Prokurent) do 2024-05-08 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 25 | Krzysztof Chwaja | 1971-03-20 | 2024-03-21 PKP Linia Chelmska Szerokotorowa (Zarząd) | — | NOT_ON_SITE |
| 26 | ANDRZEJ MASSEL | 1965-01-19 | 2024-05-06 PKP SA (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 27 | Tomasz Warsza | 1978-09-20 | 2024-05-06 PKP SA (Rada Nadzorcza) | — | NOT_ON_SITE |
| 28 | Łukasz Zbigniew Szarawara | 1973-03-02 | 2024-05-06 PKP SA (Rada Nadzorcza) | — | NOT_ON_SITE |
| 29 | Jarosław Bełdowski | 1975-01-22 | 2024-05-06 PKP SA (Rada Nadzorcza) do 2024-10-29 | tylko lokalny KWW | NOT_ON_SITE |
| 30 | Arkadiusz Jan Ignasiak | 1972-04-04 | 2024-05-06 PKP SA (Rada Nadzorcza) do 2025-01-23 | — | NOT_ON_SITE |
| 31 | Paweł Rabczewski | 1981-11-17 | 2024-05-07 ZRK-DOM Poznan (PLK) (Rada Nadzorcza) | tylko lokalny KWW | DRAFT |
| 32 | Jakub Trębicki | 1981-06-02 | 2024-05-08 PKP Telkol (Rada Nadzorcza) | — | NOT_ON_SITE |
| 33 | Dariusz Wojciechowski | 1975-05-30 | 2024-05-08 PKP Telkol (Zarząd); 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) do 2026-04-03 | tylko lokalny KWW | DRAFT |
| 34 | Witold Heronim Stępień | 1956-07-20 | 2024-05-09 PKP PLK (Rada Nadzorcza) | PKW: KO/PO; strona: PO | DRAFT |
| 35 | Tomasz Rurka | 1978-07-03 | 2024-05-09 PKP PLK (Rada Nadzorcza) | — | NOT_ON_SITE |
| 36 | Paweł Lisiewicz | 1979-02-06 | 2024-05-09 PKP SA (Zarząd); 2024-05-23 PKP Intercity (Rada Nadzorcza); 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) do 2026-04-03; 2024-07-03 WARS (Rada Nadzorcza) | strona: PO | PUBLISHED |
| 37 | Alan Marcin Beroud | 1984-07-10 | 2024-05-09 PKP SA (Zarząd) | strona: PO | PUBLISHED |
| 38 | Andrzej Bułczyński | 1983-11-13 | 2024-05-09 PKP SA (Zarząd) | PKW: PiS | NOT_ON_SITE |
| 39 | Krzysztof Waszkiewicz | 1979-10-14 | 2024-05-10 PKP PLK (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 40 | Marcin Jerzy Mochocki | 1983-10-08 | 2024-05-10 PKP PLK (Zarząd) | — | NOT_ON_SITE |
| 41 | Michał Gil | 1982-08-03 | 2024-05-10 PKP PLK (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 42 | Małgorzata Kuczewska Łaska | 1969-01-24 | 2024-05-10 PKP PLK (Zarząd) do 2026-06-15; 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 43 | Grzegorz Jan Woźniak | 1977-10-19 | 2024-05-22 Centralny Terminal Multimodalny (Cargo) (Zarząd) do 2024-10-25 | PKW: Lewica/PiS | NOT_ON_SITE |
| 44 | Ryszard Wowczko | 1952-09-24 | 2024-05-23 PKP Intercity (Rada Nadzorcza) | PKW: Lewica | DRAFT |
| 45 | Przemysław Sierpień | 1986-04-28 | 2024-05-23 PKP Intercity (Rada Nadzorcza) | — | NOT_ON_SITE |
| 46 | Janusz Malinowski | 1963-12-04 | 2024-05-23 PKP Intercity (Zarząd) | PKW: PiS | NOT_ON_SITE |
| 47 | Adam Wawrzyniak | 1985-08-03 | 2024-05-23 PKP Intercity (Zarząd); 2025-08-27 Fundacja Grupy PKP (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 48 | Dagmara Zawadzka | 1977-07-21 | 2024-05-23 PKP Intercity (Zarząd) do 2025-08-23 | tylko lokalny KWW | DRAFT |
| 49 | Marcin Karasiński | 1975-11-17 | 2024-05-23 PKP Intercity (Zarząd) do 2026-07-31 | tylko lokalny KWW | NOT_ON_SITE |
| 50 | Grzegorz Zań | 1975-01-04 | 2024-05-24 DOLKOM Wroclaw (PLK) (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 51 | Paweł Miłek | 1970-10-28 | 2024-05-25 PKP Cargo (Rada Nadzorcza) do 2025-01-22; 2024-05-25 PKP Cargo (Zarząd) do 2024-07-26; 2024-07-26 PKP Cargo (Zarząd) do 2024-11-15; 2024-09-18 PKP Cargo Connect (Rada Nadzorcza) do 2025-06-02; 2024-09-24 PKP Cargo Service (Rada Nadzorcza); 2024-11-15 PKP Cargo (Zarząd) do 2025-01-22; 2024-12-03 Fundacja Grupy PKP (Rada Nadzorcza); 2024-12-13 PKP Cargo Terminale (Rada Nadzorcza); 2025-01-22 PKP Cargo (Zarząd); 2025-10-14 PKP Cargo Connect (Rada Nadzorcza); 2026-03-18 PKP Cargotabor (Rada Nadzorcza) | — | DRAFT |
| 52 | Marcin Wojewódka | 1974-08-22 | 2024-05-25 PKP Cargo (Rada Nadzorcza) do 2026-01-02; 2024-05-25 PKP Cargo (Zarząd) do 2024-07-26; 2024-07-26 PKP Cargo (Zarząd) do 2024-11-15; 2024-09-18 PKP Cargo Connect (Rada Nadzorcza) do 2025-08-12; 2024-11-15 PKP Cargo (Zarząd) do 2025-01-22; 2024-12-18 PKP Cargotabor (Rada Nadzorcza) do 2026-03-18 | — | NOT_ON_SITE |
| 53 | Mariusz Stec | 1967-07-18 | 2024-05-25 PKP SA (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | PUBLISHED |
| 54 | Monika Starecka | 1972-12-08 | 2024-05-25 PKP SA (Prokurent); 2024-05-25 PKP Cargo (Zarząd) do 2024-07-26; 2024-05-25 PKP Cargo (Rada Nadzorcza); 2024-07-26 PKP Cargo (Zarząd) do 2024-11-15; 2024-10-30 PKP Cargo Service (Rada Nadzorcza) do 2025-02-27; 2024-11-15 PKP Cargo (Zarząd) do 2025-02-11; 2026-01-02 PKP Cargo (Zarząd) do 2026-03-12 | — | DRAFT |
| 55 | Arkadiusz Arciszewski | 1977-03-22 | 2024-06-04 Trakcja SA (PLK 82,75%) (Zarząd) do 2024-09-05 | — | NOT_ON_SITE |
| 56 | Marta Pietrzak | 1978-05-05 | 2024-06-05 PKP Intercity Remtrak (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 57 | Zbigniew Ciemny | 1956-08-16 | 2024-06-05 PKP Intercity Remtrak (Rada Nadzorcza) do 2025-08-28; 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) do 2025-08-27; 2025-07-14 PKP Intercity Remtrak (Zarząd) | — | NOT_ON_SITE |
| 58 | Dorota Wosik | 1987-01-18 | 2024-06-05 PKP Intercity Remtrak (Zarząd) | — | NOT_ON_SITE |
| 59 | Mariusz Bednarski | 1976-05-05 | 2024-06-06 Miedzytorze Operator (Rada Nadzorcza) | PKW: Samoobrona | NOT_ON_SITE |
| 60 | Sławomir Gąsiorek | 1984-02-26 | 2024-06-06 Miedzytorze Operator (Rada Nadzorcza) do 2025-11-17 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 61 | Sebastian Żywicki | 1991-09-11 | 2024-06-06 Miedzytorze Operator (Zarząd) do 2024-08-27 | — | NOT_ON_SITE |
| 62 | Luiza Gołaszewska | 1972-09-09 | 2024-06-06 Miedzytorze Operator (Zarząd) do 2025-04-25; 2024-09-20 PM Etap 1 (2) (Zarząd) do 2025-11-20; 2026-03-10 Xcity Investment (Prokurent) | — | NOT_ON_SITE |
| 63 | Robert Stępień | 1964-09-23 | 2024-06-07 PKP Cargo (Rada Nadzorcza) | PKW: KO/PO | DRAFT |
| 64 | Krzysztof Dobies | 1978-11-14 | 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) do 2026-04-03 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 65 | Krzysztof Hantz | 2002-09-09 | 2024-06-12 Fundacja Grupy PKP (Rada Nadzorcza) do 2026-04-03 | — | NOT_ON_SITE |
| 66 | Stanisław Kapuśniak | 1960-01-08 | 2024-06-24 PKP LHS (Rada Nadzorcza) | PKW: PiS | NOT_ON_SITE |
| 67 | Marcin Wójcik | 1977-04-04 | 2024-06-24 PKP LHS (Rada Nadzorcza) | PKW: KO/PO/Lewica | NOT_ON_SITE |
| 68 | Piotr Waśniewski | 1974-12-29 | 2024-06-24 PKP LHS (Rada Nadzorcza) | strona: PO | PUBLISHED |
| 69 | Grzegorz Ryś | 1975-09-17 | 2024-06-24 PKP LHS (Rada Nadzorcza) | — | NOT_ON_SITE |
| 70 | Bogusław Bogdanowicz | 1967-12-18 | 2024-06-24 PKP LHS (Rada Nadzorcza) do 2025-11-24; 2025-04-08 PKP LHS (Zarząd) do 2025-05-29; 2025-07-01 PKP LHS (Zarząd) do 2026-02-27 | PKW: KO/PO/Lewica | NOT_ON_SITE |
| 71 | Monika Elżbieta Marukiewicz | 1972-11-23 | 2024-06-26 PKP Cargotabor (Rada Nadzorcza); 2025-01-13 PKP Cargo Terminale (Rada Nadzorcza); 2025-10-14 PKP Cargo Connect (Rada Nadzorcza) | — | NOT_ON_SITE |
| 72 | Władysław Jan Majka | 1964-07-28 | 2024-06-26 PKP Cargotabor (Rada Nadzorcza) do 2025-01-02 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 73 | Marcin Butryn | 1984-09-05 | 2024-06-26 PKP Cargotabor (Rada Nadzorcza) do 2025-01-20; 2024-08-06 PKP Cargotabor (Zarząd); 2024-09-24 PKP Cargo Service (Rada Nadzorcza) do 2025-08-14 | — | DRAFT |
| 74 | Monika Jurek Halesiak | 1972-02-13 | 2024-06-26 WARS (Zarząd) | — | NOT_ON_SITE |
| 75 | Cezary Mitrus | 1967-12-04 | 2024-07-03 CARGOTOR (Prokurent) | — | NOT_ON_SITE |
| 76 | Joanna Siecińska | 1980-04-13 | 2024-07-05 PKP Intercity Remtrak (Rada Nadzorcza); 2025-11-03 PKP Intercity (Zarząd) | — | NOT_ON_SITE |
| 77 | Wojciech Grześkowiak | 1964-02-24 | 2024-07-05 ZRK-DOM Poznan (PLK) (Zarząd) | tylko lokalny KWW | NOT_ON_SITE |
| 78 | Krzysztof Pietrzykowski | 1986-04-08 | 2024-07-09 Polregio (Zarząd) do 2025-11-19; 2024-10-18 PKP Cargo Connect (Rada Nadzorcza) do 2026-03-13 | PKW: KO/PO | NOT_ON_SITE |
| 79 | Sebastian Jerzy Rogala | 1984-03-12 | 2024-07-12 PKP Informatyka (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 80 | Ewelina Bandrowska | 1974-07-10 | 2024-07-26 Cargosped Terminal Braniewo (Prokurent) | — | NOT_ON_SITE |
| 81 | Mirosław Łoziński | 1979-02-23 | 2024-08-02 MDR Szczecin Starkiewicza (Zarząd) do 2024-09-13 | — | NOT_ON_SITE |
| 82 | Lucyna Roszyk | 1973-03-29 | 2024-08-02 WARS (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 83 | Grzegorz Adam Kiczmachowski | 1971-09-23 | 2024-08-07 PKP Cargo (Prokurent) do 2025-02-11 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 84 | Martyna Gileta | 1982-05-21 | 2024-08-07 PKP Cargo (Prokurent) do 2025-10-22 | — | NOT_ON_SITE |
| 85 | Natalia Wadhwani | 1988-05-07 | 2024-08-08 Xcity Investment (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 86 | Grzegorz Tomaszewski | 1977-01-08 | 2024-08-08 Xcity Investment (Rada Nadzorcza) do 2024-11-27 | PKW: Konfederacja | NOT_ON_SITE |
| 87 | Rafał Mateusiak | 1971-10-07 | 2024-08-08 Xcity Investment (Zarząd) do 2025-10-13; 2025-04-25 Miedzytorze Operator (Zarząd) do 2025-11-13 | — | NOT_ON_SITE |
| 88 | Łukasz Górecki | 1980-07-31 | 2024-08-09 PKP LHS (Zarząd) do 2025-10-27 | tylko lokalny KWW | NOT_ON_SITE |
| 89 | Piotr Borawski | 1983-03-13 | 2024-08-09 PKP SKM w Trojmiescie (Rada Nadzorcza) | PKW: KO/PO; strona: PO | PUBLISHED |
| 90 | Łukasz Bernatowicz | 1976-04-06 | 2024-08-09 PKP SKM w Trojmiescie (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 91 | Eugeniusz Manikowski | 1962-12-07 | 2024-08-09 PKP SKM w Trojmiescie (Zarząd) | PKW: PiS | NOT_ON_SITE |
| 92 | Roman Przybył | 1956-10-30 | 2024-08-09 Trakcja SA (PLK 82,75%) (Zarząd) do 2025-06-30; 2025-08-12 Trakcja SA (PLK 82,75%) (Zarząd) do 2025-11-07 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 93 | Anna Sabina Wojciechowska | 1966-07-18 | 2024-08-12 PKP Informatyka (Zarząd) | PKW: Lewica | NOT_ON_SITE |
| 94 | Mirosław Mielewczyk | 1968-03-17 | 2024-08-27 Miedzytorze Operator (Zarząd) do 2025-04-25 | — | NOT_ON_SITE |
| 95 | Piotr Smogorzewski | 1975-05-05 | 2024-08-28 CS Natura Tour (Zarząd) do 2024-11-13 | PKW: PiS | NOT_ON_SITE |
| 96 | Aneta Paczuska | 1984-07-06 | 2024-09-03 WARS (Prokurent) do 2025-03-13 | — | NOT_ON_SITE |
| 97 | Artur Jastrzębski | 1984-01-19 | 2024-09-05 Trakcja SA (PLK 82,75%) (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 98 | Tomasz Wardak | 1970-02-01 | 2024-09-05 Trakcja SA (PLK 82,75%) (Zarząd) | — | NOT_ON_SITE |
| 99 | Marek Jan Dawidowicz | 1981-07-12 | 2024-09-11 PKP Cargo Terminale (Rada Nadzorcza) | — | NOT_ON_SITE |
| 100 | Artur Cezary Gulczyński | 1966-04-29 | 2024-09-13 DOLKOM Wroclaw (PLK) (Zarząd) | PKW: KO/PO | DRAFT |
| 101 | Szymon Ziemski | 1986-04-11 | 2024-09-13 MDR Szczecin Starkiewicza (Zarząd) | tylko lokalny KWW | DRAFT |
| 102 | Alicja Wierzchowska | 1977-10-19 | 2024-09-18 Kolejowe Zaklady Lacznosci (Rada Nadzorcza) | — | NOT_ON_SITE |
| 103 | Bolesław Dec | 1969-09-14 | 2024-09-18 Kolejowe Zaklady Lacznosci (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 104 | Martyna Kaczmarek Gałecka | 1993-08-09 | 2024-09-18 Kolejowe Zaklady Lacznosci (Rada Nadzorcza) | — | NOT_ON_SITE |
| 105 | Dorota Żurowska | 1967-10-30 | 2024-09-18 PKP Cargo Connect (Rada Nadzorcza) do 2024-10-18 | — | DRAFT |
| 106 | Paweł Miłosz Jęczmyk | 1977-02-25 | 2024-09-27 Windykacja Kolejowa (Zarząd) | — | DRAFT |
| 107 | Barbara Skardzińska | 1985-11-20 | 2024-10-14 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 108 | Michał Grzegorz Migdal | 1985-11-13 | 2024-10-16 ZRK-DOM Poznan (PLK) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 109 | Grzegorz Lato | 1971-06-13 | 2024-10-17 PKP Cargo (Rada Nadzorcza) do 2024-11-29 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 110 | Cezary Lewandowski | 1971-12-03 | 2024-10-18 PKP Cargo Connect (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 111 | Magdalena Kulińska | 1993-03-11 | 2024-10-18 PKP Cargo Connect (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 112 | Piotr Sadza | 1963-12-06 | 2024-10-18 PKP Cargo Connect (Zarząd); 2025-12-31 PKP Cargo Terminale (Zarząd) do 2026-06-19 | PKW: Lewica; strona: SLD | DRAFT |
| 113 | Milena Palcewicz | 1986-04-06 | 2024-10-21 PKP Cargo Service (Rada Nadzorcza) | — | DRAFT |
| 114 | Grzegorz Ludomir Błeszyński | 1980-07-21 | 2024-10-25 Centralny Terminal Multimodalny (Cargo) (Zarząd) | — | NOT_ON_SITE |
| 115 | Mateusz Jacek Kaproń | 1988-08-06 | 2024-10-30 PKP Cargo Service (Rada Nadzorcza) | — | DRAFT |
| 116 | Magdalena Lew | 1975-08-30 | 2024-10-31 Cargosped Terminal Braniewo (Rada Nadzorcza) | — | NOT_ON_SITE |
| 117 | Radosław Groblewski | 1986-12-07 | 2024-11-05 WARS (Zarząd); 2026-04-03 Fundacja Grupy PKP (Rada Nadzorcza) | — | NOT_ON_SITE |
| 118 | Hanna Purzyńska | 1984-01-30 | 2024-11-07 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) do 2025-09-16 | — | NOT_ON_SITE |
| 119 | Marzena Pabjasz | 1976-12-14 | 2024-11-27 Xcity Investment (Rada Nadzorcza) | — | NOT_ON_SITE |
| 120 | Katarzyna Włodek Makos | 1983-10-14 | 2024-11-27 Xcity Investment (Zarząd) do 2026-03-10; 2025-10-23 SPV Projekty Warszawskie (Zarząd) do 2026-03-16 | — | NOT_ON_SITE |
| 121 | Marzena Piszczek | 1968-04-23 | 2024-11-29 PKP Cargo (Rada Nadzorcza) | strona: PO | PUBLISHED |
| 122 | Stefan Assanowicz | 1950-01-19 | 2024-12-12 Trakcja SA (PLK 82,75%) (Zarząd) | — | NOT_ON_SITE |
| 123 | Michał Mokrzański | 1983-12-15 | 2024-12-13 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 124 | Michał Janusz Durak | 1982-09-24 | 2024-12-17 PKP Cargotabor (Zarząd) do 2025-02-03 | — | NOT_ON_SITE |
| 125 | Sławomir Pipke | 1967-05-18 | 2025-01-08 PKP SKM w Trojmiescie (Zarząd) | PKW: KO/PO | NOT_ON_SITE |
| 126 | Jolanta Dałek | 1966-12-03 | 2025-01-08 PKP SKM w Trojmiescie (Zarząd) | — | NOT_ON_SITE |
| 127 | Mateusz Strojny | 1987-11-08 | 2025-01-13 PKP Cargo Terminale (Rada Nadzorcza) do 2025-12-31 | — | NOT_ON_SITE |
| 128 | Marcin Krogulec | 1975-07-30 | 2025-01-17 Kolejowe Zaklady Lacznosci (Zarząd) | — | NOT_ON_SITE |
| 129 | Agnieszka Aleksandra Wasilewska Semail | 1972-01-17 | 2025-01-22 PKP Cargo (Zarząd) do 2026-01-02 | — | NOT_ON_SITE |
| 130 | Sebastian Miller | 1977-04-11 | 2025-01-22 PKP Cargo (Zarząd) do 2026-03-10; 2026-03-18 PKP Cargotabor (Rada Nadzorcza) do 2026-04-17 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 131 | Wanda Kiedrowicz | 1982-10-04 | 2025-01-24 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Prokurent) | — | NOT_ON_SITE |
| 132 | Aleksander Kabała | 1974-11-22 | 2025-01-31 Kolejowe Zaklady Lacznosci (Prokurent) | tylko lokalny KWW | NOT_ON_SITE |
| 133 | Cezary Waldemar Klimont | 1967-04-12 | 2025-02-03 PKP Cargo Terminale (Rada Nadzorcza) do 2025-04-11; 2025-02-12 PKP Cargo Terminale (Zarząd); 2025-06-02 PKP Cargo Connect (Rada Nadzorcza) do 2025-09-24; 2025-07-08 PKP Cargo Connect (Zarząd) do 2026-01-09 | — | NOT_ON_SITE |
| 134 | Maciej Aluszkiewicz | 1979-08-02 | 2025-02-05 PKP Cargo Terminale (Zarząd) | — | NOT_ON_SITE |
| 135 | Andrzej Winter | 1960-10-01 | 2025-02-05 PKP Cargo Terminale (Zarząd) do 2025-02-12 | PKW: KO/PO | NOT_ON_SITE |
| 136 | Piotr Babski | 1988-03-06 | 2025-02-11 PKP Cargo (Rada Nadzorcza) | PKW: Lewica | NOT_ON_SITE |
| 137 | Artur Warsocki | 1975-04-23 | 2025-02-11 PKP Cargo (Zarząd) do 2026-04-07 | — | NOT_ON_SITE |
| 138 | Lilianna Woźny | 1988-10-28 | 2025-02-14 MDR Wroclaw Hermanowska (Rada Nadzorcza); 2025-04-14 MDR Szczecin Starkiewicza (Rada Nadzorcza); 2025-04-15 MDR Sochaczew (Rada Nadzorcza); 2025-05-21 MDR Wroclaw Bialowieska (Rada Nadzorcza) | — | NOT_ON_SITE |
| 139 | Wojciech Zając | 1988-11-21 | 2025-02-18 PKP Cargo Connect (Zarząd) do 2025-05-22 | PKW: Lewica | NOT_ON_SITE |
| 140 | Bartosz Kaczmarek | 1979-06-05 | 2025-02-20 PKP Cargo Connect (Rada Nadzorcza) | PKW: Lewica/PiS | NOT_ON_SITE |
| 141 | Dariusz Kapusta | 1982-03-13 | 2025-02-24 PKP Telkol (Zarząd) | tylko lokalny KWW | DRAFT |
| 142 | Michał Łotoszyński | 1972-11-26 | 2025-03-03 PKP Cargo (Zarząd) | — | NOT_ON_SITE |
| 143 | Anna Żaneta Godlewska | 1985-06-30 | 2025-03-06 PKP Cargotabor (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 144 | Agata Bożena Gierczak | 1969-11-24 | 2025-03-11 PKP Cargo Service (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 145 | Sylwia Kowalska Haupka | 1985-06-06 | 2025-03-13 WARS (Prokurent) | — | NOT_ON_SITE |
| 146 | Bartosz Malinowski | 1977-01-09 | 2025-03-18 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Prokurent) | PKW: KO/PO | NOT_ON_SITE |
| 147 | Piotr Sylwestrzak | 1983-01-06 | 2025-03-20 PKP Cargo Service (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 148 | Przemysław Werszner | 1970-11-06 | 2025-03-26 DOLKOM Wroclaw (PLK) (Zarząd) do 2026-07-13 | — | NOT_ON_SITE |
| 149 | Piotr Brzóska | 1969-11-12 | 2025-04-10 ZRK-DOM Poznan (PLK) (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 150 | Renata Rychter | 1979-05-12 | 2025-04-22 PKP SA (Rada Nadzorcza) do 2025-11-20 | — | NOT_ON_SITE |
| 151 | Dorota Michałowska | 1972-09-28 | 2025-04-25 Miedzytorze Operator (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 152 | Bartłomiej Jerzy Oset | 1982-05-31 | 2025-04-25 Miedzytorze Operator (Rada Nadzorcza) do 2026-03-02 | — | NOT_ON_SITE |
| 153 | Rafał Paweł Kroczak | 1989-02-15 | 2025-04-25 Miedzytorze Operator (Zarząd); 2026-08-20 PM Etap 1 (2) (Zarząd) | — | DRAFT |
| 154 | Katarzyna Zofia Iskra | 1980-05-15 | 2025-04-30 PKP Cargotabor (Zarząd) | PKW: KO/PO | DRAFT |
| 155 | Bartosz Rogowski | 1976-09-22 | 2025-05-12 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Zarząd) do 2026-08-10 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 156 | Jakub Gańko | 1985-02-18 | 2025-05-12 WARS (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 157 | Arnold Modrzejewski | 1973-02-27 | 2025-05-13 PKP SKM w Trojmiescie (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 158 | Tomasz Pietrek | 1975-11-07 | 2025-05-21 PKP Cargo (Rada Nadzorcza) | — | NOT_ON_SITE |
| 159 | Mariusz Bartkowski | 1967-08-02 | 2025-05-30 Cargosped Terminal Braniewo (Rada Nadzorcza) | PKW: PiS | NOT_ON_SITE |
| 160 | Kamil Kruszewski | 1987-04-05 | 2025-05-30 Cargosped Terminal Braniewo (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 161 | Marek Rojczyk | 1984-05-11 | 2025-05-30 Cargosped Terminal Braniewo (Rada Nadzorcza) | — | NOT_ON_SITE |
| 162 | Justyna Siedlec | 1977-10-19 | 2025-06-03 PKP Informatyka (Prokurent) | — | NOT_ON_SITE |
| 163 | Krzysztof Drozdowski | 1982-10-23 | 2025-06-09 PKP PLK (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 164 | Marek Donhöffner | 1987-09-05 | 2025-07-14 DOLKOM Wroclaw (PLK) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 165 | Tadeusz Felkowski | 1962-10-28 | 2025-07-14 DOLKOM Wroclaw (PLK) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 166 | Mariusz Sulima | 1978-03-25 | 2025-07-21 CARGOTOR (Prokurent) do 2025-08-13; 2025-08-18 Cargosped Terminal Braniewo (Zarząd) | — | NOT_ON_SITE |
| 167 | Agnieszka Dębska | 1979-12-19 | 2025-07-29 PNiUIK Krakow (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 168 | Izabela Rokicka | 1978-11-29 | 2025-08-01 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Rada Nadzorcza) | PKW: Kukiz | NOT_ON_SITE |
| 169 | Andrzej Gieszczyk | 1981-02-10 | 2025-08-08 WARS (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 170 | Urszula Fałek | 1975-05-07 | 2025-08-08 WARS (Rada Nadzorcza) | — | NOT_ON_SITE |
| 171 | Wojciech Smoleń | 1968-04-14 | 2025-08-28 PKP Intercity Remtrak (Rada Nadzorcza) | — | DRAFT |
| 172 | Zoriana Czajkowska | 1989-10-01 | 2025-09-16 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | — | DRAFT |
| 173 | Małgorzata Kociszewska | 1976-12-17 | 2025-10-15 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Rada Nadzorcza) | — | NOT_ON_SITE |
| 174 | Grzegorz Kossowski | 1972-04-24 | 2025-10-22 Trakcja SA (PLK 82,75%) (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 175 | Krzysztof Mejer | 1969-08-27 | 2025-11-07 Trakcja SA (PLK 82,75%) (Zarząd) | PKW: KO/PO | DRAFT |
| 176 | Natalia Kalinowska | 1987-01-15 | 2025-11-17 Miedzytorze Operator (Rada Nadzorcza) | tylko lokalny KWW | DRAFT |
| 177 | Mariusz Poniecki | 1979-09-13 | 2025-11-18 COSCO Shipping Lines Poland (Cargo) (Prokurent) | — | NOT_ON_SITE |
| 178 | Jacek Iwański | 1960-08-16 | 2025-11-20 PKP Informatyka (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 179 | Sebastian Bukowski | 1977-08-20 | 2025-11-24 PKP Informatyka (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 180 | Aleksandra Adamska Ziętek | 1981-08-14 | 2025-11-24 PKP LHS (Zarząd) | tylko lokalny KWW | NOT_ON_SITE |
| 181 | Adam Orzechowski | 1981-09-28 | 2025-12-10 PKP SA (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 182 | Ewa Partyka | 1974-08-07 | 2025-12-31 PKP Cargo Terminale (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 183 | Joanna Tołłoczko Kulikowska | 1964-06-16 | 2025-12-31 PKP PLK (Rada Nadzorcza) | PKW: PiS | NOT_ON_SITE |
| 184 | Marcin Stefankiewicz | 1985-06-30 | 2026-01-12 ZRK-DOM Poznan (PLK) (Prokurent) do 2026-03-19; 2026-03-19 ZRK-DOM Poznan (PLK) (Zarząd) | — | NOT_ON_SITE |
| 185 | Jacek Męcina | 1968-09-09 | 2026-01-14 PKP Cargo (Rada Nadzorcza) | — | NOT_ON_SITE |
| 186 | Igor Adamczyk | 1994-07-25 | 2026-01-26 PNiUIK Krakow (Rada Nadzorcza) | — | NOT_ON_SITE |
| 187 | Janusz Cylkowski | 1987-10-17 | 2026-01-26 PNiUIK Krakow (Rada Nadzorcza) | — | NOT_ON_SITE |
| 188 | Radosław Dudek | 1984-03-25 | 2026-02-05 ZRK-DOM Poznan (PLK) (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 189 | Paweł Klepacz | 1983-04-28 | 2026-02-27 PKP LHS (Rada Nadzorcza) | — | NOT_ON_SITE |
| 190 | Jarosław Bator | 1978-08-19 | 2026-03-02 Miedzytorze Operator (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 191 | Tomasz Sadzyński | 1976-11-12 | 2026-03-10 PKP PLK (Rada Nadzorcza) | PKW: KO/PO; strona: PO | PUBLISHED |
| 192 | Marek Widuch | 1975-05-27 | 2026-03-10 PKP PLK (Rada Nadzorcza) | PKW: Lewica; strona: SLD | PUBLISHED |
| 193 | Bartosz Nieścior | 1991-10-05 | 2026-03-10 PKP SA (Rada Nadzorcza) | — | NOT_ON_SITE |
| 194 | Karolina Wielgosz Rogocz | 1978-05-21 | 2026-03-10 Xcity Investment (Rada Nadzorcza) | — | NOT_ON_SITE |
| 195 | Anna Ślęzak | 1973-07-30 | 2026-03-12 PKP Cargo (Rada Nadzorcza) | PKW: Lewica | NOT_ON_SITE |
| 196 | Zbigniew Prus | 1976-11-27 | 2026-03-12 PKP Cargo (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 197 | Agnieszka Pedrycz | 1977-06-16 | 2026-03-19 ZRK-DOM Poznan (PLK) (Prokurent) | — | NOT_ON_SITE |
| 198 | Maciej Marek Duch | 1980-07-27 | 2026-04-02 PKP Cargo Service (Zarząd) | — | NOT_ON_SITE |
| 199 | Małgorzata Łazarewicz | 1964-09-22 | 2026-04-10 CARGOTOR (Rada Nadzorcza) | — | NOT_ON_SITE |
| 200 | Michał Ambroziak | 1982-02-12 | 2026-04-10 CARGOTOR (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 201 | Nina Walczyk | 1991-07-23 | 2026-04-27 PKP Cargotabor (Rada Nadzorcza) | — | NOT_ON_SITE |
| 202 | Filip Flisowski | 1984-09-20 | 2026-04-28 PKP Cargo Connect (Rada Nadzorcza) | PKW: KO/PO | NOT_ON_SITE |
| 203 | Jacek Kosiński | 1977-07-14 | 2026-05-04 Xcity Investment (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 204 | Leszek Borowiec | 1974-05-28 | 2026-05-14 PKP LHS (Zarząd); 2026-06-16 Fundacja Grupy PKP (Rada Nadzorcza) | — | NOT_ON_SITE |
| 205 | Arkadiusz Sekita | 1977-03-13 | 2026-06-19 Trakcja SA (PLK 82,75%) (Rada Nadzorcza) | — | DRAFT |
| 206 | Daniel Biernacik | 1991-09-27 | 2026-06-30 PKP Intercity (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 207 | Rafał Radomski | 1977-07-11 | 2026-06-30 PKP Intercity (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 208 | Piotr Koziej | 1977-11-05 | 2026-07-13 DOLKOM Wroclaw (PLK) (Zarząd) | tylko lokalny KWW | DRAFT |
| 209 | Anna Fiedler | 1984-09-08 | 2026-07-13 DOLKOM Wroclaw (PLK) (Zarząd) | — | DRAFT |
| 210 | Piotr Grzegorczyk | 1969-04-22 | 2026-07-14 CS Natura Tour (Zarząd) | tylko lokalny KWW | DRAFT |
| 211 | Leszek Miętek | 1963-10-09 | 2026-07-27 PKP Cargo (Rada Nadzorcza) | — | NOT_ON_SITE |
| 212 | Rafał Grzeszczuk | 1987-12-11 | 2026-08-10 Pomorskie Przedsiebiorstwo Mechaniczno-Torowe (PLK) (Zarząd) | — | DRAFT |
| 213 | Wojciech Różański | 1988-02-03 | 2026-08-21 MDR Szczecin Starkiewicza (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |

## Spółki kolejowe spoza Grupy PKP (87)

| # | Osoba | ur. | Stanowisko | Sygnał partyjny | koryta.pl |
|---|---|---|---|---|---|
| 1 | Aleksandra Wilińska | 1975-10-28 | 2023-10-05 PGE EK Operator (Rada Nadzorcza) | — | NOT_ON_SITE |
| 2 | Marek Tadeusz Sterniczuk | 1986-10-06 | 2023-10-05 PGE EK Operator (Rada Nadzorcza) | — | NOT_ON_SITE |
| 3 | Dominik Zygmuntowski | 1982-09-27 | 2023-10-05 PGE EK Operator (Rada Nadzorcza) do 2024-09-02 | — | NOT_ON_SITE |
| 4 | Donata Budkiewicz Feluch | 1972-04-20 | 2023-10-17 PGE EK CUW (Rada Nadzorcza) | — | NOT_ON_SITE |
| 5 | Jarosław Roman Ziobrowski | 1984-02-14 | 2023-10-17 PGE EK CUW (Rada Nadzorcza) do 2024-07-19 | — | NOT_ON_SITE |
| 6 | Jarosław Tucholski | 1974-03-21 | 2023-10-17 PGE EK CUW (Rada Nadzorcza) do 2024-07-19 | — | NOT_ON_SITE |
| 7 | Agnieszka Szczukiewicz | 1974-10-18 | 2023-11-22 PGE Energetyka Kolejowa (Rada Nadzorcza) do 2026-02-16 | — | DRAFT |
| 8 | Krzysztof Kondraciuk | 1959-07-24 | 2023-12-08 PGE Energetyka Kolejowa (Zarząd) do 2024-04-12 | PKW: KO/PO/PiS | DRAFT |
| 9 | Stefan Józef Kalicki | 1959-10-17 | 2023-12-29 PGE EK Operator (Rada Nadzorcza) do 2024-09-02 | PKW: PiS | DRAFT |
| 10 | Katarzyna Jędruszczak | 1982-09-10 | 2024-03-06 Warszawska Kolej Dojazdowa (Rada Nadzorcza) do 2024-10-07 | PKW: KO/PO; strona: PO | PUBLISHED |
| 11 | Adrian Pasieka | 1983-01-08 | 2024-03-07 Koleje Slaskie (Rada Nadzorcza) do 2024-07-29 | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 12 | Olga Kwaśniak Cieślik | 1989-03-11 | 2024-03-08 Koleje Malopolskie (Rada Nadzorcza) | PKW: PiS | DRAFT |
| 13 | Tomasz Tomala | 1985-06-01 | 2024-03-13 Koleje Malopolskie (Prokurent) do 2024-08-26 | PKW: Lewica/PiS; strona: PiS | DRAFT |
| 14 | Hubert Królak | 1978-02-03 | 2024-04-17 Warszawska Kolej Dojazdowa (Zarząd) do 2024-12-11 | PKW: KO/PO | NOT_ON_SITE |
| 15 | Magdalena Kułak | 1982-10-27 | 2024-04-19 Polregio (Prokurent) do 2026-05-26 | — | NOT_ON_SITE |
| 16 | Szymon Sobczak | 1969-09-27 | 2024-05-06 Koleje Mazowieckie (Zarząd) | tylko lokalny KWW | DRAFT |
| 17 | Anna Wietrzyńska Pavlov | 1966-04-15 | 2024-05-20 SKM Warszawa (Prokurent) | — | NOT_ON_SITE |
| 18 | Jarosław Dusiło | 1974-09-15 | 2024-05-20 SKM Warszawa (Prokurent) do 2024-09-13 | — | NOT_ON_SITE |
| 19 | Marta Lech | 1980-11-22 | 2024-06-12 Polregio (Rada Nadzorcza) do 2025-04-08 | tylko lokalny KWW | DRAFT |
| 20 | Dariusz Maszczyk | 1969-07-22 | 2024-06-13 Koleje Slaskie (Zarząd) do 2024-07-29 | — | DRAFT |
| 21 | Łukasz Bielak | 1980-04-21 | 2024-06-18 TK Telekom (Rada Nadzorcza) do 2026-05-28 | tylko lokalny KWW | DRAFT |
| 22 | Artur Łukasiewicz | 1974-07-30 | 2024-06-18 TK Telekom (Rada Nadzorcza) do 2026-05-28 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 23 | Maria Wasiak | 1960-07-06 | 2024-06-27 SKM Warszawa (Zarząd) | PKW: KO/PO | NOT_ON_SITE |
| 24 | Marek Chmurski | 1982-05-15 | 2024-06-27 SKM Warszawa (Zarząd) | — | NOT_ON_SITE |
| 25 | Roman Smółka | 1960-01-30 | 2024-07-09 Polregio (Zarząd) do 2025-04-08 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 26 | Wojciech Dinges | 1969-04-02 | 2024-07-09 Polregio (Zarząd) do 2026-05-26 | tylko lokalny KWW | DRAFT |
| 27 | Rafał Marek | 1976-02-03 | 2024-07-25 Koleje Wielkopolskie (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 28 | Konrad Balcerski | 1981-03-05 | 2024-07-25 PGE Energetyka Kolejowa (Rada Nadzorcza) | — | NOT_ON_SITE |
| 29 | Mateusz Sławiński | 1985-11-14 | 2024-07-25 PGE Energetyka Kolejowa (Zarząd); 2024-08-09 PGE EK Holding (Zarząd) | PKW: KO/PO | NOT_ON_SITE |
| 30 | Witold Rogacki | 1979-08-25 | 2024-07-25 PGE Energetyka Kolejowa (Zarząd) | — | NOT_ON_SITE |
| 31 | Tomasz Cezary Besztak | 1977-05-03 | 2024-07-25 PGE Energetyka Kolejowa (Zarząd) do 2026-02-16; 2024-10-17 PGE EK Operator (Zarząd) do 2026-01-12; 2026-03-19 PGE EK Operator (Zarząd) | — | NOT_ON_SITE |
| 32 | Dawid Jarco | 1992-11-15 | 2024-07-29 Koleje Slaskie (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 33 | Agnieszka Siemińska | 1981-09-14 | 2024-07-29 Koleje Slaskie (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 34 | Damian Maguda | 1980-11-10 | 2024-07-29 Koleje Slaskie (Rada Nadzorcza) | — | DRAFT |
| 35 | Krzysztof Klimosz | 1974-01-18 | 2024-07-29 Koleje Slaskie (Zarząd) | strona: PO | DRAFT |
| 36 | Radosław Włoszek | 1977-10-31 | 2024-08-23 Koleje Malopolskie (Zarząd) | PKW: PiS; strona: PiS | PUBLISHED |
| 37 | Tomasz Wołujewicz | 1979-09-23 | 2024-09-03 PGE EK Operator (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 38 | Szymon Ogłaza | 1979-02-06 | 2024-09-04 Koleje Slaskie (Rada Nadzorcza) | PKW: KO/PO | DRAFT |
| 39 | Aneta Oszako Pietrzak | 1971-07-09 | 2024-09-13 SKM Warszawa (Prokurent) | PKW: Lewica | NOT_ON_SITE |
| 40 | Adam Krzysztof Wojtowicz | 1980-12-09 | 2024-09-16 Koleje Slaskie (Zarząd) | tylko lokalny KWW | DRAFT |
| 41 | Tomasz Krześniak | 1977-01-25 | 2024-09-16 Polregio (Rada Nadzorcza) do 2025-10-30 | PKW: KO/PO | DRAFT |
| 42 | Aleksandra Bocheńska | 1973-06-05 | 2024-09-23 PGE EK CUW (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 43 | Marcin Trupkiewicz | 1990-02-02 | 2024-09-23 PGE EK CUW (Rada Nadzorcza) | — | NOT_ON_SITE |
| 44 | Ewa Grabska | 1976-09-15 | 2024-10-07 Warszawska Kolej Dojazdowa (Prokurent) do 2024-12-11 | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 45 | Tomasz Tretter | 1979-11-01 | 2024-10-07 Warszawska Kolej Dojazdowa (Rada Nadzorcza) | PKW: KO/PO | DRAFT |
| 46 | Jarosław Kochaniak | 1967-03-08 | 2024-10-17 PGE EK Operator (Rada Nadzorcza) | — | NOT_ON_SITE |
| 47 | Tadeusz Krawczyk | 1976-10-18 | 2024-10-17 PGE EK Operator (Zarząd) | PKW: Lewica | NOT_ON_SITE |
| 48 | Paweł Pachoł | 1981-08-08 | 2024-10-22 Koleje Malopolskie (Zarząd) | — | DRAFT |
| 49 | Joanna Popielawska | 1982-04-29 | 2024-10-23 SKM Warszawa (Rada Nadzorcza) | — | PUBLISHED |
| 50 | Jarosław Maciej Wilk | 1987-06-18 | 2024-10-28 Koleje Slaskie (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 51 | Mieczysław Kraśniański | 1962-02-15 | 2024-10-29 Koleje Dolnoslaskie (Rada Nadzorcza) | PKW: KO/PO; strona: PO | PUBLISHED |
| 52 | Mariusz Bartłomiej Michałowski | 1976-08-24 | 2024-10-29 Koleje Dolnoslaskie (Rada Nadzorcza) | PKW: KO/PO | DRAFT |
| 53 | Jakub Górniak | 1980-11-25 | 2024-10-29 Koleje Dolnoslaskie (Rada Nadzorcza) | — | NOT_ON_SITE |
| 54 | Barbara Kulewicz | 1978-07-22 | 2024-11-06 Koleje Dolnoslaskie (Zarząd) | — | NOT_ON_SITE |
| 55 | Wioleta Przybylska | 1969-06-16 | 2024-11-19 Koleje Slaskie (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 56 | Marek Lipiński | 1971-04-19 | 2024-12-11 Warszawska Kolej Dojazdowa (Zarząd) | PKW: KO/PO | DRAFT |
| 57 | Piotr Madej | 1988-06-16 | 2024-12-11 Warszawska Kolej Dojazdowa (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 58 | Joanna Czyżewska | 1979-06-02 | 2025-01-20 PGE EK CUW (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 59 | Sandra Tymińska | 1990-03-06 | 2025-01-24 PGE Energetyka Kolejowa (Rada Nadzorcza) do 2026-07-23; 2025-08-18 PGE EK Holding (Rada Nadzorcza) do 2026-06-26 | — | NOT_ON_SITE |
| 60 | Jakub Brodziak | 1975-06-24 | 2025-04-08 Polregio (Rada Nadzorcza) do 2025-09-02 | — | NOT_ON_SITE |
| 61 | Marcin Jasiocha | 1978-07-24 | 2025-04-15 PGE EK CUW (Rada Nadzorcza) | — | NOT_ON_SITE |
| 62 | Jarosław Abramczyk | 1969-03-30 | 2025-04-25 PGE EK CUW (Zarząd) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 63 | Artur Borowicz | 1963-06-06 | 2025-05-06 Koleje Slaskie (Rada Nadzorcza) | PKW: KO/PO/Lewica | DRAFT |
| 64 | Mariusz Jankowski | 1972-04-05 | 2025-05-23 Warszawska Kolej Dojazdowa (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 65 | Anna Kaleta Marek | 1983-06-28 | 2025-06-16 Koleje Malopolskie (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 66 | Dariusz Paweł Orman | 1974-08-05 | 2025-06-16 Koleje Malopolskie (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 67 | Remigiusz Paszkiewicz | 1970-12-29 | 2025-07-03 Polregio (Rada Nadzorcza) do 2026-07-16 | — | DRAFT |
| 68 | Aleksandra Grzywaczewska | 1979-11-17 | 2025-09-02 Polregio (Rada Nadzorcza) do 2025-09-12; 2025-09-12 Polregio (Zarząd) do 2026-02-24 | — | NOT_ON_SITE |
| 69 | Marcin Kraśniewski | 1992-01-28 | 2025-09-17 PGE Energetyka Kolejowa (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 70 | Katarzyna Gawlik Tarnowska | 1971-09-23 | 2025-09-17 Polregio (Rada Nadzorcza) do 2026-02-24; 2026-02-24 Polregio (Zarząd) do 2026-03-19; 2026-03-19 Polregio (Rada Nadzorcza) do 2026-05-26; 2026-08-05 Polregio (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 71 | Tomasz Pęcherz | 1972-09-02 | 2025-10-30 Polregio (Rada Nadzorcza) | — | NOT_ON_SITE |
| 72 | Wojciech Dzienis | 1982-09-07 | 2026-02-05 PGE EK Operator (Prokurent) | — | NOT_ON_SITE |
| 73 | Rafał Krzemień | 1974-08-18 | 2026-02-23 Koleje Mazowieckie (Zarząd) | PKW: PiS; strona: PO | PUBLISHED |
| 74 | Piotr Matuszyński | 1971-03-27 | 2026-03-31 Polregio (Zarząd) | — | NOT_ON_SITE |
| 75 | Kamil Wiśniewski | 1990-09-14 | 2026-04-22 SKM Warszawa (Zarząd) | tylko lokalny KWW | NOT_ON_SITE |
| 76 | Mariusz Wiśniewski | 1978-05-07 | 2026-04-27 Koleje Wielkopolskie (Zarząd) | PKW: KO/PO/Lewica | DRAFT |
| 77 | Daniel Ryczek | 1975-07-10 | 2026-05-26 Polregio (Rada Nadzorcza) do 2026-06-01 | — | DRAFT |
| 78 | Aleksandra Jadwiga Żak | 1989-11-22 | 2026-05-28 TK Telekom (Rada Nadzorcza) | tylko lokalny KWW | NOT_ON_SITE |
| 79 | Piotr Żak | 1992-09-26 | 2026-05-28 TK Telekom (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 80 | Tobias Solorz | 1980-08-19 | 2026-05-28 TK Telekom (Rada Nadzorcza) | — | NOT_ON_SITE |
| 81 | Tomasz Piotr Szeląg | 1977-01-13 | 2026-05-28 TK Telekom (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 82 | Elżbieta Grudzień | 1970-01-17 | 2026-06-01 Polregio (Prokurent) | tylko imiennik w PKW (rocznik się nie zgadza) | NOT_ON_SITE |
| 83 | Grzegorz Kodym | 1968-07-29 | 2026-06-26 PGE EK Holding (Rada Nadzorcza) | — | DRAFT |
| 84 | Aniela Czajewska | 1977-11-29 | 2026-07-23 PGE Energetyka Kolejowa (Rada Nadzorcza) | — | DRAFT |
| 85 | Krzysztof Kłak | 1966-03-29 | 2026-07-23 PGE Energetyka Kolejowa (Zarząd) | PKW: KO/PO/Lewica/PiS; strona: PO | PUBLISHED |
| 86 | Jarosław Węgrzyn | 1982-06-05 | 2026-08-21 SKM Warszawa (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | DRAFT |
| 87 | Iwona Pietrzak | 1972-12-31 | 2026-08-21 SKM Warszawa (Rada Nadzorcza) | tylko imiennik w PKW (rocznik się nie zgadza) | PUBLISHED |
