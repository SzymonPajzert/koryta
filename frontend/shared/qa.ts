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

/** Newest first, and the order of this array is the only thing that says so -
 * there is no date on an entry to fall back on. Prepend; never insert in the
 * middle, and after a rebase move your entry back to the top rather than
 * leaving it where the merge put it.
 *
 * A date was worse than nothing here: it was written by hand, so it recorded
 * when the entry was typed rather than when the change reached anybody, and it
 * disagreed with the order often enough that the two had to be reconciled
 * before the list could be read at all. */
export const QA_ITEMS: QaItem[] = [
  {
    id: "qa-zgloszenie-rozwiazane",
    title: "Na liście QA widać, że zgłoszony problem został załatwiony",
    description:
      "Wpis, przy którym zgłosiłeś problem, świecił się na czerwono nawet " +
      "wtedy, gdy zgłoszenie było już w panelu odhaczone jako załatwione - " +
      "lista czytała tylko Twoją własną ocenę i nic nie wiedziała o tym, co " +
      "zrobił z nim admin. Teraz taki wpis mówi wprost, że sprawę uznaliśmy " +
      "za zamkniętą, i pyta, czy się z tym zgadzasz: „Przyjmuję” zdejmuje go " +
      "z zakładki „Problemy” i odsyła do ponownego sprawdzenia, a „Nadal nie " +
      "działa” wysyła świeże zgłoszenie do zespołu - tym razem także wtedy, " +
      "gdy nie zmieniasz w uwadze ani słowa.",
    steps: [
      "Zaloguj się i wejdź na /qa, zakładka „Problemy”. Wybierz wpis, przy którym masz zgłoszony problem (jeśli nie masz żadnego, rozwiń dowolny wpis, wpisz uwagę i kliknij „Coś nie działa”).",
      "W drugiej przeglądarce (albo po wylogowaniu i zalogowaniu jako admin) wejdź na /admin/opinie, znajdź to zgłoszenie po treści uwagi i ustaw mu status „Załatwione”.",
      "Wróć na /qa i odśwież stronę. Przy tym wpisie ma być niebieski znacznik „Admin: Załatwione” i ramka z informacją, że problem uznaliśmy za załatwiony, a w niej przyciski „Przyjmuję” i „Nadal nie działa”.",
      "Sprawdź, że wpisy, których admin nie ruszał, wyglądają jak dotąd - bez żadnej dodatkowej ramki i bez znacznika.",
      "Kliknij „Przyjmuję”. Wpis ma zniknąć z zakładki „Problemy”, licznik przy niej zmniejszyć się o jeden, a sam wpis pojawić się w „Do sprawdzenia” z dopiskiem, że czeka na Twoje ponowne sprawdzenie.",
      "Odśwież stronę - wpis ma zostać tam, gdzie był, a nie wrócić do „Problemów”.",
      "Przy innym zamkniętym zgłoszeniu kliknij zamiast tego „Nadal nie działa”, nie zmieniając wpisanej wcześniej uwagi. Na dole ma pojawić się „Zgłoszone - problem trafił do zespołu”, ramka ma zniknąć, a w /admin/opinie ma czekać nowe zgłoszenie z tą samą treścią i statusem „Nowe”.",
      "Ustaw jakiemuś zgłoszeniu status „Nie robimy” - na /qa ma być napisane właśnie to, a nie że jest załatwione.",
      "Wyloguj się i zaloguj na inne konto: cudze zgłoszenia i cudze rozstrzygnięcia nie mają się pokazywać - widzisz tylko to, co sam zgłosiłeś.",
    ],
    link: "/qa",
    area: "contributor",
  },
  {
    id: "notatki-ten-sam-kafel",
    title: "Notatki są takimi samymi kafelkami jak reszta strony",
    description:
      "Sam nagłówek „Notatki” to było za mało: pojedyncza notatka wciąż " +
      "wyglądała jak niewypełniony formularz - tekst siedział w polu do " +
      "wpisywania, nad nim wisiało szare pytanie do autora („Czego tu " +
      "brakuje?”), a litery były dwa razy większe niż w sekcjach obok. Teraz " +
      "notatka to zwykły kafelek - biała, cienka ramka, zaokrąglone rogi i " +
      "zielona krawędź po lewej - dokładnie taki sam jak karty w „Zmianach na " +
      "stanowisku” i na stronie spółki, bo wszystkie rysuje już jedna reguła " +
      "zamiast pięciu przepisanych ręcznie kopii. Pole do pisania pojawia się " +
      "dopiero wtedy, gdy sam edytujesz swoją notatkę. Adres źródła jest " +
      "podpisany nazwą serwisu zamiast uciętego w pół linku, a notatki idą " +
      "jedna pod drugą na całą szerokość, jak powiązania nad nimi.",
    steps: [
      "Wejdź zalogowany na stronę osoby, która ma notatki, np. /osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg. Notatki mają być zwykłym tekstem - żadnej ramki pola do wpisywania, żadnego szarego pytania nad tekstem.",
      "Porównaj kafelek notatki z kartą w sekcji „Zmiany na stanowisku” nad nią: ta sama ramka, to samo zaokrąglenie rogów, ta sama zielona krawędź po lewej i ta sama wielkość liter.",
      "Najedź myszką na notatkę - ramka ma zzielenieć i pojawić się delikatny cień, tak samo jak przy najechaniu na kartę zmiany na stanowisku.",
      "Sprawdź adres źródła: ma być podpisany nazwą serwisu (np. „wyborcza.pl”), a nie uciętym w połowie długim linkiem. Kliknięcie otwiera oryginał w nowej karcie.",
      "Zwróć uwagę, że nagłówki „Historia powiązań”, „Zmiany na stanowisku”, „Notatki” i „Fakty z artykułów” zaczynają się teraz w jednej linii, jeden pod drugim.",
      "Kliknij „Zgłoś poprawkę”, wpisz treść i zapisz. Dopiero w trybie edycji ma być widoczne pole do pisania razem z pytaniem pomocniczym; po zapisaniu wraca zwykły tekst.",
      "Kliknij „Edytuj”, potem „Anuluj” - notatka ma wrócić do poprzedniej treści.",
      "Trzy przyciski dodawania („Dodaj źródło”, „Zgłoś poprawkę”, „Zgłoś brak”) mają być w jednym rzędzie i bez kolorowych obwódek, tak jak „Dodaj” w „Historii powiązań”.",
      "To samo sprawdź na stronie spółki (/instytucja/...), artykułu i tematu, w panelu bocznym otwieranym z /eksploruj/tabela oraz na /eksploruj/nowe - notatki rysuje wszędzie ten sam komponent.",
      "Na telefonie: notatki mają iść jedna pod drugą na całą szerokość, tak jak powiązania nad nimi.",
    ],
    link: "/osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg",
    area: "public",
  },
  {
    id: "tabela-osoba-i-historia",
    title: "Tabela: osoba i jej historia w dwóch kolumnach",
    description:
      "W tabeli „Eksploruj” imię i partie są teraz jedną kolumną „Osoba”, a " +
      "firmy, data ostatniego zatrudnienia i wybory drugą - „Historia”. Na " +
      "telefonie zostają dwie szerokie kolumny zamiast czterech wąskich, " +
      "więc plakietka partii nie jest już ucięta po sześciu literach ani " +
      "nazwa firmy po ośmiu. Sortowanie po dacie ostatniego zatrudnienia " +
      "siedzi od teraz na nagłówku „Historia” i jest wreszcie dostępne z " +
      "telefonu, a stare linki z ?sortBy=latestEmploymentStart działają " +
      "dokładnie jak dotąd.",
    steps: [
      "Wejdź na /eksploruj/tabela - w nagłówku mają być „Osoba” i „Historia” zamiast „Imię i nazwisko”, „Partie”, „Firmy” i „Wybory”.",
      "Sprawdź kolumnę „Osoba”: plakietki partii mają stać obok nazwiska albo pod nim, a nie w osobnej kolumnie.",
      "Sprawdź kolumnę „Historia”: mają w niej być plakietki firm, pod nimi „Ostatnie zatrudnienie: ” z datą, a obok (na komputerze) plakietki wyborów z rokiem i okręgiem.",
      "Najedź na plakietkę firmy i na plakietkę wyborów - dymki z pełną nazwą firmy oraz z okręgiem, województwem i komitetem mają działać jak wcześniej.",
      "Zwęź okno poniżej 960 px albo wejdź z telefonu - kolumny mają być dwie, nazwa partii ma się mieścić w całości albo być ucięta dopiero na szerokości kolumny, a tabeli nie da się przewinąć w bok.",
      "Nadal na wąskim ekranie: pod firmami ma być sama data, bez podpisu „Ostatnie zatrudnienie”.",
      "Kliknij nagłówek „Historia” - tabela ma się posortować, a w adresie ma się pojawić sortBy=latestEmploymentStart.",
      "Zalogowany wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - lista ma się załadować (nie może być pusta), a strzałka sortowania ma stać przy „Historii”.",
      "Kliknij nazwisko - w szufladzie mają być te same partie, firmy i wybory, w pełnej postaci.",
      "Rozszerz okno powyżej 960 px - obok tych dwóch kolumn mają wrócić „Lata pracy”, „Notatki”, „Głosy łącznie”, „Twój głos” i „Eksploruj”.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "eksploruj-nowe-tabela-w-karcie",
    title: "„Eksploruj nowe”: tabela mieści się w karcie",
    description:
      "Tabela z osobą wystawała poza prawą krawędź swojej karty - na szerokim " +
      "ekranie widać ją było wiszącą na tle strony, a na laptopie 1280 px " +
      "ostatnie kolumny („Twój głos”, „Widoczność”, „Eksploruj”) były po " +
      "prostu ucięte i nie dało się do nich dojechać żadnym suwakiem. Teraz " +
      "tabela nigdy nie wychodzi poza kartę: jeśli zabraknie miejsca, " +
      "przewija się w środku. Przy okazji zostało pięć kolumn zamiast " +
      "jedenastu - „Osoba”, „Historia”, „Lata pracy”, „Twój głos” i " +
      "„Eksploruj”. Zniknęły „Notatki” (wszystkie notatki są w całości niżej " +
      "na tej samej stronie), „Widoczność” (w tej kolejce zawsze „Szkic”) " +
      "oraz „Głosy łącznie”, której liczba przeniosła się pod nazwisko jako " +
      "„Suma ocen”. Kolejka, sortowanie i głosowanie działają dokładnie tak " +
      "samo; /eksploruj/tabela zostaje z kompletem kolumn.",
    steps: [
      "Wejdź zalogowany na /eksploruj/nowe. Tabela nad kartą osoby ma się kończyć równo z krawędzią białej karty - nic nie ma wystawać poza nią na tło strony.",
      "Ustaw okno na około 1280 px szerokości i sprawdź prawą stronę wiersza: ikona „Eksploruj” i strzałki „Twój głos” mają być widoczne bez przewijania w bok. To są kroki 1 i 3 z paska nad tabelą, więc wcześniej nie dało się ich kliknąć na takim ekranie.",
      "Policz kolumny - mają być dokładnie: „Osoba”, „Historia”, „Lata pracy”, „Twój głos”, „Eksploruj”. Kolumn „Notatki”, „Głosy łącznie” i „Widoczność” już nie ma.",
      "Pod nazwiskiem osoby ma być drobny podpis „Suma ocen: N” - ta sama liczba, która wcześniej stała w kolumnie „Głosy łącznie”.",
      "Przełącz kolejność na „Najwyżej oceniane” i klikaj „Następna osoba”: „Suma ocen” pod nazwiskiem ma maleć albo zostawać taka sama, nigdy rosnąć. To potwierdza, że liczba pod nazwiskiem jest tą, po której sortuje się kolejka.",
      "Przewiń w dół do sekcji „Notatki”: są tam notatki tej osoby, także cudze, w całości - dlatego licznik notatek nie jest już potrzebny w tabeli.",
      "Wejdź na /eksploruj/tabela: tam „Notatki”, „Głosy łącznie” i „Widoczność” zostają, a pod nazwiskiem nie ma żadnej „Sumy ocen”.",
      "Zwęź okno do szerokości telefonu i wróć na /eksploruj/nowe: jeśli tabela się nie mieści, ma się przewijać w poziomie wewnątrz karty, a sama strona nie ma jechać w bok.",
    ],
    link: "/eksploruj/nowe",
    area: "contributor",
  },
  {
    id: "powiazania-nizsze-na-telefonie",
    title: "Powiązania na telefonie są o połowę niższe",
    description:
      "Wiersz w „Historii powiązań” zajmował na telefonie 140-200 px, więc na " +
      "ekran wchodziły dwa, trzy powiązania. Złożyły się na to trzy rzeczy: " +
      "56 px odstępu przy ikonce i do 98 px na przyciski po prawej, przez co " +
      "na nazwę instytucji zostawało 99-197 px i łamała się nawet na cztery " +
      "linijki; osobny pasek trwania rysowany pod wierszem, szeroki na sztywne " +
      "200 px, więc i tak ucinany z obu stron; oraz pełna nazwa komitetu " +
      "wyborczego zajmująca trzy linijki. Teraz daty stoją zwykłym tekstem " +
      "zaraz obok funkcji, pasek trwania zostaje tylko na komputerze, nazwa " +
      "komitetu jest ucięta wielokropkiem (całość zostaje w dymku " +
      "przeglądarki), a plakietka „Instytucja publiczna” zwija się do samej " +
      "ikonki banku. Wiersz ma około 70-110 px, więc na jeden ekran wchodzi " +
      "sześć, siedem powiązań zamiast trzech. Na komputerze nie zmienia się " +
      "nic - pasek, pełna nazwa komitetu i pełna plakietka są tam, gdzie były.",
    steps: [
      "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na stronę osoby z kilkoma powiązaniami, np. /osoba/maciej-sulgan-qlQRcKSMw1YLZJjNB71M.",
      "Przewiń do „Historii powiązań” - policz, ile powiązań mieści się na jednym ekranie. Ma ich być co najmniej sześć, wcześniej wchodziły dwa albo trzy.",
      "Sprawdź pojedynczy wiersz: pod nazwą instytucji ma być jedna linijka „Funkcja · data - data”, a pod nią nic więcej. Zielonego paska trwania nie ma.",
      "Znajdź wiersz z kandydaturą w wyborach - nazwa komitetu ma być ucięta wielokropkiem w jednej linijce. Najedź na nią myszą (albo przytrzymaj), żeby zobaczyć całą.",
      "Sprawdź wiersz ze spółką publiczną - zamiast napisu „Instytucja publiczna” ma być sama ikonka banku.",
      "Zaloguj się jako admin i odśwież tę samą stronę na wąskim ekranie - ikona źródeł i kosz mają być po prawej, w jednej linii, i nadal dać się kliknąć.",
      "Spróbuj przewinąć stronę w bok - nic nie ma wystawać poza ekran.",
      "Wejdź na stronę spółki (/instytucja/...) na telefonie - lista osób ma wyglądać tak samo zwięźle.",
      "Rozszerz okno powyżej 960 px - ma wrócić zielony pasek trwania po prawej stronie wiersza, pełna nazwa komitetu i napis „Instytucja publiczna”, a data ma być tylko raz, pod paskiem.",
    ],
    link: "/osoba/maciej-sulgan-qlQRcKSMw1YLZJjNB71M",
    area: "public",
  },
  {
    id: "home-pasek-postepu-na-telefonie",
    title: "Pasek „Zostało nam jeszcze dużo osób” z legendą na telefonie",
    description:
      "Na wąskim ekranie pasek postępu na stronie głównej ma tylko 311 px " +
      "szerokości, a wpisane w niego trzy liczby dzieliły między siebie " +
      "kilkadziesiąt - środkowa nie mieściła się nawet we własnym kawałku " +
      "paska i rozpychała sąsiednie, bo kawałek nie może być węższy niż " +
      "wpisane w niego cyfry. Teraz na telefonie liczby stoją pod paskiem, w " +
      "liście z kolorową kropką i nazwą (Opublikowane, Sprawdzone, Do " +
      "sprawdzenia), a sam pasek jest niższy i pokazuje już tylko proporcje - " +
      "i to dokładne, bo nic go od środka nie rozpycha. Przy okazji znika " +
      "problem, o którym nikt nie mówił: nazwy kolorów podawał dotąd wyłącznie " +
      "dymek po najechaniu myszą, więc na telefonie trzy gołe liczby nie " +
      "znaczyły nic, a każda z nich była linkiem szerokim na dwadzieścia kilka " +
      "pikseli. Na komputerze pasek zostaje dokładnie taki, jaki był.",
    steps: [
      "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na stronę główną i zjedź do sekcji „Zostało nam jeszcze dużo osób”.",
      "Na samym pasku nie ma już żadnych liczb - są tylko trzy kolorowe części, a pasek jest niższy niż wcześniej.",
      "Pod paskiem są trzy wiersze: „Opublikowane”, „Sprawdzone” i „Do sprawdzenia”, każdy z kropką w kolorze swojej części paska i liczbą wyrównaną do prawej.",
      "Sprawdź, że najdłuższa część paska to „Do sprawdzenia” i że jej liczba jest największa z trzech.",
      "Kliknij „Opublikowane” - ma otworzyć tabelę powiązań. „Do sprawdzenia” ma otworzyć tabelę z osobami nieopublikowanymi, a „Sprawdzone” stronę /pomoc.",
      "Rozszerz okno powyżej 960 px - liczby wracają na pasek, listy pod nim nie ma, a pasek jest znów wyższy.",
      "Na komputerze najedź myszą na kawałek paska - dymek ma podać nazwę i liczbę, np. „Sprawdzone: 513”.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "kategorie-spolek-przeliczone",
    title: "Kategorie spółek policzone od nowa - koleje bez drogowców",
    description:
      "Etykiety kategorii na spółkach pochodziły jeszcze ze starej reguły, " +
      "która patrzyła wyłącznie na kody PKD, więc pod „Kolejami” siedziały " +
      "kopalnie i firmy drogowe z własną bocznicą, a nie było tam samego " +
      "PKP. Reguła zmieniła się w potokach danych wcześniej, ale nie miała " +
      "jak trafić na stronę: jedyne źródło danych do przeliczenia wymagało " +
      "pełnego przeczesania KRS. Teraz kategorie da się policzyć z nocnego " +
      "zrzutu bazy, więc cała baza dostała etykiety zgodne z regułą: doszło " +
      "30 spółek kolejowych (m.in. Polskie Koleje Państwowe, PKP " +
      "Informatyka, Polregio, Koleje Dolnośląskie, a także Windykacja " +
      "Kolejowa i Fundacja Grupy PKP), a 21 firm spoza branży wypadło.",
    steps: [
      "Wejdź na /eksploruj/tabela?category=koleje - filtr „Kategoria” ma się sam ustawić na „Koleje”.",
      "Sprawdź, że w tabeli są ludzie z Polskich Kolei Państwowych, PKP Informatyki, PKP Cargotabor, PKP Energetyki i PKP Intercity Remtrak - żadna z tych spółek nie ma kolejowego PKD, więc wcześniej ich tu nie było.",
      "Sprawdź przewoźników, którzy zdążyli przejść na PKD 2025: Koleje Dolnośląskie, Koleje Wielkopolskie, Łódzka Kolej Aglomeracyjna, Polregio.",
      "Sprawdź, że zniknęli drogowcy, kopalnie i huty: Chemobudowa-Kraków, Kopalnia Wapienia „Czatkowice”, DTŚ, Orlen Aviation, Enea Bioenergia. Kod kolejowy mają tylko dlatego, że mają bocznicę - jest ich mniej niż wcześniej i tak ma być.",
      "Sprawdź, że nie ma Polskich Kolei Linowych - to koleje linowe, nie szynowe, i mają być poza tą kategorią.",
      "Wejdź na stronę spółki Windykacja Kolejowa oraz Fundacja Grupy PKP - przy nazwie ma być chip „Koleje”, a kliknięcie w niego ma wrócić do przefiltrowanej tabeli.",
      "Otwórz PKP Szybką Kolej Miejską w Trójmieście - kategoria ustawiona wcześniej ręcznie na stronie ma zostać nietknięta.",
      "Sprawdź kolejowe przychodnie i szpitale (np. Szpital Kolejowy w Wilkowicach) - mimo nazwy nie mają być w „Kolejach”.",
      "To samo sprawdź na /eksploruj/nowe - ta sama lista kategorii i ta sama zawartość po wybraniu „Koleje”.",
      "Jeśli widzisz jeszcze starą zawartość, dopisz do adresu &latest=true - lista spółek jest trzymana w cache przez godzinę.",
    ],
    link: "/eksploruj/tabela?category=koleje",
    area: "public",
  },
  {
    id: "wybory-nie-gina-przy-nieznanym-okregu",
    title: "Kandydatury nie giną przez jeden nieznany okręg",
    description:
      "Wgrywanie osoby przerywało się na pierwszej kandydaturze z okręgiem, " +
      "którego nie ma na stronie - a wybory samorządowe z 1994 i 1998 roku " +
      "są opisane starym, 49-województwowym kodem TERYT, który dziś nie " +
      "oznacza żadnego regionu. Osoba zostawała wtedy z partią i firmami, " +
      "ale bez ani jednej kandydatury, i tak samo przepadały wszystkie " +
      "kolejne pozycje z jej listy - w danych to co piąta kandydatura. " +
      "Teraz nierozpoznany okręg kosztuje jedną kandydaturę, a nie całą " +
      "historię wyborczą, a import zamiast błędu zwraca listę pominiętych " +
      "pozycji. Same potoki danych przestały też podawać przedreformowe " +
      "kody jako TERYT. Kolumna „Wybory” w tabeli wypełnia się po ponownym " +
      "wgraniu danych osób.",
    steps: [
      "Wejdź na /eksploruj/tabela i posortuj po „Ostatnie zatrudnienie” malejąco. W kolumnie „Wybory” część osób z partią ma teraz swoje kandydatury zamiast pustej komórki.",
      "Wybierz osobę, która wcześniej miała partię i pustą kolumnę „Wybory” - np. Andrzej Grzyb, Czesław Siekierski, Adam Struzik - i sprawdź, czy w jej wierszu są chipy z rokiem i nazwą okręgu.",
      "Najedź na chip: dymek ma pokazać okręg, województwo i komitet, z którego ramienia osoba startowała.",
      "Kliknij nazwisko, żeby otworzyć szufladę z boku - te same kandydatury mają być na liście powiązań.",
      "Wejdź na stronę tej osoby: kandydatury mają być w historii powiązań i w grafie na dole. Uwaga: świeżo wgrane kandydatury czekają na zatwierdzenie, więc niezalogowany czytelnik zobaczy je w tabeli, ale na grafie osoby dopiero po zatwierdzeniu.",
      "Sprawdź kontrolnie kogoś, kto kandydatury miał już wcześniej - np. Krzysztof Kłak - żeby upewnić się, że nic mu nie ubyło ani się nie zdublowało.",
    ],
    link: "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
    area: "public",
  },
  {
    id: "reviewer-queue-one-kind-of-button",
    title: "Kolejka rewizji: w ostatniej kolumnie zawsze ten sam przycisk",
    description:
      "W ostatniej kolumnie kolejki każdy wiersz ma teraz identyczny przycisk " +
      "„Rozpatrz”. Wcześniej propozycja dotycząca powiązania miała własny, dużo " +
      "szerszy „Rewizje powiązań”, a zmiana już rozpatrzona - „Zobacz”, więc " +
      "jedna kolumna wyglądała jak trzy różne narzędzia. Czego zmiana dotyczy, " +
      "mówi chip „Powiązanie” w kolumnie „Czego dotyczy”, a to, czy czeka na " +
      "decyzję - status w kolumnie „Zgłoszenie”; przycisk nie musi powtarzać " +
      "żadnej z tych rzeczy. Dokąd prowadzi, mówi dymek po najechaniu, a przy " +
      "powiązaniu prowadzi teraz na listę rewizji powiązań z tą jedną " +
      "propozycją podświetloną.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/kolejka.",
      "Przejrzyj ostatnią kolumnę - w każdym wierszu ma być jeden przycisk „Rozpatrz”, tej samej szerokości, niezależnie od tego, czego zmiana dotyczy.",
      "Najedź na przycisk - dymek ma powiedzieć, co się otworzy: porównanie rewizji wpisu albo lista rewizji powiązań.",
      "Ustaw filtr „Status” na „Wszystkie” - przy rozpatrzonej już propozycji przycisk ma nadal nazywać się „Rozpatrz”, a o tym, że jest rozpatrzona, ma mówić status w pierwszej kolumnie.",
      "Ustaw filtr „Rodzaj” na „Wszystko”, znajdź wiersz z chipem „Powiązanie” w kolumnie „Czego dotyczy” i kliknij „Rozpatrz” - otwiera się /admin/rewizje-krawedzi, a ten jeden wiersz jest podświetlony i przewinięty na widok.",
      "Na liście rewizji powiązań zmień „Typ krawędzi” na inny niż typ podświetlonej propozycji - ma pojawić się informacja, że propozycji z linku nie ma na tej liście, z przyciskiem „Pokaż w kolejce”, który otwiera ją w kolejce.",
      "Wróć do kolejki i kliknij „Rozpatrz” przy zwykłym wpisie - tak jak dotąd otwiera się porównanie rewizji z tą jedną podświetloną.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "spolki-skarbu-panstwa-maja-wlasciciela",
    title: "Spółki Skarbu Państwa mają wreszcie wpisanego właściciela",
    description:
      "KRS wskazuje Skarb Państwa jako udziałowca 110 spółek na stronie i " +
      "żadna z nich nie miała z nim narysowanego powiązania. Powód był " +
      "techniczny: właściciela rozpoznajemy albo po numerze KRS, albo po " +
      "kodzie TERYT gminy, a Skarb Państwa nie ma ani jednego, ani drugiego - " +
      "nie ma go w rejestrze i nie jest terytorium. Strona ma jednak własną " +
      "stronę „Skarb Państwa”, więc to ona jest teraz celem tych powiązań. " +
      "Spółki były i tak oznaczone jako publiczne, więc zmienia się nie to, " +
      "co o nich wiadomo, tylko to, że da się z nich przejść dalej: ze strony " +
      "Skarbu Państwa widać wszystkie te spółki, a z każdej z nich - " +
      "właściciela.",
    steps: [
      "Wejdź na stronę spółki Skarbu Państwa (np. Polska Grupa Zbrojeniowa) i sprawdź, że w powiązaniach jest „Skarb Państwa” jako właściciel.",
      "Kliknij „Skarb Państwa” - jego strona ma listować te spółki.",
      "Sprawdź na grafie takiej spółki, że linia do Skarbu Państwa jest podpisana „właściciel”, a nie „siedziba”.",
      "Sprawdź spółkę komunalną (np. wodociągi) - jej właścicielem ma dalej być gmina, a nie Skarb Państwa.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "usuniete-powiazanie-znika-tez-z-filtrow",
    title: "Usunięte powiązanie znika też z filtrów i ze statystyk",
    description:
      "Usunięcie powiązania przez admina jest „miękkie” - dokument zostaje, " +
      "tylko z oznaczeniem, żeby dało się odtworzyć kto i dlaczego je zdjął. " +
      "Grafy i strony podmiotów czytały to oznaczenie, ale trzy miejsca nie: " +
      "filtr „Siedziba spółki”, przeliczanie statystyk i sprawdzanie " +
      "siedziby przy imporcie z KRS. Skutek był taki, że usunięta siedziba " +
      "dalej trzymała spółkę w regionie, w którym nikt jej nie umieszczał, i " +
      "nie dało się tego cofnąć - a import, widząc „konflikt siedzib”, " +
      "odmawiał wpisania tej prawidłowej. Teraz usunięte powiązanie nie " +
      "liczy się nigdzie.",
    steps: [
      "Wejdź na stronę spółki i sprawdź, w jakim regionie ma siedzibę.",
      "Usuń powiązanie „siedziba” przyciskiem usuwania powiązania (jako admin), podając powód.",
      "Wejdź na /eksploruj/tabela?latest=true, ustaw filtr „Siedziba spółki” na ten region i sprawdź, że pracownicy tej spółki już się nie pokazują.",
      "Sprawdź, że powiązanie nadal jest widoczne w historii rewizji tej krawędzi razem z powodem usunięcia - usuwanie nie kasuje historii.",
    ],
    link: "/eksploruj/tabela",
    area: "admin",
  },
  {
    id: "rada-spoleczna-szpitali-nie-jest-zatrudnieniem",
    title: "Rada społeczna szpitala nie liczy się jako zatrudnienie",
    description:
      "Samodzielny publiczny zakład opieki zdrowotnej nie ma rady " +
      "nadzorczej. Ma radę społeczną - organ opiniodawczy z ustawy o " +
      "działalności leczniczej, złożony z przedstawicieli podmiotu " +
      "tworzącego i samorządu, który zbiera się kilka razy w roku i za " +
      "który się nie płaci. W KRS ten organ nazywa się wprost „RADA " +
      "SPOŁECZNA”, ale rejestr.io zgłasza jego członków dokładnie tak samo " +
      "jak członków każdej rady nadzorczej, więc na stronie wszystkie 892 " +
      "takie miejsca w 238 szpitalach były podpisane „Rada Nadzorcza” i " +
      "liczyły się jako praca. Teraz spółki niosą informację o tym, jaki " +
      "mają organ nadzoru, i miejsce w radzie społecznej wypada z kolumn " +
      "„Ostatnie zatrudnienie” i „Lata pracy” oraz z filtra „obecnie " +
      "zatrudnieni” - z tego samego powodu, dla którego nie liczymy pracy " +
      "w spółce, o której nie wiadomo, czy jest publiczna. Dotyczy 758 " +
      "osób; 578 z nich zmieni się data ostatniego zatrudnienia, a 492 " +
      "stracą ją całkiem, bo rada społeczna była jedyną rzeczą, jaką o " +
      "nich wiedzieliśmy. Samo powiązanie zostaje: osoba nadal jest przy " +
      "szpitalu w kolumnie „Firmy” i na grafie, zmieniają się tylko " +
      "liczniki. Dyrektor szpitala liczy się dalej - to etat, a nie " +
      "miejsce w radzie.",
    steps: [
      "Wejdź na stronę dowolnego SPZOZ (np. SPZOZ w Sanoku) i sprawdź w „Historii powiązań”, że członkowie organu nadzoru są podpisani „Rada Społeczna”, a nie „Rada Nadzorcza”.",
      "Na tej samej stronie znajdź dyrektora/kierownika (powiązanie „Zarząd”) i sprawdź, że jego podpis się NIE zmienił.",
      "Wejdź na stronę osoby, która ma tylko miejsce w radzie społecznej szpitala. Powiązanie ma być widoczne, ale „Lata pracy” mają wynosić 0.",
      "Wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - na górze nie powinno być osób, których jedynym powiązaniem jest rada społeczna szpitala.",
      "Wejdź na stronę spółki z prawdziwą radą nadzorczą (np. PKP SKM w Trójmieście) i sprawdź, że tam nadal jest „Rada Nadzorcza” i że lata pracy się liczą.",
      "Na stronie głównej, w „Ostatnio zatrudnieni”, sprawdź kartę z SPZOZ - ma mówić „Rada Społeczna”.",
    ],
    link: "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
    area: "public",
  },
  {
    id: "wlasciciele-spolek-z-rejestru",
    title: "Spółki mają wreszcie właścicieli",
    description:
      "Strona wiedziała, w jakim mieście spółka jest zarejestrowana, i nic " +
      "poza tym - w całej bazie było 115 powiązań właścicielskich na 4024 " +
      "spółki. KRS podaje udziałowców w dziale 1 i teraz je czytamy: 964 " +
      "wpisy wskazują spółkę po numerze KRS, a 1675 gminę, powiat, " +
      "województwo albo Skarb Państwa. Nazwa właściciela to w rejestrze sam " +
      "tekst, bez kodu TERYT, więc trzeba ją rozwiązać - „GMINA MIASTA " +
      "NOWEGO MIASTA LUBAWSKIEGO” na „Nowe Miasto Lubawskie”. Wcześniej kod " +
      "brało się z siedziby samej spółki, przez co Gmina Miasta Gdańsk, " +
      "mająca 10,7% PKP SKM w Trójmieście, wychodziła jako Gdynia, a " +
      "wszyscy współwłaściciele zlewali się w jednego: Sądeckie Wodociągi " +
      "mają cztery gminy i miały jedną, a żywiecka spółka wodociągowa " +
      "szesnaście i też jedną. Przy okazji siedziba dostała własny typ " +
      "powiązania („siedziba” zamiast „właściciel”), bo inaczej gmina " +
      "będąca właścicielem spółki z sąsiedniego miasta przenosiłaby ją do " +
      "siebie.",
    steps: [
      "Wejdź na stronę PKP SKM w Trójmieście. Ma mieć trzech właścicieli: PKP S.A., Gminę Miasta Gdańsk i Województwo Pomorskie - a jako siedzibę nadal Gdynię.",
      "Sprawdź Sądeckie Wodociągi: cztery różne gminy jako właściciele, nie jedna.",
      "Na /eksploruj/tabela sprawdź kolumnę z regionem - ma pokazywać siedzibę, a nie gminę, która ma udziały.",
      "Użyj filtra „Siedziba spółki” dla dowolnego powiatu i sprawdź, że lista się nie zmieniła w stosunku do tego, co było wcześniej.",
      "Wejdź na stronę gminy (np. Gdańsk) - ma listować i spółki z siedzibą, i te, w których ma udziały.",
      "Na grafie spółki z właścicielem-gminą sprawdź, że linia do siedziby jest podpisana „siedziba”, a do właściciela „właściciel”.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "kategorie-spolek-wedlug-glownej-dzialalnosci",
    title: "Więcej kategorii spółek, i trafniejszych",
    description:
      "Filtr „Kategoria” na Eksploruj miał trzy pozycje i mylił się w obie " +
      "strony. Spółka wpadała do kategorii, jeśli miała jej kod PKD " +
      "gdziekolwiek wśród dziesięciu zgłoszonych - a wodę i ścieki dopisuje " +
      "sobie prawie każdy zakład komunalny i każda duża fabryka, więc " +
      "„Wodociągi i kanalizacja” liczyły 674 spółki, z czego ćwierć to " +
      "ciepłownie, śmieciarki i zakłady chemiczne. Teraz decyduje " +
      "działalność przeważająca, czyli ta, którą spółka sama podaje jako " +
      "główną. Doszło sześć kategorii: Przychodnie, Ciepłownictwo, " +
      "Energetyka, Odpady i recykling, Komunikacja miejska i autobusowa " +
      "oraz Sport i rekreacja. Do „Szpitali” trafiły wreszcie 243 " +
      "samodzielne publiczne zakłady opieki zdrowotnej, które nie mają w " +
      "rejestrze ani jednego kodu PKD i przez to nie miały żadnej " +
      "kategorii. Spółka może być w dwóch kategoriach naraz i to nie jest " +
      "błąd: zakład gospodarki komunalnej dostarcza wodę i ciepło.",
    steps: [
      "Wejdź na Eksploruj → Tabela i rozwiń filtr „Kategoria”. Ma mieć dziewięć pozycji, nie trzy.",
      "Wybierz „Ciepłownictwo”. Mają się pokazać przedsiębiorstwa energetyki cieplnej (MPEC, PEC, Ciepłownia), a nie wodociągi.",
      "Wybierz „Wodociągi i kanalizacja”. Nie powinno tam być ciepłowni ani zakładów chemicznych - sprawdź, że nie ma Grupy Azoty Puławy ani PCC Rokita.",
      "Wybierz „Szpitale” i poszukaj samodzielnego publicznego zakładu opieki zdrowotnej, np. SPZOZ w Sanoku. Wcześniej nie było go w żadnej kategorii.",
      "Wejdź na stronę spółki, która robi kilka rzeczy naraz (zakład gospodarki komunalnej), i sprawdź, że ma pod nazwą więcej niż jeden znacznik kategorii, a każdy prowadzi do filtra.",
      "Wybierz „Koleje” i sprawdź, że są tam operatorzy tramwajów (MPK Wrocław, MPK Kraków), a nie ma terminala Port Północny ani PKM Tychy.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "admin-usuwanie-powiazania",
    title: "Admin może usunąć powiązanie ze strony podmiotu",
    description:
      "Na stronie osoby, spółki i regionu, w kolejce /eksploruj/nowe i w " +
      "szufladzie /eksploruj/tabela przy każdym powiązaniu widać teraz - " +
      "tylko dla admina - kosz. Kliknięcie pyta o powód i od razu zdejmuje " +
      "powiązanie ze strony i z grafu; nie trafia ono do kolejki rewizji, bo " +
      "nie ma tu drugiej opinii, na którą warto czekać. Powstało to dla " +
      "powiązań po źle scalonej osobie: zatrudnienia z niewłaściwej połowy " +
      "nie są niczyją tezą, tylko śmieciem po scaleniu. Powiązanie nie znika " +
      "z bazy - zostaje w niej razem z powodem i autorem usunięcia, więc " +
      "widać, kto i dlaczego je zdjął. Cofnąć to można na razie tylko w " +
      "bazie: żaden ekran w aplikacji nie przywraca usuniętego powiązania, " +
      "więc pytaj o powód serio. Przy okazji: usunięte powiązanie znika też " +
      "zalogowanym; wcześniej filtr omijał osoby oglądające wersje " +
      "niezatwierdzone, więc admin po usunięciu dalej widział je na stronie.",
    steps: [
      "Wejdź zalogowany jako admin na stronę osoby z powiązaniami, np. /entity/person/<id>. W „Historii powiązań” każdy wiersz ma po prawej czerwony kosz, obok ikony źródeł.",
      "Zaloguj się jako zwykły użytkownik (albo wyloguj) i odśwież tę samą stronę - kosza nie ma.",
      "Jako admin kliknij kosz. Okienko ma podać, o które powiązanie chodzi („Osoba - rola - firma”), a przycisk „Usuń powiązanie” ma być nieaktywny, dopóki nie wpiszesz powodu.",
      "Wpisz powód i potwierdź. Powiązanie ma zniknąć z listy bez odświeżania strony, a na dole pojawić się „Powiązanie zostało usunięte”.",
      "Odśwież stronę - powiązania ma dalej nie być, ani na liście, ani w grafie na dole.",
      "Otwórz stronę drugiej strony powiązania (np. firmy) - tam też ma go nie być.",
      "Wejdź na stronę spółki (/instytucja/...): kosz jest tak samo przy wierszach „Historii powiązań” oraz przy „Właścicielach” i „Spółkach zależnych”.",
      "Wejdź na stronę regionu (/region/krakow-teryt1261): powiązania są tam kartami, a kosz siedzi w rogu karty. Artykuły i tematy mają własne widoki i kosza nie mają - to nie jest błąd.",
      "Wejdź na /eksploruj/nowe jako admin: w „Historii powiązań” osoby z kolejki jest ten sam kosz. Usuń powiązanie - ma zniknąć bez przeładowania strony i bez przeskoku na inną osobę.",
      "Wejdź na /eksploruj/tabela, kliknij osobę, żeby otworzyć szufladę z boku: kosz jest i tam, przy powiązaniach na dole szuflady. To samo w /admin/notatki.",
      "Kliknięcie kosza nigdzie nie przechodzi - wiersz i karta same są linkami do drugiej strony powiązania, więc sprawdź, że po kliknięciu zostajesz na miejscu.",
    ],
    area: "admin",
  },
  {
    id: "graf-legenda-kolorow-partii",
    title: "Legenda grafu mówi, co znaczą kolory osób, i można ją schować",
    description:
      "W grafie kółko osoby jest pomalowane na kolor jej partii, ale legenda " +
      "nad płótnem tłumaczyła dotąd tylko kształty - więc niebieskie, " +
      "granatowe i zielone kółka nie znaczyły dla czytelnika nic. Teraz " +
      "legenda wymienia partie, które faktycznie są na ekranie (nie całą " +
      "listę ośmiu), a niebieski jest podpisany jako osoba bez partii. Nowa " +
      "Lewica i SLD mają ten sam kolor - to ta sama partia po zmianie nazwy - " +
      "więc stoją w jednej pozycji. Całą legendę można zwinąć przyciskiem " +
      "„Ukryj legendę”, a wybór trzyma się przy przechodzeniu między " +
      "stronami. Przy okazji: osoba z partii, dla której nie mamy koloru (np. " +
      "Razem), była rysowana na czarno - teraz jest niebieska jak reszta " +
      "bezpartyjnych. Podpisy osób w dalszym kręgu skracają drugie imię do " +
      "inicjału zamiast ucinać nazwisko: było „Sławomir Andrzej…”, jest " +
      "„Sławomir A. Nowicki”.",
    steps: [
      "Wejdź na stronę osoby, która ma powiązania z politykami (np. /osoba/pawel-orlowski-hvMeVASGU0uBMuwSsRM0), i zjedź do grafu.",
      "Nad płótnem sprawdź legendę: po kształtach mają być kolory partii widocznych w grafie, każdy z nazwą partii.",
      "Sprawdź, że nie ma tam partii, której nikt na płótnie nie reprezentuje, a Nowa Lewica i SLD (jeśli obie są) stoją razem w jednej pozycji.",
      "Kliknij „Ukryj legendę” - legenda znika, przycisk zmienia się w „Legenda”. Kliknij jeszcze raz - wraca.",
      "Schowaj legendę i przejdź na stronę innej osoby - ma pozostać schowana.",
      "Sprawdź podpisy węzłów w drugim kroku: osoba z dwoma imionami ma być podpisana z nazwiskiem (np. „Sławomir A. Nowicki”), a nie uciętą po imionach.",
      "Sprawdź, że żaden węzeł osoby nie jest czarny.",
    ],
    area: "public",
  },
  {
    id: "osoba-fakty-z-artykulow",
    title: "Na stronie osoby widać fakty, które model przypisał właśnie jej",
    description:
      "Pod grafem powiązań doszła sekcja „Fakty z artykułów”: wszystkie " +
      "wydobyte z prasy fakty, które potok dopasował do tej konkretnej " +
      "osoby z bazy - dopasowanie idzie po identyfikatorze ustalonym przy " +
      "wgrywaniu, a nie po nazwisku, więc imiennik nie dostaje cudzych " +
      "faktów. Karty są te same co na /ekstrakcje, po dwie w rzędzie na " +
      "szerszym ekranie. Same fakty są tylko dla zalogowanych - to " +
      "niesprawdzone jeszcze zdania o konkretnej osobie, dokładnie z tego " +
      "samego powodu, dla którego notatki na stronie osoby też wymagają " +
      "logowania. Niezalogowany widzi tylko, ile ich znaleźliśmy, rozmazany " +
      "podgląd i przycisk „Zaloguj się lub załóż konto”. Rozmycie jest samą " +
      "dekoracją nad pustymi paskami: treść faktów w ogóle nie jest wysyłana " +
      "na taką stronę, więc nie ma jej ani w źródle strony, ani dla " +
      "wyszukiwarek.",
    steps: [
      "Zaloguj się i wejdź na stronę osoby, która ma dopasowane fakty (na seedzie: /osoba/anna-nowak-3).",
      "Zjedź na dół, pod graf powiązań - ma być nagłówek „Fakty z artykułów” i karty faktów.",
      "Na szerokim ekranie karty mają stać po dwie w rzędzie, na wąskim jedna pod drugą.",
      "Sprawdź, że karta ma przycisk „To nie ta osoba”, a nie ma przycisków oceny (Błędny/Nie wiem/Dobry) - ocenia się na /ekstrakcje.",
      "Wyloguj się i odśwież tę samą stronę - ma zostać nagłówek, zdanie „Znaleźliśmy N faktów…”, rozmazany podgląd i przycisk logowania.",
      "Otwórz źródło tej wylogowanej strony (Ctrl+U) i poszukaj treści faktu - nie ma go tam być.",
      "Kliknij „Zaloguj się lub załóż konto” i zaloguj się - ma cię odesłać z powrotem na stronę tej samej osoby, już z faktami.",
      "Wejdź na stronę osoby bez dopasowanych faktów - ani zalogowany, ani wylogowany nie ma zobaczyć nagłówka.",
    ],
    area: "public",
  },
  {
    id: "notatki-do-poprawy-wymagaja-dzialania",
    title: "Zgłoszone poprawki i braki od razu trafiają na listę do zrobienia",
    description:
      "Notatka dodana jako „Do poprawy” albo „Brakuje danych” od razu liczy " +
      "się jako wymagająca działania w panelu admina - wcześniej pojawiała " +
      "się tam dopiero, gdy ktoś ręcznie oznaczył ją jako „Nierozwiązaną”, " +
      "więc zgłoszenia czytelników przepadały. Same źródła nadal wchodzą na " +
      "tę listę tylko z ręki admina, a oznaczenie „Rozwiązane” zdejmuje z " +
      "niej każdy wpis.",
    steps: [
      "Na dowolnej stronie osoby lub instytucji dodaj notatkę przyciskiem " +
        "„Zgłoś poprawkę” (albo „Zgłoś brak”) i zapisz ją.",
      "Wejdź na /admin - kafelek „Notatki wymagające działania” liczy nowe " +
        "zgłoszenie i pokazuje je na liście z chipem „Do poprawy”.",
      "Kliknij „Przejdź do notatek” - tabela otwiera się z filtrem " +
        "„Wymagające działania” i tym samym zestawem wierszy.",
      "Ustaw status wiersza na „Rozwiązane” i odśwież /admin - zgłoszenie " +
        "znika z kafelka.",
    ],
    link: "/admin",
    area: "admin",
  },
  {
    id: "eksploruj-nowe-uporzadkowana-strona",
    title:
      "„Eksploruj nowe” czytelniejsze: trzy kroki i powiązania na wierzchu",
    description:
      "Strona do sprawdzania nowych osób została uporządkowana. Instrukcje " +
      "były pięcioma zdaniami w dużej niebieskiej ramce, która zajmowała " +
      "pół ekranu, zanim widać było kogokolwiek - teraz jest to jeden pasek " +
      "z trzema krokami („Eksploruj”, „Notatka”, „Głos”), które odhaczają " +
      "się same w miarę pracy, a pełne opisy chowają się pod „Jak to " +
      "działa?”. „Historia powiązań” przeniosła się nad kartę osoby i " +
      "notatki: to na jej podstawie ocenia się, czy ktoś jest ciekawy, więc " +
      "nie ma sensu szukać jej na samym dole. Filtry kolejki - kolejność, " +
      "typ podmiotu i próg ocen - stoją teraz razem w jednym pasku zamiast " +
      "w dwóch rzędach po obu stronach paska postępu, a obok nich widać, ile " +
      "osób zostało do sprawdzenia. Przy okazji: „Następna osoba” zawsze " +
      "przechodzi dalej - wcześniej co dziesiąte kliknięcie zostawiało na " +
      "tej samej osobie. Nic z tego nie zmienia tego, kto trafia do kolejki " +
      "ani jak się głosuje.",
    steps: [
      "Wejdź na /eksploruj/nowe zalogowany. Nad tabelą ma być wąski pasek z krokami „1 Eksploruj → 2 Notatka → 3 Głos”, a nie ramka z pięcioma zdaniami.",
      "Kliknij „Jak to działa?” - rozwinie się pełny opis kroków; kliknij jeszcze raz, żeby go schować. Wybór ma przetrwać odświeżenie strony.",
      "Kliknij ikonkę „Eksploruj” w wierszu tabeli - pierwszy krok ma dostać zielony ptaszek.",
      "Zapisz notatkę i oddaj głos - drugi i trzeci krok mają się odhaczyć, ramka paska zzielenieć, a opis kroków sam się schować.",
      "Przewiń w dół: zaraz pod tabelą ma być „Historia powiązań”, a dopiero pod nią karta osoby z wyszukiwarkami i notatki obok niej.",
      "Kliknij „Następna osoba” dziesięć razy z rzędu - za każdym razem ma się pojawić inna osoba niż przed kliknięciem.",
      "Sprawdź pasek filtrów nad krokami: przełącznik kolejności, „Min. suma głosów” i „Typ podmiotu” stoją w jednym rzędzie, a pod nimi zdanie opisujące kolejkę i liczba osób, które zostały.",
      "Zwęź okno do szerokości telefonu - kroki i filtry mają się zawijać, a nie uciekać poza ekran.",
    ],
    link: "/eksploruj/nowe",
    area: "contributor",
  },
  {
    id: "eksploruj-na-stronie-osoby",
    title: "Przycisk „Eksploruj” na stronie osoby",
    description:
      "Na stronie osoby, obok „Rewizji”, admin ma teraz przycisk " +
      "„Eksploruj” - ten sam, co ikonka w tabeli na /eksploruj. Otwiera " +
      "naraz rejestr.io, Wikipedię i wyszukiwarkę Google dla nazwiska, dla " +
      "nazwiska z „PKW” oraz dla każdej miejscowości, w której ta osoba " +
      "kandydowała. Wcześniej sprawdzenie osoby znalezionej przez " +
      "wyszukiwarkę wymagało odszukania jej jeszcze raz w tabeli.",
    steps: [
      "Zaloguj się jako admin i wejdź na stronę osoby, np. z wyników wyszukiwania. Obok przycisku „Rewizje” ma być „Eksploruj”.",
      "Wyłącz blokowanie wyskakujących okien i kliknij „Eksploruj” - ma się otworzyć karta rejestr.io, karta Wikipedii i po jednej karcie Google dla każdego zapytania.",
      "Sprawdź na osobie, która kandydowała w wyborach - wśród kart Google ma być wyszukiwanie „imię nazwisko <miejscowość>” dla jej okręgu.",
      "Wyloguj się (albo zaloguj jako zwykły użytkownik) i odśwież tę samą stronę - przycisku ma nie być, tak samo jak „Rewizji”.",
      "Zwęź okno poniżej 960 px - oba przyciski chowają się razem, jak dotąd.",
    ],
    area: "admin",
  },
  {
    id: "eksploruj-nowe-kolejnosc-najnowsi",
    title: "„Eksploruj nowe” zaczyna od najnowszych zatrudnień",
    description:
      "Kolejka do sprawdzania miała dotąd jedną kolejność: najwyżej oceniani " +
      "najpierw, niezależnie od tego, czy ktoś objął stanowisko w zeszłym " +
      "miesiącu czy dziesięć lat temu. Doszedł przełącznik z drugą " +
      "kolejnością - „Najnowsze zatrudnienia” - i to ona jest teraz " +
      "domyślna: osoby, które najpóźniej zaczęły pracę, z sumą ocen co " +
      "najmniej 3, żeby kolejka została krótką listą, a nie wszystkim, co " +
      "kiedykolwiek trafiło do bazy. Próg da się zmienić w polu obok, a " +
      "„Najwyżej oceniane” wraca do poprzedniego zachowania. W obu " +
      "kolejnościach wciąż pokazują się tylko osoby, na które nikt jeszcze " +
      "nie zagłosował. Wybór zapisuje się w adresie strony, więc link można " +
      "komuś podać. Filtr typu podmiotu działa jak wcześniej.",
    steps: [
      "Wejdź na /eksploruj/nowe zalogowany. Przełącznik ma stać na „Najnowsze zatrudnienia”, a obok ma być pole „Min. suma głosów” z wartością 3.",
      "Sprawdź w tabeli kolumnę „Ostatnie zatrudnienie” - klikając „Następna osoba” kilka razy, daty powinny iść od najnowszych w dół.",
      "Kolumna „Głosy łącznie” ma pokazywać co najmniej 3 przy każdej osobie.",
      "Zmień próg na 5. Adres ma dostać „minVotes=5”, a osoby z oceną 3 i 4 mają zniknąć.",
      "Wyczyść pole - ma wrócić do 3, bo to wartość domyślna.",
      "Przełącz na „Najwyżej oceniane”. Adres ma dostać „order=votes”, kolejność ma iść od najwyższej sumy ocen, a pole progu ma zniknąć.",
      "Odśwież stronę z takim adresem - przełącznik i próg mają zostać tam, gdzie je ustawiłeś.",
      "Ustaw „Typ podmiotu” na szpitale przy obu kolejnościach - lista ma się zawęzić, a licznik postępu u góry przeliczyć.",
    ],
    link: "/eksploruj/nowe",
    area: "contributor",
  },
  {
    id: "wyszukiwarka-szersza-na-komputerze",
    title: "Wyszukiwarka na głównej znów szeroka na komputerze",
    description:
      "Na komputerze pole wyszukiwania na stronie głównej sięga znów do dwóch " +
      "trzecich szerokości - tam, gdzie kończyła się kolumna, w której " +
      "stało wcześniej. Zwężone do 400 px kończyło się w jednej trzeciej, " +
      "przez co przycisk „Działaj z nami”, który ma być jego towarzyszem, " +
      "zaczynał się mniej więcej na środku pustej linii i wyglądał na " +
      "przycisk, który się obluzował. Na telefonie nic się nie zmienia - " +
      "pole nadal zajmuje całą linię, a przycisku tam nie ma.",
    steps: [
      "Wejdź na stronę główną na komputerze. Pole wyszukiwania ma sięgać mniej więcej dwóch trzecich szerokości, a „Działaj z nami” ma stać tuż za nim.",
      "Zwęź okno poniżej 960 px. Przycisk ma zniknąć, a pole zająć całą linię.",
      "Na telefonie sprawdź, że nad polem nadal jest zdanie o tym, co robi strona, a pod nim mapa koryciarstwa.",
      "Wpisz nazwisko - podpowiedzi mają się pokazywać jak wcześniej, na całej szerokości pola.",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "notatki-jak-reszta-sekcji",
    title: "Notatki wyglądają jak reszta strony",
    description:
      "Karta „Notatki” była wypukłym kaflem z paskiem tytułu, wstawionym " +
      "między „Historię powiązań” i „Zmiany na stanowisku”, które są zwykłymi " +
      "sekcjami na tle strony - i odstawała od nich tak, jakby pochodziła z " +
      "innego serwisu. Teraz ma taki sam nagłówek z ikoną i taki sam wstęp " +
      "jak one. Notatki na stronie spółki, artykułu, tematu i w panelu " +
      "bocznym tabeli rysuje ten sam komponent, więc zmieniły się wszędzie " +
      "naraz. Same notatki, przyciski i zapisywanie działają bez zmian.",
    steps: [
      "Wejdź zalogowany na stronę osoby, która ma notatki. Nagłówek „Notatki” ma być taki sam jak „Historia powiązań” nad nim - bez ramki kafla i bez cienia.",
      "Sprawdź, że wstęp „Wiesz więcej na temat tej osoby?” jest drobnym, szarym tekstem, tak jak podpis pod „Zmiany na stanowisku”.",
      "Dodaj źródło, zapisz, potem „Edytuj” i „Anuluj”. Wszystko ma działać jak wcześniej.",
      "To samo na stronie spółki, artykułu i tematu oraz w panelu bocznym otwieranym z /eksploruj/tabela.",
      "Wyloguj się i wejdź na stronę spółki z cudzą notatką - ma się pokazać z zachętą do zalogowania. Na stronie osoby notatek nadal nie ma dla niezalogowanych.",
    ],
    area: "public",
  },
  {
    id: "postep-weryfikacji-po-zalogowaniu",
    title: "Postęp weryfikacji tylko dla zalogowanych",
    description:
      "Pasek „Postęp weryfikacji” nad tabelą na Eksploruj pokazuje się " +
      "dopiero po zalogowaniu. Mówi, ile wpisów zostało sprawdzonych, i " +
      "prowadzi do ekranu, na którym się je sprawdza - czyli do dwóch " +
      "rzeczy, których niezalogowany czytelnik i tak nie zrobi. Na telefonie " +
      "zabierał przy tym większość miejsca nad pierwszym wierszem tabeli.",
    steps: [
      "Wyloguj się i wejdź na /eksploruj/tabela. Nad tabelą nie ma paska „Postęp weryfikacji” - po filtrach od razu idzie tabela.",
      "To samo na wąskim ekranie: pierwszy wiersz tabeli ma być widoczny bez przewijania.",
      "Zaloguj się i odśwież. Pasek ma wrócić, razem z przyciskiem „Pomóż sprawdzać”.",
      "Wejdź na /eksploruj/nowe (tylko dla zalogowanych). Pasek ma tam być jak wcześniej.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "wstecz-po-wejsciu-we-wpis",
    title: "Przycisk „wstecz” wraca tam, skąd się przyszło",
    description:
      "Kliknięcie wpisu w grafie, w historii powiązań albo w kolejce rewizji " +
      "prowadzi na jego stronę przez adres techniczny, który zaraz " +
      "przekierowuje na czytelny. To przekierowanie zjadało z historii " +
      "przeglądarki stronę, z której się przyszło - nie ten adres " +
      "techniczny, tylko poprzednią stronę - więc „wstecz” zostawało na " +
      "miejscu albo cofało o krok za daleko. Teraz historia ma dokładnie " +
      "jeden wpis na odwiedzoną stronę.",
    steps: [
      "Wejdź na stronę osoby, która ma graf (np. z /eksploruj/tabela).",
      "Kliknij dwa razy w spółkę na grafie - ma otworzyć się strona tej spółki pod czytelnym adresem /instytucja/....",
      "Naciśnij „wstecz”. Ma wrócić na stronę osoby, a nie zostać na stronie spółki.",
      "Naciśnij „dalej”. Ma znów pokazać stronę spółki - w historii jest jeden wpis, nie dwa, więc jedno kliknięcie wystarcza.",
      "To samo z odnośnikiem w „Historii powiązań” na stronie osoby i z nazwą wpisu w /admin/rewizje.",
      "Wejdź na /entity/person/<id> wpisując adres ręcznie. Ma przenieść na /osoba/... tak jak wcześniej.",
    ],
    area: "public",
  },
  {
    id: "kategorie-firm-edytowalne",
    title: "Kategorie firmy można poprawić",
    description:
      "Kategoria firmy („Szpitale”, „Wodociągi i kanalizacja”, „Koleje”) " +
      "przestała być tylko wyliczana z kodów PKD i jest teraz zwykłym polem " +
      "wpisu: widać ją na stronie instytucji, jest w formularzu zmiany, " +
      "przechodzi przez rewizje i ma swoją historię. Kod PKD mówi, czym " +
      "firma się zajmuje, a nie do jakiej branży należy - kopalnia z własną " +
      "bocznicą ma kod kolejowy - więc wyliczenie bywa błędne i musi dać się " +
      "poprawić z poziomu strony. Jeśli ktoś ustawi kategorie ręcznie, " +
      "kolejny import spółek już ich nie nadpisze; puste zaznaczenie też " +
      "jest odpowiedzią i też jest chronione.",
    steps: [
      "Wejdź na stronę instytucji, która ma kategorię (np. spółka kolejowa). Obok „Instytucja publiczna” ma być szary znacznik z nazwą kategorii.",
      "Kliknij ten znacznik - ma przenieść na /eksploruj/tabela z ustawionym filtrem tej kategorii.",
      "Kliknij „Zaproponuj zmianę”. Pod pytaniem o właściciela ma być pole „Kategorie” z trzema pozycjami, wstępnie zaznaczone tym, co jest zapisane.",
      "Zmień zaznaczenie i wyślij. W podglądzie rewizji ma się pokazać wiersz „kategorie” ze starą i nową wartością po polsku, a nie „categories”.",
      "Wyczyść zaznaczenie do zera i wyślij. To też ma być rewizja ze zmianą „kategorie”, a nie „brak zmian”.",
      "Zatwierdź rewizję w /admin/rewizje i sprawdź stronę instytucji oraz filtr na /eksploruj/tabela. Filtr czyta listę firm z godzinnego cache - jeśli nie widać od razu, odczekaj lub odśwież z `?latest=true`.",
      "Sprawdź, że w podglądzie rewizji NIE ma osobnego wiersza „categoriesSource” - to pole techniczne.",
      "Na stronie osoby to samo pole nie ma się pojawiać: kategorie ma tylko instytucja.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "karta-firmy-prowadzi-na-strone-spolki",
    title: "Karta firmy na Eksploruj prowadzi na stronę spółki",
    description:
      "Na /eksploruj/tabela zawężonej do firmy nazwa w karcie u góry jest " +
      "teraz linkiem na stronę tej spółki. Gdy wybranych firm jest kilka i " +
      "karty się zwijają, ten sam link mają chipy z nazwami. Wcześniej z " +
      "tabeli nie dało się przejść na stronę spółki - trzeba było znaleźć ją " +
      "wyszukiwarką.",
    steps: [
      "Wejdź na /eksploruj/tabela?place=ZBcdQ9tUxVyv0o1mnpLH - u góry ma być karta z nazwą spółki.",
      "Kliknij nazwę w karcie: ma otworzyć /instytucja/… tej spółki.",
      "Wróć i w filtrach wybierz trzy firmy albo więcej - karty mają się zwinąć do chipów z nazwami. Kliknięcie chipa ma prowadzić na stronę tej spółki.",
      "Rozwiń („Pokaż szczegóły”) - nazwa na każdej karcie ma być linkiem tak samo jak przy jednej firmie.",
      "Wejdź na samą stronę spółki (/instytucja/…): tam ta sama karta jest nagłówkiem strony, więc nazwa ma zostać zwykłym tekstem, bez linku do samej siebie.",
    ],
    link: "/eksploruj/tabela?place=ZBcdQ9tUxVyv0o1mnpLH",
    area: "public",
  },
  {
    id: "przekierowanie-starego-adresu-nietrwale",
    title: "Stary adres wpisu nie zapamiętuje się w przeglądarce na stałe",
    description:
      "Adres z nieaktualną nazwą w linku (np. po zmianie nazwy spółki albo " +
      "po powrocie strony instytucji) nadal przenosi na właściwą stronę, ale " +
      "robi to przekierowaniem tymczasowym (302), a nie trwałym (301). " +
      "Trwałe przeglądarka zapisywała u siebie na zawsze i przestawała pytać " +
      "serwer - przez to strona instytucji po powrocie wciąż otwierała " +
      "Eksploruj u każdego, kto zajrzał tam wcześniej, i nie sięgało tam " +
      "żadne wdrożenie.",
    steps: [
      "Otwórz stronę spółki, np. /instytucja/pkp-szybka-kolej-miejska-w-trojmiescie-ZBcdQ9tUxVyv0o1mnpLH - ma się otworzyć strona instytucji, a nie /eksploruj/tabela.",
      "Podmień w adresie samą nazwę na byle jaką, zostawiając końcowe id (np. /instytucja/cokolwiek-ZBcdQ9tUxVyv0o1mnpLH) - ma przenieść na poprawny adres z właściwą nazwą.",
      "Wróć na ten sam zły adres jeszcze raz: ma znowu przenieść, a nie zostać na nim.",
      "To samo sprawdź na osobie (/osoba/zla-nazwa-<id>) i na temacie (/temat/zla-nazwa-<id>).",
      "Jeśli u siebie wciąż lądujesz na /eksploruj/tabela z adresu /instytucja/..., to stare trwałe przekierowanie zapisane w przeglądarce sprzed tej zmiany - sprawdź w oknie prywatnym albo po wyczyszczeniu pamięci podręcznej.",
    ],
    link: "/instytucja/pkp-szybka-kolej-miejska-w-trojmiescie-ZBcdQ9tUxVyv0o1mnpLH",
    area: "public",
  },
  {
    id: "tabela-firmy-wszystkich-wierszy",
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
    title: "Filtr kategorii firm: koleje",
    description:
      "Do filtra kategorii na Eksploruj doszła trzecia pozycja - „Koleje” - " +
      "obok szpitali oraz wodociągów i kanalizacji. Łapie przewoźników " +
      "kolejowych (pasażerskich i towarowych), spółki od infrastruktury " +
      "torowej i producentów taboru, a do tego imiennie te spółki grupy PKP, " +
      "których po kodach PKD nie da się rozpoznać - i imiennie odsiewa firmy " +
      "drogowe czy kopalnie, które mają kod kolejowy tylko dlatego, że mają " +
      "własną bocznicę. Kategorie wylicza pipeline przy imporcie spółki, " +
      "więc firma dostaje etykietę „Koleje” dopiero po kolejnym przejściu " +
      "importu spółek.",
    steps: [
      "Wejdź na /eksploruj/tabela i rozwiń filtry. Lista „Kategoria” ma mieć trzy pozycje: Szpitale, Wodociągi i kanalizacja, Koleje.",
      "Wybierz „Koleje” - w tabeli mają zostać tylko osoby powiązane ze spółkami kolejowymi (np. PKP), a adres ma dostać `?category=koleje`.",
      "Sprawdź, że są tam też przewoźnicy z nowszym PKD: PKP Szybka Kolej Miejska w Trójmieście, Łódzka Kolej Aglomeracyjna, Koleje Dolnośląskie, Koleje Wielkopolskie.",
      "I spółki bez kolejowego PKD: Polskie Koleje Państwowe, PKP Informatyka, PKP Cargotabor, PGE Energetyka Kolejowa Operator.",
      "A nie ma być: Instytutu Badawczego Dróg i Mostów, Kopalni Wapienia „Czatkowice”, Orlen Aviation ani Polskich Kolei Linowych.",
      "Odśwież stronę z tym adresem: filtr ma się odtworzyć z linku, a nie wrócić do „wszystkie”.",
      "To samo sprawdź na /eksploruj/nowe - ta sama lista kategorii, ta sama zawartość po wybraniu „Koleje”.",
      "Jeśli lista wyników jest pusta, to znaczy, że import spółek nie przeliczył jeszcze kategorii.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "graf-osoby-dwa-kroki",
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
    title: "Strona główna na telefonie: zdanie, wyszukiwarka, mapa",
    description:
      "Na wąskim ekranie nad wyszukiwarką jest jedno zdanie o tym, co ta " +
      "strona robi - zabrakło go, kiedy logo i nagłówek zeszły z pierwszego " +
      "ekranu. Przycisk „Działaj z nami” znika z telefonów, żeby mapa " +
      "koryciarstwa była pierwszą rzeczą pod wyszukiwarką; ten sam " +
      "odnośnik jest teraz w stopce, więc dalej można do niego trafić.",
    steps: [
      "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na stronę główną - nad wyszukiwarką ma być jedno zdanie o tym, co robimy.",
      "Sprawdź, że pod wyszukiwarką nie ma już przycisku „Działaj z nami” i że zaraz pod nią zaczyna się mapa.",
      "Przewiń na sam dół - w stopce, w „O projekcie”, ma być „Działaj z nami”, prowadzące na /pomoc.",
      "Rozszerz okno powyżej 960 px - wraca logo, nagłówek i przycisk obok wyszukiwarki, a zdanie znika (mówi to samo, co nagłówek).",
    ],
    link: "/",
    area: "public",
  },
  {
    id: "tabela-starts-at-the-table",
    title: "Tabela na telefonie zaczyna się od tabeli",
    description:
      "Na wąskim ekranie filtry są zwinięte pod jeden przycisk, nagłówek jest " +
      "mniejszy, a banerek logowania nie wypycha już przycisku poza ekran. " +
      "Pierwszy wiersz tabeli był 1300 px w dół - trzy machnięcia palcem - i " +
      "jest teraz od razu pod filtrem. Na komputerze wszystko zostaje po " +
      "staremu, filtry są rozwinięte.",
    steps: [
      "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na /eksploruj/tabela - tabela ma być widoczna bez przewijania albo po jednym machnięciu.",
      "Kliknij przycisk „Filtry i wyszukiwanie” - filtry mają się rozwinąć i zwinąć ponownie.",
      "Ustaw jakiś filtr, na przykład partię, i zwiń panel - na przycisku ma być „Filtry (1)”, żeby nie filtrował po cichu.",
      "Wyloguj się i sprawdź niebieski banerek: przycisk „Zaloguj się” ma być pod tekstem, w całości na ekranie.",
      "Spróbuj przewinąć stronę w bok - nie ma czego, nic nie wystaje poza ekran.",
      "Rozszerz okno powyżej 960 px - filtry mają być rozwinięte, bez przycisku do zwijania.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "reviewer-queue-one-button",
    title: "Kolejka rewizji: jeden przycisk zamiast pięciu",
    description:
      "Wiersz w kolejce ma teraz jeden przycisk - „Rozpatrz” - który otwiera " +
      "porównanie rewizji tego wpisu z tą jedną podświetloną i przewiniętą " +
      "na widok. Decyzje zapadają tam, gdzie widać całą zmianę, a nie w " +
      "najwęższej kolumnie tabeli. Autor i data to jedna kolumna " +
      "„Zgłoszenie” na początku wiersza, a „Czego dotyczy” nie rozpycha się " +
      "już na tytuł artykułu.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/kolejka.",
      "Sprawdź pierwszą kolumnę „Zgłoszenie” - w jednym miejscu ma być autor, kiedy zgłosił i status.",
      "Sprawdź ostatnią kolumnę - ma być w niej dokładnie jeden przycisk.",
      "Kliknij „Rozpatrz” - otwiera się porównanie rewizji tego wpisu, a kolumna z tą rewizją jest podświetlona i widoczna bez przewijania w bok.",
      "Zatwierdź albo odrzuć ją tam i wróć do kolejki - przycisk przy rozpatrzonej zmienia się na „Zobacz”.",
      "Ustaw filtr „Rodzaj” na „Wszystko” i znajdź rewizję powiązania - jej przycisk ma prowadzić na /admin/rewizje-krawedzi, bo powiązania recenzuje się tam.",
      "Znajdź rewizję artykułu o długim tytule - kolumna „Czego dotyczy” ma być wąska, tytuł ucięty po dwóch liniach, a cały widoczny w dymku po najechaniu.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "drawer-admin-revisions-link",
    title: "Skrót do rewizji także w panelu bocznym",
    description:
      "Przycisk „Rewizje”, który admin ma na stronie osoby, jest teraz również " +
      "w panelu bocznym otwieranym z tabeli - w tej samej linii co „Zaproponuj " +
      "zmianę” i głosy. Nie trzeba już wychodzić z tabeli, żeby dojść do " +
      "ekranu, na którym stronę się publikuje.",
    steps: [
      "Jako admin wejdź na /eksploruj/tabela i kliknij nazwisko - w panelu, w linii z głosami, ma być przycisk „Rewizje”.",
      "Kliknij go - ma otworzyć listę rewizji tej samej osoby, którą panel pokazywał.",
      "Wróć do tabeli, otwórz inną osobę i sprawdź, że przycisk prowadzi do niej, a nie do poprzedniej.",
      "Zaloguj się jako zwykły użytkownik i powtórz - „Zaproponuj zmianę” ma być, „Rewizji” nie.",
    ],
    link: "/eksploruj/tabela",
    area: "admin",
  },
  {
    id: "admin-feedback-settled-dimmed",
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
  /** When this reader accepted an admin's close on their own report of this
   * entry. Set from /qa, cleared by the next verdict; it is what stops the
   * entry counting as their problem without claiming they re-checked it. */
  acceptedResolutionAt?: string | null;
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
  // A reported problem the reader has since accepted as closed goes back to
  // needing a look, not to "sprawdzone": an admin marking their report
  // resolved is a claim by the team, and the entry only becomes verified when
  // this reader says so themselves. The stored verdict is still "issue" - the
  // acceptance is a separate field on purpose, so nothing has to lie about
  // what they found. See `acceptedResolutionAt`.
  if (mine?.status === "issue" && mine.acceptedResolutionAt) return "unchecked";
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
  /** Whether the last report this reader filed about the entry has already
   * been closed by an admin. Defaults to false, which is what every caller
   * that cannot know - the tests, anything reading a check on its own - should
   * get. */
  adminSettled = false,
): boolean {
  const text = note.trim();
  if (status === "ok" && !text) return false;
  // Saying it is still broken after somebody closed the report is news even in
  // the same words; that is the whole content of the message. Checked before
  // the de-dup below, which would otherwise read it as the same verdict twice
  // and leave the reader with no way to argue back.
  if (adminSettled && status === "issue") return true;
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
