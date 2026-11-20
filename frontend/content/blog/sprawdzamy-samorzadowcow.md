---
title: "Jak sprawdzamy samorządowców w oświadczeniach majątkowych"
description: "Data urodzenia z oświadczenia majątkowego mówi, czy samorządowiec z wyborów i członek zarządu z KRS to ta sama osoba. Spodziewamy się opublikować tym sposobem 3584 samorządowców."
date: 2026-11-15
authors: [Zespół Koryta.pl]
tags: [oświadczenia majątkowe, samorząd, metoda]
---

Na koryta.pl szukamy połączeń między posadami w publicznych spółkach a polityką. Z KRSu mamy imię, nazwisko i dokładną datę urodzenia osoby, jednak PKW publikuje tylko datę urodzenia. To prowadzi do ryzyka pomyłki dwóch osób jako jednej.

Na szczęście, samorządowcy co roku składają co roku oświadczenia majątkowe z dokładną datą urodzenia. Gdy obie daty się zgadzają, mamy wysoką pewność że to ta sama osoba i publikujemy jej stronę. Niestety, wiele z oświadczeń jest napisanych ręcznie i nieczytelnych.

## Jak to działa

1. Automatycznie szukamy oświadczeń na stronach BIP gmin, powiatów i województw.
2. Z oświadczenia wycinamy linię z datą urodzenia.
3. Jeśli jest ona wydrukowana, czytamy ją automatycznie
4. Ręcznie napisaną datę przepisują czytelnicy na [koryta.pl/oswiadczenia](/oswiadczenia). Wystarczą dwie zgodne odpowiedzi, by uznać ją za rozczytaną.
5. Gdy data zgadza się z KRS, strona trafia na koryta.pl. Gdy nie, osoba z KRS to zwykle imiennik.

## Gdzie jesteśmy

Liczymy samorządowców z płatną posadą w publicznej spółce lub instytucji, bo tylko ich stronę może opublikować oświadczenie. Stan na 14 listopada 2026:

::stats
---
items:
  - label: Samorządowcy z płatną posadą
    value: 3584
  - label: Opublikowani
    value: 815
    hint: data się zgadza
  - label: W toku
    value: 2332
  - label: Bez oświadczenia
    value: 437
  - label: Imiennicy
    value: 156
    hint: liczeni osobno
---
::

Aktualne liczby są na stronie [Oświadczenia majątkowe](/oswiadczenia/postep).

## Duplikaty i popularne nazwiska

Im popularniejsze nazwisko, tym większa szansa na przypadkowy duplikat. 
Potwierdzają to nasze dane; dla popularnych nazwisk częściej osoba z KRS to ktoś inny niż samorządowiec o tym samym imieniu i nazwisku.

Wśród rzadkich nazwisk nie trafiliśmy dotąd na żaden duplikat, wśród najczęstszych zdarza się co drugą osobę.



::chart{title="Duplikaty wśród sprawdzonych osób, według popularności nazwiska" source="PESEL, oświadczenia majątkowe z BIP, koryta.pl"}
---
categories: [mniej niż 50 osób, 50-999, 1000-4999, 5000-19 999, 20 000 i więcej]
series:
  - name: Imiennicy
    data: [0, 3, 10, 25, 49]
unit: "%"
---
::

Wśród 2570 osób, których daty urodzenia nikt jeszcze nie przeczytał, spodziewamy się około 394 imienników, od 351 do 435.

## Dlaczego nie wszyscy mają oświadczenia

Dla 437 osób nie mamy jeszcze oświadczenia majątkowego. Do 137 nie dotarliśmy, bo BIP nie odpowiadał albo nie wpuścił robota. U 161 na BIP nie ma oświadczenia. U 139 oświadczenie jest, ale daty nie da się z niego wyciąć.

## Jak możesz pomóc

Przepisz kilka dat na [koryta.pl/oswiadczenia](/oswiadczenia). Nie trzeba zakładać konta, a każda zgodna odpowiedź przybliża publikację.

::callout{title="Jak liczyliśmy"}
- Liczymy osoby, które od 2014 roku wygrały wybory do rady, na wójta, burmistrza albo prezydenta miasta, mają stronę na koryta.pl i płatną posadę w publicznej spółce lub instytucji.
- Imiennik to osoba, której data z oświadczenia różni się od daty w KRS innym dniem albo rokiem. Imienników nie wliczamy do 3584: ich strona to ktoś inny niż samorządowiec. 32 osoby z datą, która wygląda na błąd odczytu albo cudzy plik, wyjaśniamy osobno.
- Liczbę osób o danym nazwisku podaje rejestr PESEL, osobno dla kobiet i mężczyzn.
- Szacunek to odsetek imienników w każdej grupie nazwisk razy liczba niesprawdzonych w tej grupie. Przedział to 90% wyników z tysiąca losowań.
::
