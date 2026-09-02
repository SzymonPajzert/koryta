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
  dziedzin) i `level`; bliskość to wspólny prefiks ścieżki plus odległość
  poziomów. `educationRank` zwraca miejsce zgadnięcia w rankingu, jak w Contexto.
- ✅ **Ranking po stronie serwera** — `/api/games/studia/guess`. Zapytanie na
  zgadnięcie, cache’owane po URL-u, dzięki czemu odpowiedź nigdy nie trafia do
  przeglądarki przed wygraną.
- ✅ **Wejście + lista prób** — na razie w `app/pages/gry/studia.vue`
  (`v-autocomplete` + lista posortowana rangą).
- ⬜ **Do wyjęcia przy drugiej takiej grze**: `GuessRankInput.vue` i
  `RankList.vue`. Świadomie jeszcze nie wyjęte — jedna gra to nie wzorzec, a
  druga powie, co jest naprawdę wspólne.
- ⚠️ **Ograniczenie**: ranking z drzewa ma remisy, których embedding by nie miał
  („adwokat” i „radca prawny” są dokładnie tak samo blisko „magistra prawa”).
  Odpowiedź jest przypięta do #1, reszta remisów rozstrzygana alfabetycznie —
  stabilnie, ale arbitralnie.

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
  2026-09-02: 9 280 osób, 18 ma ten klucz, **2 mają niepustą wartość**. Gra jest
  gotowa; pula nie istnieje. Po uzupełnieniu pola u kilkudziesięciu znanych osób
  wystarczy zmienić `status` w rejestrze na `"live"`.
- **„Kiedy?”** stoi na parach z `shared/succession.ts`, ograniczonych do tych,
  gdzie obie osoby mają opublikowaną stronę — czyli do tego, co profil i tak
  pokazuje. Tych par jest rzędu 150, więc powtórki między dniami są pewne.
  Rosną z każdą publikacją osoby.
