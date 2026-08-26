/** The QA changelog: every user visible change, newest first, with what to do
 * to convince yourself it works.
 *
 * Adding a feature means adding an entry here, in the same commit. The list is
 * plain TypeScript rather than data in firestore because it describes the code
 * as it is deployed - an entry is only meaningful next to the build that
 * contains the change, and it should be reviewed with it.
 *
 * What people did with an entry - checked it, found it broken - lives in the
 * `qaChecks` firestore collection instead, because that is per reader and
 * arrives long after the deploy. `id` is what joins the two, so ids are never
 * reused or renamed: doing so would silently move somebody's verdict onto a
 * different feature.
 */

/** Where in the site a change is visible, which decides who can check it. */
export type QaArea = "public" | "contributor" | "admin";

export type QaItem = {
  /** Stable, kebab-case, unique and never reused - it keys the stored checks.
   * Underscore free, so `${id}_${uid}` splits unambiguously. */
  id: string;
  /** ISO date (YYYY-MM-DD) the change landed. */
  date: string;
  /** What changed, in the language of somebody using the site. */
  title: string;
  /** Why it changed, or what it is for. One or two sentences. */
  description: string;
  /** What to click, in order, to see it. Each step stands on its own. */
  steps: string[];
  /** Where to start, if the change lives on one page. */
  link?: string;
  area: QaArea;
};

export const qaAreaConfig: Record<QaArea, { title: string; color: string }> = {
  public: { title: "Strona publiczna", color: "primary" },
  contributor: { title: "Dla zalogowanych", color: "info" },
  admin: { title: "Panel admina", color: "warning" },
};

/** Newest first. Prepend, never insert in the middle. */
export const QA_ITEMS: QaItem[] = [
  {
    id: "tabela-firmy-wszystkich-wierszy",
    date: "2026-08-26",
    title: "Kolumna „Firmy” znowu wypełniona w całej tabeli",
    description:
      "W tabeli na Eksploruj kolumna „Firmy” była pusta we wszystkich " +
      "wierszach poza pierwszym - mimo że dana osoba miała w bazie " +
      "zatrudnienie. Zapytanie o powiązania całej strony wyników traktowało " +
      "pierwszy wiersz jako temat, a pozostałe dziewięć jako jego sąsiadów, " +
      "więc ich własne firmy nigdy nie wracały z serwera. Teraz każdy wiersz " +
      "jest pytany o swoje powiązania osobno. Przy okazji działa znowu " +
      "przycisk „Rozwiń” na grafie przy domyślnej głębokości 1.",
    steps: [
      "Wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - kolumna „Firmy” ma być wypełniona w każdym wierszu, w którym osoba ma zatrudnienie, a nie tylko w pierwszym.",
      "Sprawdź konkretnie Marzenę Słomkę (trzeci wiersz przy tym sortowaniu) - ma pokazywać firmę, a nie pustą komórkę.",
      "Kliknij nazwisko z dalszego wiersza: firmy w szufladzie i w kolumnie mają się zgadzać.",
      "Przejdź na drugą stronę wyników i na inne sortowanie - to samo ma być prawdą tam.",
      "Wejdź na stronę dowolnej osoby, na grafie kliknij sąsiedni węzeł i wybierz „Rozwiń” przy suwaku głębokości ustawionym na 1 - mają dojść jego powiązania, narysowane bledszym, zewnętrznym pierścieniem.",
    ],
    link: "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
    area: "public",
  },
  {
    id: "filtr-kategoria-koleje",
    date: "2026-08-26",
    title: "Filtr kategorii firm: koleje",
    description:
      "Do filtra kategorii na Eksploruj doszła trzecia pozycja - „Koleje” - " +
      "obok szpitali oraz wodociągów i kanalizacji. Łapie przewoźników " +
      "kolejowych (pasażerskich i towarowych) oraz spółki od infrastruktury " +
      "torowej, po kodach PKD 49.10, 49.20 i 42.12. Kategorie wyliczane są " +
      "przy imporcie spółki, więc firma dostaje etykietę „Koleje” dopiero po " +
      "kolejnym przejściu importu spółek.",
    steps: [
      "Wejdź na /eksploruj/tabela i rozwiń filtry. Lista „Kategoria” ma mieć trzy pozycje: Szpitale, Wodociągi i kanalizacja, Koleje.",
      "Wybierz „Koleje” - w tabeli mają zostać tylko osoby powiązane ze spółkami kolejowymi (np. PKP), a adres ma dostać `?category=koleje`.",
      "Odśwież stronę z tym adresem: filtr ma się odtworzyć z linku, a nie wrócić do „wszystkie”.",
      "To samo sprawdź na /eksploruj/nowe - ta sama lista kategorii, ta sama zawartość po wybraniu „Koleje”.",
      "Jeśli lista wyników jest pusta, to znaczy, że import spółek nie przeliczył jeszcze kategorii - sprawdź na spółce, która ma w danych PKD 49.10/49.20/42.12.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "graf-osoby-dwa-kroki",
    date: "2026-08-25",
    title: "Strona osoby przemeblowana, graf czytelniejszy",
    description:
      "Na stronie osoby kolejność sekcji odpowiada teraz temu, po co się na " +
      "nią wchodzi: najpierw historia powiązań, potem notatki, a graf na " +
      "końcu. Sam graf pokazuje domyślnie powiązania w dwóch krokach - nie " +
      "tylko tam, gdzie ta osoba pracowała, ale też z kim tam siedziała i " +
      "gdzie jeszcze siedzą tamci. Każdy węzeł ma ikonę mówiącą, czy to " +
      "osoba, instytucja czy region; nad płótnem jest legenda i przełącznik " +
      "zasięgu, a najechanie na węzeł wygasza wszystko, co z nim nie sąsiaduje.",
    steps: [
      "Wejdź na stronę osoby z wieloma powiązaniami (np. przez wyszukiwarkę wpisz nazwisko) i sprawdź kolejność: karta osoby, „Historia powiązań”, notatki, graf.",
      "W grafie porównaj węzły: osoba to kółko z sylwetką, instytucja to prostokąt z budynkiem, region to prostokąt z mapą. Legenda nad płótnem mówi to samo.",
      "Sprawdź, że osoba, której to strona, jest największa i ma obwódkę, a węzły drugiego kroku są mniejsze i bledsze.",
      "Najedź kursorem na dowolny węzeł - reszta grafu ma zblednąć, a podpisy zniknąć wszędzie poza jego sąsiadami.",
      "Kliknij węzeł raz: na pasku pod płótnem pojawia się jego nazwa z przyciskiem „Otwórz stronę”. Kliknij dwa razy: strona się otwiera.",
      "Przełącz zasięg na „1 krok” i z powrotem na „2 kroki” - graf ma się przerysować, a przy dużej liczbie dalszych powiązań pod płótnem pojawia się „Pominięto N dalszych powiązań”.",
    ],
    area: "public",
  },
  {
    id: "extraction-matched-person",
    date: "2026-08-25",
    title: "Fakt z artykułu pokazuje, do kogo z bazy został przypisany",
    description:
      "Potok wyszukiwania faktów potrafi już powiedzieć, które osoby z naszej " +
      "bazy są w artykule wymienione, i każdy fakt jest łączony z tą z nich, " +
      "której imię i nazwisko nosi. Na karcie faktu ta osoba jest " +
      "podlinkowana i podpisana jako osoba w bazie. Łączenie po nazwisku " +
      "bywa mylne - dwie osoby o tym samym nazwisku wyglądają tak samo - " +
      "więc pod nazwiskiem jest przycisk To nie ta osoba, którym można " +
      "zgłosić, że fakt dotyczy kogoś innego.",
    steps: [
      "Wejdź na /ekstrakcje i rozwiń artykuł: fakt dopasowany do kogoś z bazy ma pod nazwiskiem podpis osoba w bazie, a niedopasowany tylko osoba.",
      "Kliknij podlinkowane nazwisko - ma otworzyć stronę tej osoby w bazie, nie artykuł.",
      "Kliknij To nie ta osoba - napis ma się zmienić na Zgłoszono złe dopasowanie, a karta ma zostać na miejscu (to nie jest ocena faktu).",
      "Kliknij jeszcze raz - zgłoszenie ma zostać cofnięte.",
      "Wejdź na /ekstrakcje/kategoryzacja - ta sama informacja i ten sam przycisk mają być na karcie do oceny.",
      "Zgłoś złe dopasowanie i wróć na stronę po dłuższej chwili - fakt ma dalej być podpisany jako zgłoszony (podliczenie głosów idzie w tle, a odpowiedź jest przez minutę cache'owana).",
    ],
    link: "/ekstrakcje",
    area: "contributor",
  },
  {
    id: "home-intro-and-no-cta-on-phone",
    date: "2026-08-25",
    title: "Strona główna na telefonie: zdanie, wyszukiwarka, mapa",
    description:
      "Na wąskim ekranie nad wyszukiwarką jest jedno zdanie o tym, co ta " +
      "strona robi - zabrakło go, kiedy logo i nagłówek zeszły z pierwszego " +
      "ekranu. Przycisk âDziałaj z namiâ znika z telefonów, żeby mapa " +
      "koryciarstwa była pierwszą rzeczą pod wyszukiwarką; ten sam " +
      "odnośnik jest teraz w stopce, więc dalej można do niego trafić.",
    steps: [
      "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na stronę główną - nad wyszukiwarką ma być jedno zdanie o tym, co robimy.",
      "Sprawdź, że pod wyszukiwarką nie ma już przycisku âDziałaj z namiâ i że zaraz pod nią zaczyna się mapa.",
      "Przewiń na sam dół - w stopce, w âO projekcieâ, ma być âDziałaj z namiâ, prowadzące na /pomoc.",
      "Rozszerz okno powyżej 960 px - wraca logo, nagłówek i przycisk obok wyszukiwarki, a zdanie znika (mówi to samo, co nagłówek).",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "tabela-starts-at-the-table",
    date: "2026-08-25",
    title: "Tabela na telefonie zaczyna się od tabeli",
    description:
      "Na wąskim ekranie filtry są zwinięte pod jeden przycisk, nagłówek jest " +
      "mniejszy, a banerek logowania nie wypycha już przycisku poza ekran. " +
      "Pierwszy wiersz tabeli był 1300 px w dół - trzy machnięcia palcem - i " +
      "jest teraz od razu pod filtrem. Na komputerze wszystko zostaje po " +
      "staremu, filtry są rozwinięte.",
    steps: [
      "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na /eksploruj/tabela - tabela ma być widoczna bez przewijania albo po jednym machnięciu.",
      "Kliknij przycisk âFiltry i wyszukiwanieâ - filtry mają się rozwinąć i zwinąć ponownie.",
      "Ustaw jakiś filtr, na przykład partię, i zwiń panel - na przycisku ma być âFiltry (1)â, żeby nie filtrował po cichu.",
      "Wyloguj się i sprawdź niebieski banerek: przycisk âZaloguj sięâ ma być pod tekstem, w całości na ekranie.",
      "Spróbuj przewinąć stronę w bok - nie ma czego, nic nie wystaje poza ekran.",
      "Rozszerz okno powyżej 960 px - filtry mają być rozwinięte, bez przycisku do zwijania.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "reviewer-queue-one-button",
    date: "2026-08-25",
    title: "Kolejka rewizji: jeden przycisk zamiast pięciu",
    description:
      "Wiersz w kolejce ma teraz jeden przycisk - âRozpatrzâ - który otwiera " +
      "porównanie rewizji tego wpisu z tą jedną podświetloną i przewiniętą " +
      "na widok. Decyzje zapadają tam, gdzie widać całą zmianę, a nie w " +
      "najwęższej kolumnie tabeli. Autor i data to jedna kolumna " +
      "âZgłoszenieâ na początku wiersza, a âCzego dotyczyâ nie rozpycha się " +
      "już na tytuł artykułu.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/kolejka.",
      "Sprawdź pierwszą kolumnę âZgłoszenieâ - w jednym miejscu ma być autor, kiedy zgłosił i status.",
      "Sprawdź ostatnią kolumnę - ma być w niej dokładnie jeden przycisk.",
      "Kliknij âRozpatrzâ - otwiera się porównanie rewizji tego wpisu, a kolumna z tą rewizją jest podświetlona i widoczna bez przewijania w bok.",
      "Zatwierdź albo odrzuć ją tam i wróć do kolejki - przycisk przy rozpatrzonej zmienia się na âZobaczâ.",
      "Ustaw filtr âRodzajâ na âWszystkoâ i znajdź rewizję powiązania - jej przycisk ma prowadzić na /admin/rewizje-krawedzi, bo powiązania recenzuje się tam.",
      "Znajdź rewizję artykułu o długim tytule - kolumna âCzego dotyczyâ ma być wąska, tytuł ucięty po dwóch liniach, a cały widoczny w dymku po najechaniu.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "drawer-admin-revisions-link",
    date: "2026-08-25",
    title: "Skrót do rewizji także w panelu bocznym",
    description:
      "Przycisk âRewizjeâ, który admin ma na stronie osoby, jest teraz również " +
      "w panelu bocznym otwieranym z tabeli - w tej samej linii co âZaproponuj " +
      "zmianęâ i głosy. Nie trzeba już wychodzić z tabeli, żeby dojść do " +
      "ekranu, na którym stronę się publikuje.",
    steps: [
      "Jako admin wejdź na /eksploruj/tabela i kliknij nazwisko - w panelu, w linii z głosami, ma być przycisk âRewizjeâ.",
      "Kliknij go - ma otworzyć listę rewizji tej samej osoby, którą panel pokazywał.",
      "Wróć do tabeli, otwórz inną osobę i sprawdź, że przycisk prowadzi do niej, a nie do poprzedniej.",
      "Zaloguj się jako zwykły użytkownik i powtórz - âZaproponuj zmianęâ ma być, âRewizjiâ nie.",
    ],
    link: "/eksploruj/tabela",
    area: "admin",
  },
  {
    id: "admin-feedback-settled-dimmed",
    date: "2026-08-25",
    title: "Załatwione zgłoszenia schodzą na drugi plan",
    description:
      "W kolejce zgłoszeń widać teraz na pierwszy rzut oka, czym nikt nie " +
      "musi się już zajmować: zgłoszenia ze statusem „Załatwione” i „Nie " +
      "robimy” są wyszarzone. Nie znikają - najechanie kursorem przywraca im " +
      "pełny kontrast, a filtr statusu nad listą dalej pozwala je ukryć.",
    steps: [
      "Jako admin wejdź na /admin/opinie.",
      "Ustaw jednemu zgłoszeniu status „Załatwione” - jego karta ma od razu zblednieć.",
      "Najedź na tę kartę kursorem - ma wrócić do pełnego kontrastu, a status dalej ma się dać zmienić.",
      "Ustaw innemu status „W trakcie” - ta karta ma zostać normalna, bo to wciąż robota do zrobienia.",
      "Wybierz w filtrze u góry „Załatwione” - lista ma pokazać same wyszarzone karty.",
    ],
    link: "/admin/opinie",
    area: "admin",
  },
  {
    id: "kto-kogo-zastapil",
    date: "2026-08-24",
    title: "Kto kogo zastąpił w spółce",
    description:
      "Na stronie instytucji jest nowa sekcja „Kto kogo zastąpił”: pary " +
      "ustępujący - obejmujący stanowisko, dobrane w obrębie jednej spółki i " +
      "jednej funkcji. Zmiany z tego samego dnia zebrane są w jedno " +
      "wydarzenie, bo tak właśnie rejestr zapisuje wymianę całej rady. Na " +
      "stronie osoby to samo widać od jej strony, w sekcji „Zmiany na " +
      "stanowisku”, a w historii powiązań przy takim wpisie stoi linijka " +
      "„Wcześniej: …”.",
    steps: [
      "Wejdź na stronę dużej spółki (np. przez wyszukiwarkę wpisz „Tauron”) i zjedź do sekcji „Kto kogo zastąpił”.",
      "Znajdź kartę z kilkoma zmianami z jednej daty - ma mieć jeden nagłówek z datą i odznakę „N zmian tego samego dnia”, a nie N osobnych kart.",
      "Sprawdź opis przerwy przy strzałce: „tego samego dnia”, „po N dniach przerwy” albo „wpisy nachodzą na siebie o N dni”.",
      "Kliknij nazwisko po obu stronach strzałki - ma otwierać stronę tej osoby.",
      "Zwęź okno do szerokości telefonu - wiersz ma się przełamać w pionie, strona nie może przewijać się w bok.",
      "Wejdź na stronę osoby, która kogoś zastąpiła (np. /osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg) - pod historią powiązań ma być sekcja „Zmiany na stanowisku” z liczbą „N z M powiązań”.",
      "Wyloguj się i otwórz tę samą stronę spółki - zmian ma być mniej, a pod sekcją ma stać informacja, ilu nie pokazujemy, bo brakuje strony jednej z osób.",
      "Zaloguj się z powrotem i odśwież tę stronę (F5, nie klikając w menu) - napis „nie pokazujemy” ma zniknąć, a brakujące osoby mają się pojawić z nazwiskami.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "instytucja-ma-wlasna-strone",
    date: "2026-08-24",
    title: "Instytucja ma znów własną stronę",
    description:
      "Kliknięcie w spółkę nie przenosi już do tabeli osób przefiltrowanej " +
      "do niej, tylko na stronę tej spółki: numery rejestrowe z odnośnikiem " +
      "do rejestr.io, siedziba, właściciele, spółki zależne, obecny skład, " +
      "historia powiązań i graf. Tabela jest nadal dostępna przyciskiem " +
      "„Eksploruj powiązania”.",
    steps: [
      "W wyszukiwarce u góry wpisz nazwę spółki i wybierz ją - ma się otworzyć adres /instytucja/… , a nie /eksploruj/tabela.",
      "Sprawdź kartę na górze: nazwa, „Instytucja publiczna”, numer KRS jako podkreślony odnośnik (nie jasnozielony) prowadzący do rejestr.io.",
      "Kliknij „Eksploruj powiązania” - ma otworzyć starą tabelę przefiltrowaną do tej spółki.",
      "Sprawdź, że sekcja „Historia powiązań” pojawia się raz, a nie dwa razy (kiedyś te same powiązania rysowały się też jako kafelki niżej).",
      "Wejdź na stronę osoby i kliknij w jej miejsce pracy - ma prowadzić na stronę spółki.",
      "Otwórz stronę instytucji bez numeru KRS (ministerstwo, urząd) - zamiast KRS mają być REGON i NIP.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "entity-page-admin-revisions-link",
    date: "2026-08-24",
    title: "Skrót do rewizji i publikacji ze strony osoby",
    description:
      "Admin na stronie osoby wchodzi wprost na jej listę rewizji, gdzie " +
      "stronę się publikuje, zamiast szukać jej po id w /admin/rewizje. " +
      "Przycisk stoi pod ołówkiem i oceną, razem z resztą tego, co można na " +
      "tej stronie zrobić.",
    steps: [
      "Jako admin wejdź na /eksploruj/tabela i kliknij dowolną osobę.",
      "Przy nazwisku, pod przyciskiem edycji i oceną, kliknij „Rewizje i publikacja” - ma otworzyć listę rewizji tej właśnie osoby.",
      "Sprawdź na górze tamtej strony, czy osoba jest opublikowana, i w razie potrzeby opublikuj ją.",
      "Wróć na stronę osoby i sprawdź, że przycisk prowadzi tam samo.",
      "Wyloguj się (albo zaloguj jako zwykły użytkownik) i otwórz tę samą stronę - przycisku ma nie być.",
      "Zwęź okno poniżej 960 px - przycisk chowa się razem z edycją i oceną, tak jak one.",
    ],
    link: "/eksploruj/tabela",
    area: "admin",
  },
  {
    id: "home-compact-on-phone",
    date: "2026-08-24",
    title: "Strona główna na telefonie zaczyna się od wyszukiwarki",
    description:
      "Na wąskim ekranie strona główna nie otwiera się już logiem i nagłówkiem " +
      "na całe pierwsze przewinięcie - pierwsza jest wyszukiwarka. Znikają też " +
      "sekcja „Przeglądaj osoby” z dwoma kafelkami i przycisk „Albo zacznij " +
      "działać”, bo prowadzą tam, gdzie wyszukiwarka i „Działaj z nami”. Na " +
      "komputerze wszystko zostaje po staremu.",
    steps: [
      "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na stronę główną - u góry ma być wyszukiwarka, bez logo i bez zdania „Jesteśmy największym…”.",
      "Sprawdź przycisk „Działaj z nami” pod wyszukiwarką - ma zaczynać się w tej samej linii co pole wyszukiwania, nie bardziej z lewej.",
      "Przewiń stronę - między mapą a sekcją „Zostało nam jeszcze dużo osób” nie ma już „Przeglądaj osoby” ani kafelków „Tabela powiązań” i „Przeglądaj nowe”.",
      "W sekcji „Zostało nam jeszcze dużo osób” ma być jeden przycisk „Chcę pomóc! (ankieta)”, bez „Albo zacznij działać”.",
      "Kliknij wyszukiwarkę i wybierz „Lista wszystkich osób” - tabela ma się otworzyć, mimo że kafelka do niej już nie ma.",
      "Rozszerz okno powyżej 960 px - logo, nagłówek, sekcja „Przeglądaj osoby” i drugi przycisk mają wrócić.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "queue-plain-entry-links",
    date: "2026-08-24",
    title: "Nazwy wpisów w kolejce bez niebieskiego",
    description:
      "Kolejka zmian pokazuje nazwy wpisów tak samo jak profil - czarnym " +
      "tekstem, który podkreśla się dopiero pod kursorem, zamiast kolumny " +
      "niebieskich odnośników. Klikają tak samo jak wcześniej.",
    steps: [
      "Wejdź na /admin/rewizje/kolejka i spójrz na kolumnę z nazwami wpisów - mają być czarne, bez podkreślenia.",
      "Najedź kursorem na nazwę - ma się podkreślić.",
      "Kliknij ją - ma otworzyć stronę wpisu, tak jak dotąd.",
      "Porównaj z listą na /profil - obie mają wyglądać tak samo.",
      "Znajdź wiersz z powiązaniem albo z usuniętym wpisem - nazwa ma być zwykłym tekstem, bez odnośnika.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "profile-proposal-filters",
    date: "2026-08-24",
    title: "Filtrowanie własnych propozycji, mniej niebieskiego",
    description:
      "Kafelki ze stanami na profilu nie tylko liczą propozycje - kliknięcie " +
      "zawęża listę do tego stanu, a ponowne kliknięcie ją przywraca. Nazwy " +
      "wpisów nie są już podkreślonymi, niebieskimi odnośnikami.",
    steps: [
      "Zaloguj się i wejdź na /profil, do sekcji „Twoje propozycje zmian”.",
      "Sprawdź nazwy wpisów na liście - mają być czarne jak reszta tekstu, podkreślają się dopiero pod kursorem.",
      "Kliknij kafelek „Oczekujące” - lista ma pokazać tylko oczekujące, a liczby na kafelkach mają zostać bez zmian.",
      "Kliknij ten sam kafelek jeszcze raz (albo „Pokaż wszystkie”) - wraca pełna lista.",
      "Kafelek ze stanem, w którym nic nie masz (np. „Odrzucone 0”), ma być wyszarzony i nieklikalny.",
      "Przy aktywnym filtrze „Zatwierdzone” sprawdź podpis pod kafelkami - ma uprzedzać, że są w nim też zastąpione.",
    ],
    link: "/profil",
    area: "contributor",
  },
  {
    id: "qa-link-in-admin-panel",
    date: "2026-08-24",
    title: "Lista QA schodzi z paska na panel",
    description:
      "Pasek u góry nie nosi już przycisku „QA” ani licznika, który przy " +
      "każdym zgłoszonym problemie robił się czerwony na każdej podstronie. " +
      "Wejście do listy jest teraz w panelu administracyjnym, a sama lista " +
      "zostaje otwarta dla każdego zalogowanego.",
    steps: [
      "Zaloguj się i przejdź po kilku podstronach - w pasku pod górnym menu nie ma już przycisku „QA” ani liczby przy nim.",
      "Wejdź na /admin i znajdź kafelek „QA” wśród podstron - ma prowadzić na /qa.",
      "Wpisz /qa ręcznie w adres jako zwykły (nieadministrujący) użytkownik - strona ma się otworzyć normalnie.",
    ],
    link: "/admin",
    area: "contributor",
  },
  {
    id: "home-recent-employments",
    date: "2026-08-23",
    title: "Ostatnie zatrudnienia na stronie głównej",
    description:
      "Na dole strony głównej lecą kolejne stanowiska, od najświeżej " +
      "objętego. Przewijanie dokłada następne, a kliknięcie kafelka prowadzi " +
      "do strony osoby, nie firmy.",
    steps: [
      "Wejdź na stronę główną i przewiń na sam dół, do sekcji „Ostatnie zatrudnienia”.",
      "Sprawdź daty na kafelkach - mają iść od najnowszej w dół, a nie w losowej kolejności.",
      "Porównaj daty na kafelkach: stanowisko wciąż zajmowane („obecnie”) ma mieć datę na zielono, zakończone - na szaro.",
      "Najedź myszą na kafelek - ma się delikatnie unieść, a strzałka po prawej zmienić kolor.",
      "Przewijaj dalej - po chwili ma dojść kolejna porcja, bez klikania czegokolwiek.",
      "Kliknij dowolny kafelek - ma otworzyć stronę osoby, a nie instytucji.",
      "Zwęź okno do szerokości telefonu - kafelki mają ustawić się w jednej kolumnie zamiast dwóch.",
      "Przewiń do samego końca listy - ma pojawić się napis, że to już wszystkie zatrudnienia.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "tabela-columns-on-phone",
    date: "2026-08-23",
    title: "Tabela na telefonie tylko z czterema kolumnami",
    description:
      "Na wąskim ekranie tabela „Eksploruj” pokazuje już tylko imię i " +
      "nazwisko, partie, firmy oraz wybory. Kolumny do eksploracji - " +
      "notatki, głosy, twój głos, widoczność i przyciski - znikają, bo " +
      "wszystko to jest w panelu, który otwiera się po kliknięciu nazwiska.",
    steps: [
      "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na /eksploruj/tabela.",
      "Sprawdź, że w nagłówku są tylko „Imię i nazwisko”, „Partie”, „Firmy” i „Wybory”.",
      "Znajdź osobę z długą nazwą partii („Konfederacja”) - plakietka ma być ucięta wielokropkiem, a nie rozpychać kolumny.",
      "Sprawdź, że tabeli nie da się przewinąć w bok: żadna kolumna nie wystaje poza ekran.",
      "Kliknij nazwisko - panel ma się otworzyć od dołu, z głosami i notatkami tej osoby.",
      "Rozszerz okno powyżej 960 px - mają wrócić wszystkie kolumny, razem z „Głosy łącznie” i „Eksploruj”.",
      "Zaloguj się i powtórz to samo na wąskim ekranie - kolumny „Widoczność” też ma nie być.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "feedback-from-qa",
    date: "2026-08-23",
    title: "Uwaga z listy QA idzie prosto do zespołu",
    description:
      "Zgłoszony tu problem - i każda uwaga dopisana do wpisu - trafia tam, " +
      "gdzie zgłoszenia z przycisku „Zgłoś”: na kanał zespołu i do panelu. " +
      "Nie trzeba pisać tego samego drugi raz.",
    steps: [
      "Rozwiń dowolny wpis, wpisz uwagę i kliknij „Coś nie działa”.",
      "Sprawdź komunikat na dole - ma powiedzieć, że zgłoszenie poszło do zespołu.",
      "Jako admin wejdź na /admin/opinie: zgłoszenie ma tam być, z chipem „QA” i nazwą wpisu.",
      "Kliknij ten chip - ma wrócić dokładnie na ten wpis na /qa.",
      "Kliknij „Działa” bez wpisywania uwagi przy innym wpisie - to samo sprawdzenie, ale w panelu nic nowego się nie pojawia.",
      "Kliknij drugi raz to samo z tą samą uwagą - też nie ma powstać nowe zgłoszenie.",
    ],
    link: "/qa",
    area: "contributor",
  },
  {
    id: "feedback-button",
    date: "2026-08-23",
    title: "Przycisk „Zgłoś” na każdej stronie",
    description:
      "Każdy - także niezalogowany - może powiedzieć, co jest nie tak, bez " +
      "zakładania konta i bez szukania kontaktu. Zgłoszenie zabiera ze sobą " +
      "stronę, na której było pisane.",
    steps: [
      "Otwórz dowolną stronę osoby i kliknij „Zgłoś” w prawym dolnym rogu.",
      "Wybierz rodzaj, napisz kilka słów i wyślij - ma pojawić się podziękowanie.",
      "Zalogowany: sprawdź, że e-mail jest już wpisany, a pod spodem jest napisane, że zgłoszenie będzie podpisane.",
      "Wyczyść pole e-mail i wyślij ponownie - opis ma się zmienić na anonimowy.",
      "Wyloguj się i zgłoś coś jeszcze raz - ma się udać tak samo.",
    ],
    area: "public",
  },
  {
    id: "admin-feedback-queue",
    date: "2026-08-23",
    title: "Kolejka zgłoszeń w panelu admina",
    description:
      "Wszystkie zgłoszenia w jednym miejscu, ze statusem i notatką, a na " +
      "stronie głównej panelu licznik nieruszonych.",
    steps: [
      "Jako admin wejdź na /admin i sprawdź kafelek „Nowe zgłoszenia”.",
      "Przejdź do /admin/opinie i zmień status jednego zgłoszenia.",
      "Odśwież stronę - status i notatka mają się utrzymać, a licznik na /admin zmniejszyć.",
      "Sprawdź, że zgłoszenie anonimowe jest oznaczone jako anonimowe i nie pokazuje konta.",
    ],
    link: "/admin/opinie",
    area: "admin",
  },
  {
    id: "person-notes-require-login",
    date: "2026-08-23",
    title: "Notatki o osobie tylko dla zalogowanych",
    description:
      "Na stronie osoby karta „Notatki” pokazuje się dopiero po " +
      "zalogowaniu. Notatki to niezweryfikowane twierdzenia o konkretnym " +
      "człowieku, więc nie wyświetlamy ich anonimowym czytelnikom. Strony " +
      "spółek, regionów i tematów zostają bez zmian.",
    steps: [
      "Wyloguj się i wejdź na stronę osoby, która ma notatki - karty „Notatki” ma nie być.",
      "Zaloguj się i odśwież tę samą stronę - karta ma się pojawić razem z notatkami.",
      "Wylogowany otwórz stronę spółki albo tematu - tam karta „Notatki” ma być widoczna jak dotąd.",
    ],
    area: "public",
  },
  {
    id: "elections-column-narrower",
    date: "2026-08-23",
    title: "Węższa kolumna wyborów i przewijanie tabeli w bok",
    description:
      "Nazwa komitetu wyborczego i pełna nazwa okręgu przeniosły się z " +
      "plakietki do dymka, więc kolumna „Wybory” nie rozpycha już tabeli. " +
      "Kolumny, które i tak nie mieszczą się na ekranie, da się teraz " +
      "przewinąć w bok - wcześniej były po prostu ucięte.",
    steps: [
      "Wejdź na /eksploruj/tabela i znajdź osobę z wyborami - plakietka ma pokazywać rok i okręg, ucięty wielokropkiem, jeśli jest długi.",
      "Najedź na plakietkę - dymek ma podać pełną nazwę okręgu, województwo i komitet, jeśli jest znany.",
      "Na komputerze przewiń stronę w bok - kolumny od „Głosy łącznie” w prawo mają być dostępne.",
      "Przewiń stronę w dół - nagłówek tabeli ma nadal przyklejać się pod paskiem u góry.",
      "Przewiń w bok przy przyklejonym nagłówku - nagłówek ma jechać razem z kolumnami.",
      "Wejdź na inną stronę, np. /o-nas - poziomego paska przewijania ma tam nie być.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "drawer-bottom-on-phone",
    date: "2026-08-23",
    title: "Panel boczny od dołu na telefonie",
    description:
      "Na wąskim ekranie panel osoby wysuwa się od dołu i zajmuje prawie " +
      "całą wysokość, zamiast wciskać mapę i historię zatrudnienia w pasek " +
      "przy krawędzi.",
    steps: [
      "Na telefonie (albo w przeglądarce zwęź okno poniżej 960 px) wejdź na /eksploruj/tabela i kliknij wiersz z osobą.",
      "Sprawdź, że panel wjeżdża od dołu, ma zaokrąglone górne rogi i mieści mapę oraz historię zatrudnienia bez poziomego przewijania.",
      "Zamknij go krzyżykiem i kliknięciem w przyciemnione tło nad panelem.",
      "Rozszerz okno powyżej 960 px i kliknij wiersz - panel ma wrócić do prawej krawędzi.",
      "Obróć telefon na poziomo przy otwartym panelu - ma się przeskalować do nowej wysokości, a nie zostać za wysoki.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "qa-changelog",
    date: "2026-08-22",
    title: "Lista zmian do sprawdzenia",
    description:
      "Ta strona. Każda nowa zmiana na stronie dostaje tu wpis z instrukcją, " +
      "co kliknąć, żeby ją zobaczyć. Zalogowany użytkownik oznacza, czy " +
      "działa, i zostawia uwagi.",
    steps: [
      "Otwórz QA z paska na górze - licznik pokazuje, ilu zmian Ty jeszcze nie sprawdziłeś.",
      "Rozwiń wpis i sprawdź, że kroki opisują to, co faktycznie widać.",
      "Kliknij „Działa” albo „Coś nie działa” i dopisz uwagę.",
      "Odśwież stronę - Twój wybór i uwaga mają się utrzymać.",
      "Przełącz filtr na „Wszystkie” - sprawdzony wpis ma zniknąć z listy „Do sprawdzenia”.",
      "Zaloguj się na drugie konto - ten sam wpis ma tam nadal czekać na sprawdzenie.",
    ],
    link: "/qa",
    area: "contributor",
  },
  {
    id: "person-places-map",
    date: "2026-08-22",
    title: "Mapa miejsc osoby w panelu bocznym",
    description:
      "Panel boczny osoby rysuje na mapie Polski województwa, w których " +
      "pracowała, zamiast wyliczać je tekstem.",
    steps: [
      "Wejdź na /eksploruj/tabela i kliknij wiersz z osobą.",
      "W panelu bocznym znajdź mapę i sprawdź, że podświetlone województwa zgadzają się z listą pracodawców.",
      "Kliknij osobę bez znanych miejsc pracy - mapy ma nie być zamiast pustej.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "vote-label-under-pill",
    date: "2026-08-22",
    title: "Opis oceny pod pigułką, nie obok",
    description:
      "Etykieta oceny („Grube koryto”, „Ciekawe”) trafiła pod przycisk, żeby " +
      "nie rozpychała wiersza na wąskim ekranie.",
    steps: [
      "Otwórz stronę dowolnej osoby i najedź na ocenę.",
      "Sprawdź na telefonie (albo w wąskim oknie), że opis nie ucina sąsiednich elementów.",
    ],
    area: "public",
  },
  {
    id: "my-contributions",
    date: "2026-08-21",
    title: "Co się stało z moimi zgłoszeniami",
    description:
      "Profil pokazuje rewizje zgłoszone przez zalogowanego użytkownika wraz " +
      "z decyzją recenzenta.",
    steps: [
      "Zaloguj się i wejdź na /profil.",
      "Znajdź sekcję z własnymi rewizjami i sprawdź statusy (oczekuje / przyjęta / odrzucona).",
      "Kliknij rewizję - ma prowadzić do tego, czego dotyczy.",
    ],
    link: "/profil",
    area: "contributor",
  },
  {
    id: "reviewer-queue",
    date: "2026-08-21",
    title: "Jeden ekran do przeglądania kolejki rewizji",
    description:
      "Kolejka rewizji pokazuje różnicę, przycisk przyjęcia i odrzucenia w " +
      "jednym miejscu, razem z powodem odrzucenia.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/kolejka.",
      "Sprawdź, że różnica wymienia tylko pola, które faktycznie się zmieniają.",
      "Odrzuć rewizję z powodem i sprawdź, że powód widać przy niej później.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "cite-existing-relation",
    date: "2026-08-19",
    title: "Artykuł jako źródło istniejącej relacji",
    description:
      "Można wskazać artykuł jako źródło powiązania, które już jest w bazie, " +
      "bez zakładania go od nowa.",
    steps: [
      "Otwórz stronę artykułu i użyj przycisku dodania źródła do istniejącej relacji.",
      "Wybierz osobę i jej pracodawcę, których powiązanie już istnieje.",
      "Wróć na stronę osoby i sprawdź, że artykuł jest wymieniony przy tym zatrudnieniu.",
    ],
    area: "contributor",
  },
  {
    id: "person-search-by-city",
    date: "2026-08-19",
    title: "Szukanie osoby po mieście, w którym pracowała",
    description:
      "Wyszukiwarka osób dopasowuje też miasta pracodawców, nie tylko imię i " +
      "nazwisko.",
    steps: [
      "W wyszukiwarce na górze wpisz nazwę miasta, np. „Katowice”.",
      "Sprawdź, że wśród wyników są osoby zatrudnione w spółkach z tego miasta.",
      "Sprawdź, że szukanie po nazwisku nadal zwraca to co wcześniej.",
    ],
    area: "public",
  },
];

/** What a reader concluded about one entry. */
export type QaCheckStatus = "ok" | "issue";

/** One reader's verdict on one changelog entry.
 *
 * Stored in `qaChecks` under the id `${itemId}_${userUid}`, so a person has at
 * most one verdict per entry and the firestore rule can check ownership from
 * the document id alone - the same shape `votes` uses.
 */
export type QaCheck = {
  itemId: string;
  userUid: string;
  status: QaCheckStatus;
  /** What was wrong, or anything worth saying about a change that works. */
  feedback?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function qaCheckId(itemId: string, userUid: string): string {
  return `${itemId}_${userUid}`;
}

/** Where an entry stands for one person.
 *
 * Verification is per reader, not per entry: an entry somebody else has been
 * through is still unchecked for everybody who has not looked at it, because
 * what QA is worth is a second pair of eyes. A verdict says only what its
 * author found; it never settles the entry for anyone else.
 */
export type QaItemState = "unchecked" | "ok" | "issue";

export function qaItemState(
  itemId: string,
  checks: readonly QaCheck[],
  userUid: string | undefined,
): QaItemState {
  if (!userUid) return "unchecked";
  const mine = checks.find(
    (check) => check.itemId === itemId && check.userUid === userUid,
  );
  return mine?.status ?? "unchecked";
}

export const qaStateConfig: Record<
  QaItemState,
  { title: string; color: string }
> = {
  unchecked: { title: "Do sprawdzenia", color: "grey" },
  ok: { title: "Sprawdzone", color: "success" },
  issue: { title: "Zgłoszony problem", color: "error" },
};

/** How many entries are in each state for this reader, for the badge on the
 * toolbar. */
export function qaStateCounts(
  items: readonly QaItem[],
  checks: readonly QaCheck[],
  userUid: string | undefined,
): Record<QaItemState, number> {
  const counts: Record<QaItemState, number> = {
    unchecked: 0,
    ok: 0,
    issue: 0,
  };
  for (const item of items) counts[qaItemState(item.id, checks, userUid)] += 1;
  return counts;
}

/** Whether anybody other than `userUid` reported a problem with an entry.
 *
 * Someone else's report does not decide this reader's verdict, but it is worth
 * knowing before they start: it says what to look for. */
export function qaReportedByOthers(
  itemId: string,
  checks: readonly QaCheck[],
  userUid: string | undefined,
): boolean {
  return checks.some(
    (check) =>
      check.itemId === itemId &&
      check.status === "issue" &&
      check.userUid !== userUid,
  );
}

/** How a verdict reads in prose - on a card in Slack, in the admin queue, and
 * under "Co napisali inni". */
export const qaStatusLabels: Record<QaCheckStatus, string> = {
  ok: "Działa",
  issue: "Coś nie działa",
};

/** Whether a verdict is worth putting in front of the team, and not just
 * recording as this reader's own tick.
 *
 * Everything somebody writes on /qa goes through the same intake as the "Zgłoś"
 * button - the same endpoint, the same Slack channel, the same queue - so what
 * decides is whether there is anything to tell. A plain "działa" with nothing
 * written is a checkbox, and re-saving the same verdict with the same words is
 * not news either: both would arrive as noise in a channel whose value is that
 * everything in it deserves reading.
 */
export function qaVerdictIsReportable(
  status: QaCheckStatus,
  note: string,
  previous: QaCheck | null,
): boolean {
  const text = note.trim();
  if (status === "ok" && !text) return false;
  if (
    previous?.status === status &&
    (previous.feedback ?? "").trim() === text
  ) {
    return false;
  }
  return true;
}

/** What the report says.
 *
 * The entry and the verdict travel in `FeedbackContext.qa`, so this is the
 * checker's own words - and a stand-in when a problem was reported without
 * any, because a report with an empty body is rejected by the API and losing
 * it would be worse than forwarding a bare "something is wrong here". An "ok"
 * never reaches this without a note; `qaVerdictIsReportable` stops it first.
 */
export function qaFeedbackMessage(note: string): string {
  return note.trim() || "Zgłoszono problem bez opisu.";
}

/** The report kind a verdict files as.
 *
 * A problem is a bug; a change that works but drew a comment is somebody
 * saying how it could be better, which is what `idea` already means. Nothing
 * about the QA origin is lost either way - `context.qa` carries it.
 */
export function qaFeedbackKind(status: QaCheckStatus): "bug" | "idea" {
  return status === "issue" ? "bug" : "idea";
}
