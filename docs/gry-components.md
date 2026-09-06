# /gry — co jest wspólne, a co jest grą

Trzy rodziny mechanik z `docs/gry-ideas.md` mają wspólne części. Ten plik mówi,
co już stoi, co z tego jest generyczne, i czego brakuje dla gier, których
jeszcze nie ma. Nie jest to lista życzeń: wszystko oznaczone ✅ jest w kodzie.

## Szkielet, którego używa każda gra

| Element                                 | Gdzie  | Co robi                                                                            |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| ✅ `shared/games/engine.ts`             | shared | ziarno z daty (`dailyRandom`), `warsawDay`, `puzzleNumber`, `pickDaily`            |
| ✅ `shared/games/registry.ts`           | shared | jedna lista gier — hub, nagłówek gry i polecajka czytają to samo                   |
| ✅ `app/composables/games.ts`           | app    | `useDailyPuzzle`, `useGameProgress` (localStorage), `shareGameResult`              |
| ✅ `app/components/games/GameShell.vue` | app    | nagłówek, numer, stany ładowania/błędu, przycisk udostępniania, „inne gry na dziś” |
| ✅ `app/utils/gameIcon.ts`              | app    | ikona po slugu — `shared/` zostaje bez zależności od @mdi/js                       |

Zasada podziału: `shared/games/<gra>.ts` jest czyste i testowalne bez Firestore,
`server/api/games/<gra>.get.ts` czyta bazę, strona nie liczy nic, czego nie da
się policzyć w teście jednostkowym.

## Rodzina 1 — zgadywanie rzeczy, które nie są osobami

Kierunek studiów, partia, branża, region. Wspólne jest to, że odpowiedź pochodzi
ze **słownika**, a nie z listy węzłów grafu, więc autouzupełnianie nie zdradza
odpowiedzi (przy kilkuset pozycjach lista jest wyszukiwarką, nie menu).

- ✅ **Słownik z rankingiem** — `shared/games/education.ts` +
  `educationVocabulary.ts`. Każdy termin niesie `path` (ścieżka w drzewie
  dziedzin) i `level`, a bliskość składa się z trzech sygnałów: wspólnego
  prefiksu ścieżki (Wu-Palmer, a między gałęziami — ręcznie napisana tablica
  `areaAffinities`), odległości poziomów i pokrycia trigramami samego terminu po
  odjęciu słów poziomu („magister”, „technik”). `educationRank` zwraca miejsce
  zgadnięcia w rankingu, jak w Contexto.
- ✅ **Ranking po stronie serwera** — `/api/games/studia/guess`. Zapytanie na
  zgadnięcie, cache’owane po URL-u, dzięki czemu odpowiedź nigdy nie trafia do
  przeglądarki przed wygraną.
- ✅ **Wejście + lista prób** — na razie w `app/pages/gry/studia.vue`
  (`v-autocomplete` + lista posortowana rangą).
- ⬜ **Do wyjęcia przy drugiej takiej grze**: `GuessRankInput.vue` i
  `RankList.vue`. Świadomie jeszcze nie wyjęte — jedna gra to nie wzorzec, a
  druga powie, co jest naprawdę wspólne.
- ⚠️ **Ograniczenie**: ranking z drzewa nadal ma remisy, których embedding by
  nie miał („adwokat” i „radca prawny” są w drzewie dokładnie tak samo blisko
  „magistra prawa”; różnicuje je dopiero trigramowa końcówka wagi). Odpowiedź
  jest przypięta do #1, resztki remisów rozstrzygane alfabetycznie — stabilnie,
  ale arbitralnie.
- 📏 **Jakość rankingu jest testowana, nie deklarowana** —
  `tests/games/educationVocabulary.test.ts` liczy całą macierz podobieństw i
  pilnuje, żeby mediana największego remisu została poniżej 5% słownika. Pierwsza
  wersja (sam prefiks + poziom) miała 51%, czyli połowa listy była
  uszeregowana alfabetycznie, a nie po bliskości.

## Rodzina 2 — suwaki

Rok zmiany na stanowisku, kwota z oświadczenia majątkowego, wiek. Wspólne jest
to, że odpowiedź jest liczbą na osi, punkty maleją z odległością, a rundy
odkładają się na **tej samej osi** — końcowy ekran to obrazek dnia.

- ✅ **`app/components/games/YearSlider.vue`** — pierwszy `v-slider` w tym
  repo. `v-model` + `min`/`max` + `marks[]` (szpilki pod torem). Znaczniki są
  osobnym propem właśnie po to, żeby kolejna gra dostała drugą połowę za darmo.
- ✅ **Punktacja** — `kiedyPoints` / `kiedySquare` / `kiedyVerdict` w
  `shared/games/kiedy.ts`. Liniowa i przewidywalna: „dwa lata obok kosztowały
  czterdzieści” to reguła, przeciw której da się grać.
- ⬜ **Do zrobienia dla Majątku**: skala logarytmiczna (pieniądze) i formatowanie
  kwot. `YearSlider` celowo nie jest generyczny co do jednostki — nazwałby się
  `ValueSlider` i renderował „2014 zł”.

## Rodzina 3 — układanie w kolejności

Drabinka (wstawianie po dokładnej wielkości) i Kalendarium (wstawianie po
czasie). Tego jeszcze **nie ma** — poniżej zakres, nie kod.

- ⬜ **`OrderingBoard.vue`**: rosnąca lista zablokowanych kart plus jedna karta
  do wstawienia; wejściem jest wybór szczeliny (przyciski między kartami na
  telefonie, przeciąganie na desktopie — nie odwrotnie: przeciąganie na
  telefonie jest tym, co pogrzebało pierwszą wersję „Uszereguj”).
- ⬜ **Kontrakt**: `items: {id, label, value}[]` posortowane rosnąco po `value`,
  `revealed: string[]`, emit `place(id, slotIndex)`. Komponent nie wie, czym
  jest `value` — liczbą głosów, kwotą czy datą.
- ⬜ **Wspólne z resztą**: nagroda za trafienie (odsłonięcie dokładnej wartości)
  i rosnąca stawka są w regułach gry, nie w komponencie.
- ⚠️ **Warunek wstępny**: układanie wymaga wielkości, której gracz nie może
  sprawdzić w pół sekundy na stronie. Liczby głosów nadają się (są w danych
  wyborczych), majątek nie istnieje, a „lata w polityce” da się odczytać z
  profilu — czyli otwarta książka psuje tę konkretną kolumnę.

## Telefon jest domyślnym urządzeniem

Każda gra musi dać się wygodnie zagrać kciukiem na 375px. To nie jest lista
życzeń dostępnościowych, tylko warunek działania mechaniki — kilka rzeczy z
tego wynika wprost:

- **Suwak sam nie wystarczy.** 27 lat na 375px to ~11px na rok przy opuszku
  ~40px, a punktacja płaci pełne 100 tylko za trafiony rok. Stąd `YearSlider`
  ma steppery „−/+” obok odczytu: przeciągnij, żeby być blisko, dotknij, żeby
  wejść dokładnie. Każdy przyszły suwak (Majątek) ma ten sam problem.
- **Główna akcja pod kciukiem** — przyciski „Obstawiam” i „Sprawdź” są
  `w-100 w-sm-auto`, czyli pełna szerokość na telefonie.
- **Nic nie może polegać na `useDisplay()`.** Pod SSR Vuetify przyjmuje 1280px
  i poprawia się dopiero po hydracji, więc układ zależny od szerokości renderuje
  się najpierw jako desktopowy. Używamy klas breakpointowych i media queries —
  tak samo jak `eksploruj/tabela.vue` i `StatsHospitalBreakdown`.
- **Nic nie stoi obok siebie, jeśli może się zawinąć.** Karta zmiany
  (`succession/ChangeCard.vue`) rozkłada strony jedna pod drugą poniżej 600px i
  obraca strzałkę; lista prób w „Po jakich studiach?” trzyma werdykt pod
  terminem, bo `#append` w `v-list-item` ściska tytuł zamiast się zawijać.

## Czego brakuje po stronie danych

- **„Po jakich studiach?”** stoi na `Person.education`. W eksporcie z
  2026-09-06: 9 115 osób, **11 ma niepustą wartość**, z czego 9 ma też CV
  wystarczająco długie (≥3 wpisy), żeby o nie zapytać. To mało — ale dzień to
  jedna osoba, więc gra jest `"live"` na tej puli. Kluczowe jest `pickRotating`
  w `engine.ts`: pula jest **rozdawana** po kolei, a nie losowana każdego dnia
  niezależnie, więc dziewięć osób to dziewięć różnych dni, a nie dziewięć
  losowań, które powtarzają się co dziewiąty dzień. Każde uzupełnienie pola u
  kolejnej osoby wydłuża cykl i nie wymaga zmiany w kodzie.
  Dla porównania: 638 opublikowanych osób ma już CV ≥3 wpisów i puste
  `education` — to jest zapas, z którego pula rośnie.
- **„Kiedy?”** stoi na parach z `shared/succession.ts`, ograniczonych do tych,
  gdzie obie osoby mają opublikowaną stronę — czyli do tego, co profil i tak
  pokazuje. Tych par jest rzędu 150, więc powtórki między dniami są pewne.
  Rosną z każdą publikacją osoby.
