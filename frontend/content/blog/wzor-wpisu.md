---
title: "Wzór wpisu: tekst, liczby i wykresy"
description: "Przykładowy wpis pokazujący wszystko, czego może użyć wpis na blogu Koryta.pl - na wymyślonych danych."
date: 2026-10-11
authors: [Zespół Koryta.pl]
tags: [wzór]
draft: true
---

Ten wpis jest szkicem: widać go tylko w lokalnej wersji strony, a koryta.pl go nie pokazuje. **Wszystkie liczby w nim są wymyślone.** Skopiuj plik, zmień nazwę i nagłówek, i pisz dalej - tak wygląda każdy element, którego może użyć wpis.

## Tekst

Zwykły markdown: **pogrubienie**, _kursywa_, [link do innej strony serwisu](/o-nas) i przypisy[^1]. Śródtytuły zaczynają się od dwóch krzyżyków - tytuł wpisu jest już nagłówkiem pierwszego stopnia.

- lista punktowana,
- i druga pozycja.

Osobę, instytucję albo artykuł z bazy linkuje się po identyfikatorze ich strony: :entity[Jan Kowalski]{id="1"} zasiada w zarządzie spółki :entity[Orlen]{id="2"}. Identyfikator to końcówka adresu strony, po ostatnim myślniku.

> Cytat wygląda tak.

## Liczby

::stats
---
items:
  - label: Osoby w zarządach i radach
    value: 5086
  - label: Z potwierdzonym powiązaniem
    value: 244
    hint: sprawdzone ręcznie
  - label: Odsetek potwierdzonych
    value: 4.8
    unit: "%"
---
::

## Wykres słupkowy

Jedna seria nie potrzebuje legendy - nazywa ją tytuł. Pod przyciskiem obok tytułu jest tabela z tymi samymi liczbami.

::chart{title="Osoby z powiązaniem według branży" source="Dane przykładowe"}
---
categories: [Energetyka, Transport, Finanse, Zdrowie]
series:
  - name: Osoby
    data: [120, 64, 38, 22]
unit: osób
---
::

## Kilka serii, poziomo

Przy długich nazwach kategorii słupki lepiej położyć poziomo.

::chart{title="Miejsca w spółkach gmin i spółkach Skarbu Państwa" horizontal}
---
categories: [Zarządy spółek gminnych, Rady nadzorcze spółek gminnych, Zarządy spółek Skarbu Państwa]
series:
  - name: 2023
    data: [40, 75, 31]
  - name: 2025
    data: [52, 98, 44]
---
::

## Zmiana w czasie

::chart{type="line" title="Nowe powołania w kolejnych latach"}
---
categories: [2019, 2020, 2021, 2022, 2023, 2024, 2025]
series:
  - name: Powołania
    data: [12, 18, 15, 22, 31, 54, 47]
---
::

## Części całości

::composition{title="Skąd wiemy o powiązaniu"}
---
segments:
  - label: Rejestr KRS
    value: 140
  - label: Listy wyborcze
    value: 72
  - label: Artykuły prasowe
    value: 32
---
::

## Ramka

::callout{title="Jak liczyliśmy"}
Ramka mieści dowolny markdown: akapity, **wyróżnienia**, listy. Dobre miejsce na metodę i zastrzeżenia.
::

[^1]: Przypis wygląda tak, a strzałka pod nim wraca do miejsca w tekście.
