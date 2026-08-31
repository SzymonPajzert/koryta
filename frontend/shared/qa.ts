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
    id: "scalony-duplikat-znika-z-list",
    title: "Scalony duplikat znika z tabeli i z podpowiedzi",
    description:
      "Scalona strona zostaje w bazie, żeby jej stary adres nadal " +
      "przekierowywał na tę, która została - ale znikała tylko dla " +
      "niezalogowanych. Zalogowany widział ją dalej w tabeli, bo „robocze” " +
      "znaczy „nieopublikowane”, a scalony duplikat jest właśnie " +
      "nieopublikowany. Trzymał się przy tym filtrów po pracodawcy, regionie " +
      "i „obecnie zatrudniony”, bo licznik posad liczył też powiązania " +
      "usunięte - a scalenie zostawia po sobie właśnie takie, kiedy to samo " +
      "zatrudnienie jest już na stronie, która została. Przeliczenie " +
      "statystyk tego nie naprawiało, bo liczyło je tak samo. Teraz scalone " +
      "strony nie wchodzą na listy, usunięte powiązanie nie liczy się do " +
      "niczego, a upload nie dopisze nowych faktów do scalonej strony - " +
      "trafiają na tę, która została.",
    steps: [
      "Przelicz statystyki (POST /api/stats/computeNodes) - liczniki policzone starą regułą zostają w bazie do następnego przeliczenia.",
      "Zaloguj się i otwórz /eksploruj/tabela z widocznością „robocze”. Żadna ze scalonych stron nie ma być wierszem - sprawdź po nazwisku kogoś, kogo scalałeś.",
      "Wejdź na stary adres scalonego duplikatu - ma nadal przekierowywać na stronę, która została.",
      "W formularzu powiązania zacznij wpisywać nazwisko scalonego duplikatu - do wyboru ma być tylko strona, która została.",
      "Weź osobę, której admin usunął posadę, i po przeliczeniu sprawdź jej wiersz w tabeli: nie ma jej już pokazywać jako obecnie zatrudnionej u tego pracodawcy ani wpadać w filtr po tym pracodawcy.",
    ],
    link: "/eksploruj/tabela",
    area: "contributor",
  },
  {
    id: "statystyki-bez-migracji",
    title: "Statystyki nie liczą migracji jako czyjejś pracy",
    description:
      "Skrypty migracyjne podpisują swoje zapisy własną nazwą, żeby dało się " +
      "sprawdzić, który przebieg co zmienił. Na wykresie aktywności wyglądało " +
      "to jak dzień pracy jednego człowieka: scalanie duplikatów osób zapisało " +
      "31 sierpnia 1081 propozycji zmian w kilka minut i przykryło sobą " +
      "wszystko, co zrobili ludzie. Teraz zapisy skryptów nie liczą się wcale " +
      "- tak samo jak od dawna nie liczą się oceny wystawione przez modele. " +
      "Same zmiany zostają w bazie i w historii strony, znikają tylko z " +
      "rankingu i z wykresu.",
    steps: [
      "Otwórz /eksploruj/statystyki z zakresem 30 dni. W „Kto tworzy koryta.pl” nikt nie powinien mieć kilkuset zmian z jednego dnia.",
      "Popatrz na wykres dzienny: 31 sierpnia ma być zwykłym dniem, a nie słupkiem kilkadziesiąt razy wyższym od pozostałych.",
      "Sprawdź kafelek „Propozycja zmiany”: liczba ma być porównywalna z tym, co widać przy zakresie 7 dni, a nie o rząd wielkości większa.",
      "Sprawdź, że Twój własny wiersz i Twoja pozycja w rankingu się nie zmieniły.",
      "Wejdź na stronę scaloną (taką z przekierowaniem do drugiej osoby) i sprawdź, że historia zmian nadal pokazuje, co zrobiła migracja.",
    ],
    link: "/eksploruj/statystyki",
    area: "public",
  },
  {
    id: "osoba-rozpoznawana-po-rejestrze",
    title: "Upload rozpoznaje osobę po wpisie w rejestrze, nie po imieniu",
    description:
      "Pipeline nie ma jednego, stałego zapisu czyjegoś imienia - raz przysyła " +
      "„Andrzej Golimont”, raz „Andrzej Marcin Golimont”, bo wybiera je z listy, " +
      "której kolejność nie jest ustalona. Upload porównywał dokładnie ten " +
      "napis, więc druga pisownia zakładała drugą stronę: tak powstało 170 par " +
      "stron opisujących jedną osobę. W drugą stronę było gorzej - dwóch " +
      "różnych ludzi o tym samym imieniu i nazwisku trafiało na jedną stronę, a " +
      "drugi z nich nadpisywał pierwszemu odnośnik do rejestru. Teraz upload " +
      "szuka najpierw po wpisie w rejestr.io, który jest jeden na człowieka. Po " +
      "imieniu dopasowuje się tylko do strony, która żadnego wpisu jeszcze nie " +
      "ma - i wtedy jej ten wpis dopisuje. Strona z innym wpisem w rejestrze to " +
      "nie jest ta sama osoba, choćby nazywała się tak samo. " +
      "Dodatkowo pipeline podaje teraz wprost id strony, na której dana osoba " +
      "już jest - bo 868 osób nie ma żadnego wpisu w rejestrze i dla nich " +
      "samo imię to za mało. Id wysyłane jest tylko wtedy, gdy pasowała " +
      "dokładnie jedna strona; przy dwóch pasujących pipeline nie zgaduje.",
    steps: [
      "Poproś o upload osoby, która jest już na stronie, ale w pipeline ma inną pisownię imienia (np. z drugim imieniem). Nie powinna powstać druga strona - ma się zaktualizować istniejąca.",
      "Sprawdź /admin/rewizje/kolejka: nie powinno przybyć nowej osoby o niemal identycznym imieniu.",
      "Otwórz osobę bez wypełnionego rejestr.io i poproś o jej upload - odnośnik do rejestru ma się pojawić na istniejącej stronie, bez zakładania nowej.",
      "Sprawdź przypadek odwrotny: dwie różne osoby o tym samym imieniu i nazwisku, o różnych wpisach w rejestrze, mają zostać dwiema stronami.",
      "Weź osobę bez wpisu w rejestrze, której strona nazywa się inaczej niż to, co przysyła pipeline (np. wielkimi literami albo z drugim imieniem) - i tak ma trafić na istniejącą stronę, bez zakładania nowej.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "scalanie-duplikatow-osob",
    title: "Duplikat osoby można scalić z właściwą stroną",
    description:
      "Jedna osoba na dwóch stronach to dwie połowy tego, co o niej wiadomo, i " +
      "żadnej z nich nie da się po prostu usunąć. Admin wskazuje więc, która " +
      "strona jest duplikatem, a której powiązania mają zostać - i wszystkie " +
      "powiązania duplikatu przenoszą się na stronę, która zostaje. Powtórzone " +
      "zatrudnienia znikają, bo powiedziane dwa razy nie mówią nic więcej; " +
      "powtórzone kandydatury zostają i są zgłaszane do przejrzenia, bo dwa " +
      "identycznie zapisane starty w wyborach potrafią być dwoma prawdziwymi. " +
      "Duplikat nie znika z bazy: jego adres nadal działa i przekierowuje na " +
      "stronę, która została, więc stare linki się nie psują. Przed scaleniem " +
      "okno pokazuje, co dokładnie się stanie.",
    steps: [
      "Jako admin wejdź na stronę osoby, która ma swój duplikat, i otwórz „Ta strona to duplikat”.",
      "Wskaż drugą stronę i wpisz powód. Okno ma najpierw pokazać podsumowanie: ile powiązań się przeniesie, ile zniknie jako powtórzenie, ile zostanie do przejrzenia.",
      "Potwierdź. Powinno przerzucić cię na stronę, która została, i mieć na niej powiązania z obu.",
      "Wejdź na stary adres duplikatu - ma przekierować na stronę, która została, a nie pokazać 404.",
      "Sprawdź /admin/audyt (log admina): ma być wpis „Scalenie duplikatu” z oboma id.",
    ],
    area: "admin",
  },
  {
    id: "strona-ktora-jest-dwiema-osobami",
    title: "Stronę, która okazała się dwiema osobami, można rozdzielić",
    description:
      "Odwrotny problem do duplikatu i trudniejszy: przy dwóch osobach o tym " +
      "samym imieniu, nazwisku i roczniku pipeline traktował je jak jedną, a " +
      "powiązania nie zapisują, z którego wpisu w rejestrze pochodzą - więc " +
      "żadne zapytanie nie powie, czyja jest która posada. Może to powiedzieć " +
      "tylko człowiek, dlatego rozdzielenie polega na zaznaczeniu powiązań " +
      "należących do tej drugiej osoby. Można je przenieść na stronę utworzoną " +
      "wcześniej ręcznie albo od razu założyć nową. Ponieważ zauważenie " +
      "problemu i rozplątanie go to zwykle dwa różne dni, stronę można też " +
      "najpierw tylko oznaczyć - wtedy admin widzi na niej pasek, że to dwie " +
      "osoby, razem z powodem i tym, kto to zgłosił. Powiązania niezaznaczone " +
      "zostają tam, gdzie były.",
    steps: [
      "Jako admin otwórz osobę, co do której wiadomo, że łączy dwie (np. częste imię i nazwisko z posadami w dwóch odległych miejscach), i wybierz „Ta strona to dwie osoby”.",
      "Użyj „Zaznacz do rozdzielenia” z powodem. Odśwież stronę - ma być widoczny pasek z powodem i autorem zgłoszenia.",
      "Wróć do okna, wybierz „Rozdziel teraz”, zaznacz powiązania drugiej osoby i wpisz jej imię.",
      "Sprawdź podsumowanie przed potwierdzeniem, potwierdź, a potem otwórz nową stronę - ma mieć dokładnie zaznaczone powiązania i być szkicem do publikacji.",
      "Wróć na pierwotną stronę: pasek „to dwie osoby” ma zniknąć, a niezaznaczone powiązania zostać.",
    ],
    area: "admin",
  },
  {
    id: "kandydatura-bez-regionu-nie-blokuje-osoby",
    title: "Jedna kandydatura bez regionu nie przepada już razem z całą osobą",
    description:
      "Kandydatura wisi przy regionie, w którym się startowało, a PKW nie " +
      "zawsze podaje który to był - dla wyborów z lat 90. nie opublikowała " +
      "mapowania okręgów w ogóle, a region z nowszej kandydatury może po " +
      "prostu nie mieć jeszcze swojej strony. Do tej pory taka jedna " +
      "kandydatura wywracała cały upload osoby: nie zapisywały się ani jej " +
      "zatrudnienia, ani dane na jej stronie, ani pozostałe kandydatury z " +
      "tej samej paczki. Najbardziej bolało to przy uploadach, które o " +
      "wyborach w ogóle nie były - na przykład zbierających rady nadzorcze " +
      "szpitali. Teraz taka kandydatura jest pomijana i wypisywana w " +
      "odpowiedzi, a reszta osoby zapisuje się normalnie.",
    steps: [
      "Wejdź na stronę osoby, która startowała w wyborach z lat 90. (np. przez /eksploruj i filtr partii): ma mieć swoje zatrudnienia i powiązania, nawet jeśli tamtej kandydatury nie widać.",
      "Po ponownym uploadzie osób sprawdź w logach uploadera podsumowanie „candidacies were not placed” - „expected” to wybory, dla których PKW nigdy nie podała okręgu, a „no-region” to region, który nie ma jeszcze węzła.",
      "Sprawdź, że kandydatury, które da się umiejscowić, nadal się zapisują: otwórz osobę ze startem w 2024 i zobacz powiązanie z jej powiatem.",
    ],
    area: "admin",
  },
  {
    id: "ingest-bez-pustych-rewizji",
    title: "Upload z pipeline'ów nie dopisuje rewizji, które nic nie zmieniają",
    description:
      "Pipeline'y wysyłają na stronę wszystkie firmy, które już na niej są, " +
      "i wszystkie osoby z regionu - raz za razem, bo nie wiedzą z góry, " +
      "o której z nich dowiedziały się czegoś nowego. Do tej pory każdy taki " +
      "upload dopisywał firmie rewizję, nawet jeśli była słowo w słowo taka " +
      "sama jak ta, którą firma już miała: historia zmian zapełniała się " +
      "powtórzeniami samej siebie, a strona przy okazji przepisywała się cała " +
      "od nowa. Teraz upload najpierw porównuje to, co ma zapisać, z tym, co " +
      "na stronie stoi, i jeśli nic by się nie zmieniło - nie pisze nic. " +
      "Zmiana, która coś wnosi, zapisuje się dokładnie tak jak wcześniej, " +
      "a firma, której brakuje licznika albo zatwierdzonej rewizji, dostaje " +
      "zapis mimo wszystko, bo tu zapis jest naprawą.",
    steps: [
      "Wejdź na /admin/rewizje/kolejka i zapamiętaj, ile rewizji czeka.",
      "Poproś o ponowny upload CompaniesPayloads (albo poczekaj na kolejny) i odśwież kolejkę - dla firm, o których nic nowego nie wiadomo, nie powinno przybyć nic.",
      "Otwórz dowolną firmę, która była w uploadzie, np. przez /instytucja/<slug>-<id>, i zjedź do historii rewizji: kolejne uploady nie mają dokładać wpisów z tą samą treścią.",
      "Sprawdź drugą stronę: zmień coś w danych firmy w pipeline (np. kategorię) i wyślij ponownie - ta jedna zmiana ma się zapisać normalnie.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "wyksztalcenie-osoby",
    title: "Wykształcenie w danych osoby",
    description:
      "Karta osoby ma nowe pole „Wykształcenie”, do wpisania w oknie " +
      "propozycji zmiany i pokazywane w szczegółach obok daty urodzenia. To " +
      "zwykły tekst, a nie lista poziomów, bo użyteczna odpowiedź bywa " +
      "stopniem („magister inżynierii środowiska”), a bywa formacją, której " +
      "żadna skala stopni nie obejmuje („duchowny prawosławny”). Pole jest " +
      "puste wszędzie, dopóki ktoś go nie wypełni - żaden import go nie " +
      "uzupełnia.",
    steps: [
      "Wejdź na stronę osoby i sprawdź, że w szczegółach nie ma „Wykształcenie”, dopóki nikt go nie podał.",
      "Kliknij ołówek („Zaproponuj zmianę”) i sprawdź, że pod datą urodzenia jest pole „Wykształcenie” z podpowiedzią przykładów.",
      "Wpisz np. „magister inżynierii środowiska” i wyślij propozycję.",
      "Sprawdź w kolejce rewizji, że zmiana jest opisana jako „wykształcenie”, a nie angielską nazwą pola.",
      "Zatwierdź ją i sprawdź, że na stronie osoby pojawiło się „Wykształcenie” z tą treścią.",
      "Otwórz okno propozycji zmiany jeszcze raz - pole ma być wypełnione tym, co już zapisano.",
    ],
    area: "contributor",
  },
  {
    id: "szpitale-na-telefonie",
    title:
      "Szpitale na telefonie: wykres od razu, bez wstępu i bez kolumn dla redakcji",
    description:
      "Strona nie mieściła się na telefonie - trzeba było ją oddalić, żeby " +
      "cokolwiek przeczytać. Wiersz wykresu miał pięć kolumn i przy " +
      "najwęższym ustawieniu i tak potrzebował 446 px, a w karcie na " +
      "ekranie 375 px jest ich około 310. Poniżej progu „sm” zostają trzy " +
      "kolumny: nazwa, słupek i liczba znalezionych miejsc. Znikają dwie " +
      "redakcyjne - „do sprawdzenia” i „kolejka pracy” - bo wybierania " +
      "sobie następnej partii osób do sprawdzenia nikt nie robi na " +
      "telefonie. Z tego samego powodu znika na telefonie przełącznik " +
      "wykres/tabela: dwie ikony obok tytułu łamały go na trzy linijki, " +
      "czyli kosztowały ekran wysokości. Znika wreszcie szary ogon słupka - " +
      "zaległość z rejestru - bo to ta sama redakcyjna połowa wykresu co " +
      "kolumna i przycisk, a na telefonie zajmowała większość tuszu wiersza. " +
      "Na telefonie nie ma więc dojścia do tabeli ani do żadnej liczby " +
      "zaległości - wszystko to jest dla tej samej osoby przy biurku. " +
      "Skoro ogona nie ma, słupki są na telefonie mierzone do najdłuższego " +
      "wiersza ZNALEZIONEGO, a nie do tego, co wiadomo z KRS: inaczej każdy " +
      "słupek siedziałby w torze, którego większość jest pusta i nic nie " +
      "mówi, dlaczego. Skala dalej jest wspólna dla wszystkich wierszy i " +
      "żaden nie jest skalowany osobno, więc wiersze wciąż da się " +
      "porównywać - podpis nad wykresem mówi, do czego. " +
      "Do tego wykres wychodzi na samą górę strony: pięć kafelków, pasek " +
      "organów nadzoru i notka o radach społecznych to kontekst do jego " +
      "czytania, a nie wejście, a na telefonie były trzema ekranami " +
      "wstępu przed pierwszym słupkiem. Teraz stoją pod wykresem, w tej " +
      "samej kolejności co wcześniej. Nad wykresem nie ma już akapitu " +
      "wstępu ani nagłówka „Podział na partie” - obydwa powtarzały to, co " +
      "mówi tytuł karty i notka pod nią, a nagłówek przestał być prawdziwy, " +
      "gdy wykres dostał podział na województwa i szpitale. Zniknął też " +
      "przycisk „Statystyki bazy”: prowadził na stronę redakcyjną, a nie " +
      "tam, gdzie idzie czytelnik tej. Sama strona przestała wreszcie " +
      "dokładać 16 px marginesu do tego, który ma już kontener.",
    steps: [
      "Otwórz /eksploruj/szpitale na telefonie (albo w oknie 375 px szerokości).",
      "Strona nie ma się przewijać na boki i nie ma wymagać oddalenia - żaden element nie wystaje poza ekran.",
      "Pod nagłówkiem „Rady nadzorcze szpitali publicznych” nie ma akapitu wstępu ani przycisku „Statystyki bazy” - od razu jest przełącznik rady nadzorcze / rady społeczne i wykres. Kafelki „W skrócie” są dopiero pod nim.",
      "Nie ma nagłówka „Podział na partie”. Kartę tytułuje sam wykres, zgodnie z wybranym podziałem.",
      "Wiersz wykresu ma nazwę, słupek i jedną liczbę. Nie ma kolumny „do sprawdzenia” ani przycisku „Zobacz osoby” / „Zaloguj się”.",
      "Słupek jest w całości kolorowy - nie ma za nim szarego ogona, a w legendzie nie ma pozycji „osoby z rejestru, jeszcze niesprawdzone”.",
      "Najdłuższy słupek sięga końca toru. Podpis nad wykresem ma podawać skalę „do N sprawdzonych miejsc” i mówić, że zaległości na wąskim ekranie nie rysujemy.",
      "W prawym górnym rogu karty nie ma pary ikon wykres/tabela, a tytuł karty nie łamie się przez nie na trzy linijki.",
      "Rozszerz okno powyżej 600 px: mają wrócić obie kolumny, przycisk kolejki, szary ogon, jego pozycja w legendzie i przełącznik wykres/tabela. Skala nad wykresem ma wrócić do „miejsc znanych z KRS”, a słupki - skrócić. Po przełączeniu na tabelę kolumna „Do sprawdzenia” ma tam być, a tabela ma się przewijać w poziomie w swojej ramce, nie razem ze stroną.",
      "Notka „Rada społeczna to nie rada nadzorcza” stoi pod wykresem i mówi o przełączniku „nad wykresem” - sprawdź, że wskazuje na ten, który faktycznie jest wyżej.",
      "Wejdź na /eksploruj/statystyki na telefonie: tam przełącznik wykres/tabela ma zostać - zniknął tylko na wykresie szpitali.",
    ],
    link: "/eksploruj/szpitale",
    area: "public",
  },
  {
    id: "omnisearch-opuszcza-podglad-rewizji",
    title: "Wyszukiwarka wychodzi z podglądu rewizji",
    description:
      "Profil otwarty z kolejki rewizji albo z „Moich propozycji” ma w adresie " +
      "parametr rewizji i pokazuje proponowane zmiany nałożone na dane osoby. " +
      "Wyszukanie kogoś innego przenosiło ten parametr na nowy adres, więc na " +
      "profilu kolejnej osoby dalej widać było poprzednią rewizję - wyglądało " +
      "to tak, jakby wyszukiwarka w ogóle nie przeszła dalej. Filtry z adresu " +
      "zostają teraz tylko wtedy, gdy wybór z listy nie zmienia strony, na " +
      "przykład przy wyborze partii w tabeli.",
    steps: [
      "Otwórz profil dowolnej osoby w podglądzie rewizji - z panelu rewizji albo z „Moich propozycji” w swoim profilu. U góry strony jest wtedy niebieska informacja o podglądzie propozycji.",
      "W wyszukiwarce na górze wpisz nazwisko innej osoby i wybierz ją z listy.",
      "Sprawdź, że otworzył się profil wybranej osoby, bez paska podglądu rewizji, i że w adresie nie ma już parametru revisionId.",
      "Wejdź na /eksploruj/tabela, ustaw dowolny filtr, a potem wybierz partię z wyszukiwarki - poprzedni filtr ma zostać.",
    ],
    link: "/profil",
    area: "contributor",
  },
  {
    id: "szpitale-jeden-wykres-trzy-podzialy",
    title:
      "Szpitale: jeden wykres zamiast trzech, przełączany na partie, województwa albo szpitale",
    description:
      "Strona miała trzy wykresy pod sobą - miejsca według partii, te same " +
      "miejsca według województwa i tabelę tych samych miejsc według " +
      "szpitala - każdy w swojej skali, i nic nie mówiło, że to trzy " +
      "odczyty jednego zbioru. Teraz jest jeden wykres i jedna kontrolka: " +
      "„Podziel według” partii, województwa albo szpitala. Przy podziale na " +
      "województwo i szpital wiersz pokazuje obie liczby naraz: kolorowa " +
      "głowa słupka to miejsca sprawdzone i opublikowane w podziale na " +
      "partie, a cienki szary ogon to zakres, który został do sprawdzenia - " +
      "sama liczba osób z rejestru. Skala jest wspólna dla wszystkich " +
      "wierszy i nikt jej nie poprawia, więc kolor zajmuje tyle miejsca, ile " +
      "naprawdę sprawdziliśmy; czytelność bierze się z wysokości, bo główka " +
      "jest pełnej wysokości, a ogon niski. Podział na partie nie ma " +
      "szarego ogona i tak ma być: nie wiemy, do jakiej partii należą " +
      "niesprawdzone osoby, i nie zgadujemy. " +
      "Przycisk do kolejki pracy przestał być wyszarzony - wyszarzony " +
      "przycisk w wariancie „tonal” nie ma poprawki kontrastu, którą serwis " +
      "stosuje do pozostałych, więc był nieczytelny, i nie mówił, co zrobić. " +
      "Teraz dla niezalogowanych jest to zwykły, czytelny odnośnik " +
      "„Zaloguj się”, który po zalogowaniu wraca na tę samą stronę. " +
      "SLD i Nowa Lewica to ta sama partia po zmianie nazwy i serwis malował " +
      "je tym samym czerwonym, więc były dwoma słupkami, których nie dało się " +
      "ani rozróżnić, ani dodać. Liczymy je teraz razem, jako „Nowa Lewica / " +
      "SLD” — a osoba, która ma na profilu obie nazwy, liczy się raz.",
    steps: [
      "Wejdź na /eksploruj/szpitale i zjedź do „Podział na partie”. Ma być JEDEN wykres, nie trzy.",
      "Nad wykresem stoi jedna kontrolka „Podziel według” z trzema przyciskami: Partii, Województwa, Szpitala. Nie ma osobnych przycisków sortowania.",
      "Zostaw „Partii”: każdy wiersz to jedna partia, słupek jest w całości kolorowy i nie ma szarego ogona. Pod wykresem ma być zdanie tłumaczące, dlaczego go nie ma.",
      "Przełącz na „Województwa”: szesnaście wierszy, każdy z kolorową główką (partie) i cienkim szarym ogonem (reszta do sprawdzenia).",
      "Przełącz na „Szpitala”: to samo, ale wiersze to szpitale. Ma się pokazać pierwsze 25 i przycisk „Pokaż pozostałe N” - liczba musi się zgadzać z resztą listy.",
      "Wiersze są zawsze uporządkowane od największej liczby ZNALEZIONYCH miejsc, nie od największej liczby miejsc w ogóle.",
      "Przy podziale na szpitale kolumna z nazwą jest szersza niż w pozostałych podziałach — nazwy szpitali są długie, a słupki krótkie, więc miejsce idzie tam, gdzie jest potrzebne. Żadna nazwa nie ma być ucięta wielokropkiem.",
      "W legendzie ma być jedna pozycja „Nowa Lewica / SLD”, a nie dwie osobne w tym samym czerwonym.",
      "Najedź na szary ogon: dymek podaje samą liczbę osób z rejestru. Nie ma w nim partii ani nazwiska.",
      "W prawym górnym rogu karty jest przełącznik wykres/tabela - ma dalej działać i pokazywać te same liczby w kolumnach.",
      "Wyloguj się: przycisk przy wierszu ma mówić „Zaloguj się”, ma być czytelny (ciemnoniebieski albo ciemnobursztynowy napis, nie blady) i ma być klikalny.",
      "Kliknij go: ma zabrać na /login, a po zalogowaniu wrócić na /eksploruj/szpitale, a nie na stronę główną.",
      "Zaloguj się i kliknij „Zobacz osoby” przy dowolnym województwie: otwiera tabelę zawężoną do tego regionu, tylko nieopublikowane, od najnowszych wpisów.",
      "Zmruż oczy albo włącz skalę szarości: żaden napis na przycisku nie może zniknąć z tła.",
    ],
    link: "/eksploruj/szpitale",
    area: "public",
  },
  {
    id: "ranking-wspolautorow-na-gorze",
    title:
      "Statystyki zaczynają się od tego, kto je tworzy — z zamazanymi nazwami i przełącznikiem w profilu",
    description:
      "Ranking „Najaktywniejsi” był na samym dole strony i widzieli go " +
      "wyłącznie administratorzy; wszyscy inni dostawali jedno zdanie o tym, " +
      "ile osób coś robiło. Teraz jest na górze i widzą go wszyscy, ale " +
      "nazwy są zamazane (A•••••) — dopóki ich właściciel nie włączy " +
      "widoczności w /profil. Swoje własne miejsce widzisz zawsze, także " +
      "wtedy, gdy wypadasz poza pokazaną dwudziestkę piątkę. Serwer nie " +
      "wysyła nikomu poza administratorem uid, adresu ani awatara osoby, " +
      "która się nie zgodziła.",
    steps: [
      "Otwórz /eksploruj/statystyki bez logowania: ranking jest pierwszą sekcją, nazwy są zamazane, a pod tabelą jest zaproszenie do zalogowania.",
      "Zaloguj się jako zwykły użytkownik i wróć na tę stronę: Twój wiersz jest podświetlony i podpisany „· Ty”, a zaproszenie zmienia się w „Pokaż moją nazwę”.",
      "Wejdź w /profil, w karcie „Widoczność w statystykach” zobacz podgląd zamazanej nazwy i włącz przełącznik.",
      "Wróć na /eksploruj/statystyki — po odświeżeniu (odpowiedź jest buforowana do 5 minut) Twoja nazwa jest widoczna, a zaproszenie mówi, że można ją schować z powrotem.",
      "Zaloguj się jako administrator: nazwy, adresy i odnośniki do kolejki rewizji są jak dotąd.",
    ],
    link: "/eksploruj/statystyki",
    area: "public",
  },
  {
    id: "aktywnosc-bez-hurtu-ingestu",
    title:
      "Aktywność liczy decyzje, a nie zapisy: koniec z ingestem i publikowaniem krawędzi na szczycie rankingu",
    description:
      "Wykres i ranking liczyły każdy zapis osobno, więc dominowały je dwie " +
      "rzeczy, które nie są niczyją pracą redakcyjną. Węzły artykułów: każda " +
      "zescrapowana albo przechwycona strona zakładała węzeł i liczyła się " +
      "jako „propozycja zmiany” (48 z 51 propozycji najaktywniejszej osoby w " +
      "ostatnich 30 dniach). Oraz publikowanie: opublikowanie osoby z " +
      "kilkunastoma powiązaniami zostawiało w dzienniku ~25 wpisów i tyleż " +
      "kresek na wykresie. Teraz artykuły zakładane przez ingest nie liczą się " +
      "wcale (ale artykuł poprawiony ręcznie — owszem), a publikacja to jedna " +
      "nowa kategoria „Opublikowane osoby” — jedna na stronę, nie jedna na " +
      "powiązanie. Przy okazji wróciły notatki: od 2 sierpnia zapisują datę " +
      "jako znacznik czasu, a nie tekst, i licznik „Źródło lub zgłoszenie” ich " +
      "nie widział — w 30-dniowym oknie pokazywał 18 źródeł zamiast 272.",
    steps: [
      "Otwórz /eksploruj/statystyki i sprawdź, że w kaflach aktywności jest kategoria „Opublikowane osoby” (fioletowa), obok „Decyzji administratora”.",
      "Najedź na nią: opis mówi, że powiązania opublikowane razem ze stroną liczą się raz.",
      "Jako administrator opublikuj osobę z kilkoma powiązaniami, odczekaj do 5 minut (bufor) i sprawdź, że w rankingu przybyła 1 publikacja, a nie tyle, ile było powiązań.",
      "Dodaj artykuł przez /zrodla albo wtyczkę i sprawdź, że licznik „Propozycja zmiany” się nie zmienił.",
      "Dodaj źródło do notatki i sprawdź, że licznik „Źródło lub zgłoszenie” urósł — wcześniej stał w miejscu.",
    ],
    link: "/eksploruj/statystyki",
    area: "public",
  },
  {
    id: "tabela-kontrast-i-kolory",
    title:
      "Tabela eksploracji: czytelne kolory zamiast bladej zieleni, i kolor tylko tam, gdzie coś znaczy",
    description:
      "Zieleń i róż serwisu to kolory tła, a były używane jako kolor pisma: " +
      "nazwisko w tabeli, żeton filtru i przycisk „Pomóż sprawdzać” miały " +
      "kontrast 1,85:1 przy wymaganych 4,5:1, plakietka „szkic” 2,37:1, a " +
      "żeton Konfederacji czarny napis na granacie, czyli 1,29:1. Serwis ma " +
      "teraz drugą połowę palety: ciemne odcienie do pisania i blade do tła, " +
      "każdy zmierzony, więc każde zestawienie jest czytelne bez zgadywania. " +
      "Przy okazji strona wzięła trochę wyglądu strony podmiotu: zielone tło " +
      "pod nagłówkami kolumn, bladozieloną pigułkę z ikoną kalendarza na " +
      "dacie ostatniego zatrudnienia („od marca 2021” zamiast surowego „od " +
      "2019-03-01”) i nagłówki grup z licznikiem w panelu filtrów. Zieleni " +
      "jest przy tym tyle, ile coś mówi: zniknął pasek przy lewej krawędzi " +
      "paska filtrów i pasek przy lewej krawędzi każdego wiersza, bo " +
      "powtórzone w dziesięciu wierszach nie oddzielały niczego od niczego; " +
      "podświetlenie wiersza pod kursorem zostało, bo wskazuje ten jeden " +
      "wiersz. Nazwisko jest ciemnozielone i pogrubione, ale bez " +
      "podkreślenia - to nie jest odnośnik, tylko otwarcie panelu, więc " +
      "podkreślenie pojawia się dopiero pod kursorem. Przycisk otwierający " +
      "wyszukiwarki przestał być różowym kółkiem i jest znowu samą ikoną, " +
      "ciemną zamiast bladoróżowej: wypełnienie robiło z pomocniczej akcji " +
      "najgłośniejszy element wiersza, głośniejszy niż nazwisko obok. Kolor " +
      "niesie teraz znaczenie: zielone żetony mówią, czego tabela dotyczy, " +
      "niebieskie gdzie, szare zawężenia redakcyjne, bursztynowy „Tylko " +
      "szkice” i zielony „Tylko opublikowane” w tym samym kolorze co " +
      "plakietka na wierszach, które zostawiają - a ikonę ma z nich tylko " +
      "żeton kategorii, bo tylko jego napis („Szpitale”) sam nie mówi, czego " +
      "dotyczy.",
    steps: [
      "Wejdź na /eksploruj/tabela: nazwiska mają być ciemnozielone i pogrubione, a nie blade, i bez podkreślenia. Najedź kursorem na nazwisko - podkreślenie ma się pojawić dopiero wtedy.",
      "Ustaw filtr kategorii firm: żeton na pasku ma mieć wypełnione tło, ikonę sektora z lewej, a napis ma być czytelny, a nie w kolorze tła żetonu.",
      "Ustaw jeszcze filtr województwa i „Min. głosy”: te żetony mają być bez ikony, bo ich napisy („Region: ...”, „Min. 5 głosów”) same mówią, czego dotyczą. Ikonę ma tylko żeton kategorii.",
      "Ustaw filtr województwa i filtr kategorii naraz: żeton województwa ma być niebieski, a kategorii zielony, i mają się różnić na pierwszy rzut oka.",
      "Znajdź osobę z partią Konfederacja: napis na granatowym żetonie ma być biały, a nie czarny. PO ma mieć czarny napis na pomarańczowym, nie biały.",
      "Pod firmami: data ma stać w bladozielonej pigułce z ikoną kalendarza i brzmieć „od <miesiąc słownie> <rok>”, na przykład „od marca 2021”. Nigdzie nie może być surowej daty w rodzaju „od 2019-03-01”.",
      "Przesuń kursor po wierszach: wiersz ma się delikatnie podświetlać na zielono. Przy lewej krawędzi wiersza nie może stać zielony pasek - ani przy lewej krawędzi paska filtrów nad tabelą.",
      "Na szerokim ekranie sprawdź przycisk otwierający wyszukiwarki obok nazwiska: ma to być sama ciemna ikona, bez różowego kółka pod spodem, i ma być mniej widoczny niż nazwisko, obok którego stoi.",
      "Przewiń tabelę w dół na komputerze: nagłówki kolumn przyklejają się do góry i mają mieć bladozielone tło, przez które nie prześwitują przejeżdżające pod nimi wiersze.",
      "Zaloguj się i ustaw „Widoczność: Tylko szkice”: żeton filtru ma być bursztynowy, w tym samym kolorze co plakietki „szkic” przy nazwiskach. Po przełączeniu na „Tylko opublikowane” żeton ma być zielony.",
      "Zalogowany sprawdź kolumnę „Twój głos”: po oddaniu głosu na plus liczba i strzałka mają być ciemnozielone, a nie jasne, i tak samo czerwone na minus.",
      "Otwórz „Filtry”: nad każdą grupą ma być mała etykieta („Osoba i podmiot”, „Weryfikacja”, „Więcej filtrów”), a po prawej liczba ustawionych w niej filtrów, na przykład „2 filtry”. Grupa, w której nic nie ustawiono, nie ma liczby.",
      "W „Więcej filtrów” wybierz kilka partii: żetony w polu wyboru mają mieć kolory partii, te same co przy nazwiskach w tabeli. Wybierz partię, dla której serwis nie ma koloru (np. Razem): ma być szara z czytelnym napisem, a nie ciemna.",
      "Kliknij przycisk udostępniania: zdanie opisujące widok ma stać na bladozielonym tle z ikoną filtru, a oba przyciski kopiowania mają mieć ikony.",
      "Ustaw filtr województwa i nie ustawiaj żadnej firmy: pod tabelą pojawia się apel o zrzutkę. Jego tekst ma być czytelny i ciemny, a nie pomarańczowy na pomarańczowym tle.",
      "Wyloguj się i wejdź na /eksploruj/tabela: nad tabelą stoi niebieski baner „Zaloguj się...”. Jego tekst, pogrubiona liczba i ikona mają być ciemnoniebieskie, a nie blade.",
      "Kliknij nazwisko i w panelu sprawdź przycisk „Zaproponuj zmianę”: napis ma być ciemnobursztynowy na jasnym tle, a nie pomarańczowy na pomarańczowym. Po wysłaniu zmiany odnośnik „Podgląd zmiany” w potwierdzeniu ma być podkreślony i w tym samym ciemnym niebieskim co zdanie obok.",
      "Otwórz „Filtry” i wybierz cokolwiek w polu z listą: nazwa pola, która przeskakuje nad wybraną wartość, ma być czytelną szarością, a nie bladoszara.",
      "Zmruż oczy albo ustaw w systemie skalę szarości i przejrzyj całą stronę: nigdzie nie może zostać napisu, który znika z tła. To jest test, który zgłoszenie opisywało.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "tabela-kolory-partii-i-szkic",
    title:
      "Tabela eksploracji: kolory partii, krótszy podpis pod firmami, „szkic” przy nazwisku",
    description:
      "Cztery poprawki po przeglądzie scalonych kolumn. Żetony partii mają " +
      "kolory partii - rysuje je ten sam komponent co profile, szuflada i " +
      "statystyki, więc ta sama partia nie jest już szara w tabeli, a " +
      "kolorowa wszędzie indziej; partia, dla której serwis nie ma koloru, " +
      "dostaje szarą plakietkę zamiast gołego tekstu. Podpis pod firmami " +
      "stracił etykietę „Ostatnie zatrudnienie:” i datę dzienną: są dwie " +
      "ikony, kalendarz z miesiącem i rokiem („od marca 2021”) oraz teczka ze " +
      "stażem („11 lat pracy”), każda z opisem po najechaniu. Staż jest " +
      "zaokrąglony do pełnych lat, bo wcześniej wychodziło „12.4 lat pracy”: " +
      "z kropką zamiast przecinka i z „lat” tam, gdzie po ułamku powinno stać " +
      "„roku”. Staż krótszy niż rok pisze się jako „poniżej roku”, a nie „0 " +
      "lat pracy”, i to samo zaokrąglenie obowiązuje teraz w kolumnie „Lata " +
      "pracy” na /eksploruj/nowe, gdzie do tej pory wciąż stała liczba z " +
      "kropką. " +
      "Dymek przy przycisku wyszukiwarek pojawia się po 0,2 sekundy " +
      "zamiast po dwóch - ostrzeżenie, że kliknięcie otwiera naraz wiele " +
      "kart, nie miało dotąd szans się pokazać. Kolumna „Widoczność” " +
      "zniknęła: nieopublikowana osoba ma plakietkę „szkic” przy nazwisku, " +
      "przy opublikowanej nie ma nic, bo to ona jest regułą, a sortowanie po " +
      "statusie zostało w menu sortowania na pasku.",
    steps: [
      "Wejdź na /eksploruj/tabela: żetony partii przy nazwiskach mają mieć kolory partii - PiS granatowy z białym napisem, PO pomarańczowy - takie same jak na stronie osoby.",
      "Znajdź osobę z partią, dla której serwis nie ma koloru (np. Razem): ma mieć szarą plakietkę, a nie sam napis na białym tle.",
      "Pod firmami mają być dwa podpisy z ikonami: kalendarz z „od <miesiąc słownie> <rok>” i teczka z „N lat pracy”. W samym wierszu nie może być już napisu „Ostatnie zatrudnienie:”, daty w rodzaju 2021-03-01 ani liczby z kropką („12.4 lat pracy”) - „Ostatnie zatrudnienie” zostaje tylko jako nazwa sortowania w menu.",
      "Najedź kursorem na każdy z tych podpisów - przeglądarka ma pokazać, co dana ikona znaczy: początek ostatniego zatrudnienia i łączny staż.",
      "Najedź na przycisk wyszukiwarek obok nazwiska (ikona otwierania w nowej karcie): dymek „Otwiera wiele kart wyszukiwania jednocześnie...” ma się pokazać od razu, a nie po dwóch sekundach nieruchomego kursora.",
      "Zaloguj się i ustaw „Widoczność: Tylko szkice”: kolumny „Widoczność” nie ma, a przy każdym nazwisku stoi mała plakietka „szkic”. Po przełączeniu na „Tylko opublikowane” nie ma żadnej plakietki - i tak ma być.",
      "Zalogowany otwórz menu sortowania na pasku: ma tam nadal być „Status”. Wybierz je - tabela ma się przeładować i nie może być pusta. Wylogowany tej pozycji nie ma.",
      "Otwórz zalogowany link /eksploruj/tabela?sortBy=visibility&sortDesc=true - lista ma się załadować, mimo że nie ma już nagłówka, w który dałoby się kliknąć.",
      "Zwęź okno do 390px: oba podpisy pod firmami mają się zmieścić bez poziomego przewijania, a długa nazwa partii ma zostać ucięta wielokropkiem, zamiast rozpychać kolumnę z nazwiskiem.",
      "Zaloguj się i otwórz /eksploruj/nowe: w kolumnie „Lata pracy” ma stać sama liczba całkowita („12”), nigdzie nie może być kropki ani części dziesiętnej. Klikaj „Następna osoba” kilka razy - osoba z krótkim stażem ma mieć „poniżej roku”, a osoba bez znanego zatrudnienia pustą komórkę, nie „0”.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "tabela-pasek-zapytania",
    title: "Tabela eksploracji: jeden pasek zamiast ekranu filtrów",
    description:
      "Na /eksploruj/tabela pierwszy wiersz danych zaczynał się 697 pikseli " +
      "od góry na komputerze i 588 na telefonie - wcześniej były tam trzy " +
      "linijki tytułu, sześć zawsze otwartych list filtrów i karta z " +
      "postępem. Teraz jest jeden pasek: tytuł, przycisk „Filtry” z liczbą " +
      "aktywnych filtrów, żeton dla każdego filtru, który zawęża tabelę, " +
      "liczba osób, sortowanie i przycisk udostępniania. Zalogowany dostaje " +
      "pod nim drugą linijkę z postępem sprawdzania, swoim wkładem i " +
      "skrótami do czterech najczęściej używanych filtrów weryfikacji. " +
      "Kolumny są scalone: „Firmy” niosą datę ostatniego zatrudnienia i " +
      "staż („od marca 2021” i „11 lat pracy”), „Oceny” liczbę notatek, a " +
      "„Lata pracy” i „Notatki” przeniosły się do menu sortowania w " +
      "nagłówkach tych kolumn - obie liczby są więc nadal w wierszu, po " +
      "którym się sortuje. Kolumna „Eksploruj” " +
      "zniknęła - lupa robiła to samo co kliknięcie w nazwisko, a przycisk " +
      "wyszukiwarek stoi teraz obok nazwiska. Baner logowania, " +
      "apel o zrzutkę i lista wybranych firm są pod tabelą.",
    steps: [
      "Wejdź na /eksploruj/tabela wylogowany: nad tabelą ma być tylko jeden pasek z nagłówkiem „Powiązania osób i spółek publicznych”, a pierwsze nazwisko widoczne bez przewijania.",
      "Kliknij „Filtry”, wybierz kategorię i zamknij panel - na pasku ma przybyć żeton z nazwą kategorii, a licznik przy przycisku ma pokazać „Filtry (1)”.",
      "Kliknij x na tym żetonie: filtr znika z paska i z adresu strony, a liczba osób obok się zmienia.",
      "Ustaw kilka filtrów naraz i sprawdź, że żetony zawijają się do drugiej linijki zamiast chować się poza ekranem; potem kliknij „Wyczyść” - mają zniknąć wszystkie za jednym razem.",
      "Kliknij nagłówek kolumny „Firmy”, a potem otwórz jego menu i wybierz sortowanie po latach pracy - tabela ma się przeładować i nie może być pusta, a pod firmami mają stać dwa podpisy z ikonami: „od marca 2021” i „N lat pracy”, czyli liczba, po której właśnie posortowałeś.",
      "To samo w kolumnie „Oceny”: menu ma dawać sortowanie po sumie ocen i po liczbie notatek, a pod sumą ocen ma być podpis „N notatek”. Wiersz bez notatek ma zostać jednolinijkowy.",
      "Sprawdź przycisk sortowania na pasku: na świeżo otwartej tabeli ma pisać „Sortowanie” bez strzałki, a po wybraniu sortowania skróconą nazwę („Zatrudnienie”, „Oceny”, „Notatki”) i strzałkę kierunku.",
      "Otwórz ręcznie stary link /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - tabela ma się wypełnić danymi, a nie pokazać „Brak danych”.",
      "Kliknij przycisk udostępniania po prawej stronie paska i sprawdź, że skopiowany adres po wklejeniu w nowej karcie odtwarza ten sam zestaw filtrów.",
      "Przejdź na drugą stronę wyników i otwórz udostępnianie ponownie: ma się pojawić pole „Dołącz stronę i liczbę wierszy”. Odznaczone - link prowadzi na pierwszą stronę; zaznaczone - adres dostaje page=2. Na pierwszej stronie i przy domyślnej liczbie wierszy tego pola nie ma, bo nie miałoby czego dodać.",
      "Zaloguj się: pod paskiem ma się pojawić druga linijka z paskiem postępu i zdaniem „sprawdzono X z Y osób”, „Twój wkład” w tej samej linijce i czterema skrótami: „+ Widoczność”, „+ Bez ocenionych”, „+ Od kiedy”, „+ Min. głosy”.",
      "Kliknij „+ Bez ocenionych”: lista, która się otworzy, ma mieć pozycję o dokładnie tej samej nazwie („Bez ocenionych”), a po jej wybraniu na wierszu ma zostać żeton „bez ocenionych”. Tak samo „+ Widoczność” i jej „Tylko szkice”.",
      "Kliknij „+ Min. głosy”, ustaw 5 - ma powstać żeton „min. 5 głosów”; kliknij w jego środek, żeby zmienić wartość na 10 bez czyszczenia filtru.",
      "Zwęź okno do szerokości telefonu (390px): mają zostać dwie kolumny - „Osoba” i „Firmy” - liczba osób ma nadal być widoczna na pasku, suma ocen ma się pokazać jako podpis pod nazwiskiem, i nie może być poziomego przewijania.",
      "Nadal na telefonie: przycisk sortowania ma mieć widoczną nazwę - to jedyne miejsce, z którego można tam sortować, bo nagłówki „Oceny” i „Wybory” są schowane - a plakietki wyborów mają wrócić do komórki „Firmy”, gdzie na komputerze jest ich osobna kolumna.",
      "Przewiń na sam dół strony: baner logowania (dla wylogowanego), apel o zrzutkę i lista wybranych firm mają być pod tabelą, w tej kolejności.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "szpitale-swieze-liczby-dla-zalogowanych",
    title:
      "Rady nadzorcze szpitali: zalogowany widzi to, co dopiero opublikował",
    description:
      "Liczby na /eksploruj/szpitale są przeliczane drogo, więc odpowiedź " +
      "trzymana jest przez sześć godzin - i to w dwóch miejscach naraz, bo " +
      "kopię trzyma też CDN przed serwerem. Czyszczenie pamięci po publikacji " +
      "nigdy do tej kopii nie sięgało, więc admin, który właśnie opublikował " +
      "członka rady nadzorczej, po odświeżeniu strony i tak widział stan " +
      "sprzed swojej zmiany, bez żadnej informacji o tym. Teraz zalogowany " +
      "czytelnik pyta o świeże dane i dostaje odpowiedź, której CDN nie " +
      "zapisuje; wylogowany dalej dostaje wersję z pamięci, bo to ona jest " +
      "indeksowana. Przy okazji publikacja samej strony, bez zaznaczania " +
      "powiązań, też czyści pamięć serwera - wcześniej nie czyściła nic.",
    steps: [
      "Wejdź na /eksploruj/szpitale wylogowany i zapamiętaj liczbę miejsc w radach nadzorczych.",
      "Zaloguj się jako admin i opublikuj osobę zasiadającą w radzie nadzorczej szpitala razem z jej powiązaniem.",
      "Wróć na /eksploruj/szpitale jako zalogowany i odśwież - liczba ma już uwzględniać tę osobę, bez czekania.",
      "Otwórz tę samą stronę w oknie prywatnym (wylogowany). Tam liczba może być jeszcze stara - to jest zamierzone, wersja publiczna jest z pamięci.",
      "Sprawdź też publikację strony bez zaznaczania powiązań: po niej liczby na /eksploruj/statystyki mają się przeliczyć dla zalogowanego.",
    ],
    link: "/eksploruj/szpitale",
    area: "admin",
  },
  {
    id: "publikacja-strony-bez-powiazan-mowi-o-tym",
    title: "Nieudana publikacja powiązań mówi, że strona i tak poszła na żywo",
    description:
      "Strona i jej powiązania publikują się dwoma osobnymi zapisami, a " +
      "powiązania idą albo wszystkie, albo żadne. Jeśli któreś zostanie " +
      "odrzucone - druga strona wróciła do szkicu między otwarciem okna a " +
      "kliknięciem - strona jest już widoczna publicznie, a żadne powiązanie " +
      "nie. Wcześniej widać było samą treść błędu z serwera, więc wyglądało " +
      "to, jakby nie stało się nic; teraz okno mówi wprost, która połowa " +
      "się udała, i wskazuje kolejkę powiązań, bo na opublikowanej stronie " +
      "to okno już się nie otworzy.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/<id> nieopublikowanej osoby, która ma powiązania czekające na publikację, i kliknij przełącznik publikacji.",
      "Zaznacz powiązania i opublikuj. Normalny przypadek: znika okno, na dole komunikat „Opublikowano stronę i N powiązań”.",
      "Żeby zobaczyć nowy komunikat, doprowadź do odmowy: w drugiej karcie ukryj instytucję, do której prowadzi jedno z zaznaczonych powiązań, i dopiero wtedy kliknij „Opublikuj”.",
      "W oknie ma się pokazać czerwona ramka „Strona została opublikowana, ale powiązania nie”, pod nią powód z serwera z nazwą blokującej strony, a pod nim odnośnik do kolejki powiązań.",
      "Okno ma zostać otwarte z zaznaczeniami, a przełącznik publikacji na stronie pod spodem ma się przestawić na „opublikowana” - bo taka jest prawda w bazie.",
      "Zamknij okno i otwórz je ponownie (na innej, nieopublikowanej stronie): czerwonej ramki ma już nie być.",
    ],
    link: "/admin/krawedzie",
    area: "admin",
  },
  {
    id: "szpitale-rady-nadzorcze",
    title: "Rady nadzorcze szpitali publicznych w podziale na partie",
    description:
      "Nowa strona pokazuje, z jakich partii są ludzie zasiadający w radach " +
      "nadzorczych szpitali publicznych. Rady społeczne SPZOZ są z zestawienia " +
      "wyłączone, bo zasiadanie w nich jest nieodpłatne - ale można je " +
      "obejrzeć osobno.",
    steps: [
      "Wejdź na /eksploruj/szpitale i sprawdź kafelki „W skrócie”.",
      "Przeczytaj pasek „Czym są nadzorowane szpitale publiczne” - szpitale w podziale na organ nadzoru mają się sumować do liczby szpitali z kafelków.",
      "Znajdź ramkę o radzie społecznej i sprawdź, że tłumaczy, dlaczego te miejsca są wyłączone, i podaje podstawę prawną.",
      "Przełącz przełącznik nad wykresem z „Rady nadzorcze” na „Rady społeczne” - wykres i tabela pod nim mają się zmienić razem.",
      "Sprawdź, że liczba wyłączonych miejsc podana w ramce zgadza się z tym, co widać po przełączeniu na „Rady społeczne”.",
      "Sprawdź w tabeli, że szpital prowadzony jako spółka ma radę nadzorczą, a SPZOZ radę społeczną albo „brak organu w KRS”.",
      "Sprawdź, że odnośnik w stopce prowadzi na tę stronę.",
    ],
    link: "/eksploruj/szpitale",
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
      "Wejdź na /eksploruj/tabela - w nagłówku mają być „Osoba” i „Firmy” zamiast „Imię i nazwisko”, „Partie” i osobnej kolumny z datą (kolumna scalona nazywała się „Historia” do czasu paska zapytania).",
      "Sprawdź kolumnę „Osoba”: plakietki partii mają stać obok nazwiska albo pod nim, a nie w osobnej kolumnie.",
      "Sprawdź kolumnę „Firmy”: mają w niej być plakietki firm, a pod nimi data ostatniego zatrudnienia. Plakietki wyborów stoją na komputerze w osobnej kolumnie „Wybory”, a poniżej 960 px wracają do tej samej komórki.",
      "Najedź na plakietkę firmy i na plakietkę wyborów - dymki z pełną nazwą firmy oraz z okręgiem, województwem i komitetem mają działać jak wcześniej.",
      "Zwęź okno poniżej 960 px albo wejdź z telefonu - kolumny mają być dwie, nazwa partii ma się mieścić w całości albo być ucięta dopiero na szerokości kolumny, a tabeli nie da się przewinąć w bok.",
      "Nadal na wąskim ekranie: pod firmami mają być lata pracy, bo osobnej kolumny na nie tu nie ma - od czasu kolorów partii jako dwa podpisy z ikonami, „od marca 2021” i „N lat pracy”, a nie jeden „od <data> · N lat pracy”.",
      "Kliknij nagłówek „Firmy” - tabela ma się posortować, a w adresie ma się pojawić sortBy=latestEmploymentStart.",
      "Zalogowany wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - lista ma się załadować (nie może być pusta), a strzałka sortowania ma stać przy „Firmach”.",
      "Kliknij nazwisko - w szufladzie mają być te same partie, firmy i wybory, w pełnej postaci.",
      "Rozszerz okno powyżej 960 px - obok tych dwóch kolumn mają wrócić „Wybory”, „Oceny” i „Twój głos”. „Lata pracy” i „Notatki” są od czasu paska zapytania pozycjami w menu sortowania nagłówków „Firmy” i „Oceny”, a nie kolumnami; kolumny „Eksploruj” nie ma wcale.",
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
      "samo. (Od czasu paska zapytania /eksploruj/tabela ma własny, krótszy " +
      "zestaw kolumn - to /eksploruj/nowe zostało z tym opisanym tutaj.)",
    steps: [
      "Wejdź zalogowany na /eksploruj/nowe. Tabela nad kartą osoby ma się kończyć równo z krawędzią białej karty - nic nie ma wystawać poza nią na tło strony.",
      "Ustaw okno na około 1280 px szerokości i sprawdź prawą stronę wiersza: ikona „Eksploruj” i strzałki „Twój głos” mają być widoczne bez przewijania w bok. To są kroki 1 i 3 z paska nad tabelą, więc wcześniej nie dało się ich kliknąć na takim ekranie.",
      "Policz kolumny - mają być dokładnie: „Osoba”, „Historia”, „Lata pracy”, „Twój głos”, „Eksploruj”. Kolumn „Notatki”, „Głosy łącznie” i „Widoczność” już nie ma.",
      "Pod nazwiskiem osoby ma być drobny podpis „Suma ocen: N” - ta sama liczba, która wcześniej stała w kolumnie „Głosy łącznie”.",
      "Przełącz kolejność na „Najwyżej oceniane” i klikaj „Następna osoba”: „Suma ocen” pod nazwiskiem ma maleć albo zostawać taka sama, nigdy rosnąć. To potwierdza, że liczba pod nazwiskiem jest tą, po której sortuje się kolejka.",
      "Przewiń w dół do sekcji „Notatki”: są tam notatki tej osoby, także cudze, w całości - dlatego licznik notatek nie jest już potrzebny w tabeli.",
      "Wejdź na /eksploruj/tabela: na szerokim ekranie pod nazwiskiem nie ma „Sumy ocen”. Po pasku zapytania nie ma tam już kolumn „Notatki” ani „Głosy łącznie” - liczba ocen stoi w kolumnie „Oceny”, a na telefonie wraca jako podpis pod nazwiskiem. Kolumny „Widoczność” nie ma tam już wcale - od czasu kolorów partii zalogowany dostaje w jej miejsce plakietkę „szkic” przy nazwisku.",
      "Zwęź okno do szerokości telefonu i wróć na /eksploruj/nowe: jeśli tabela się nie mieści, ma się przewijać w poziomie wewnątrz karty, a sama strona nie ma jechać w bok.",
    ],
    link: "/eksploruj/nowe",
    area: "contributor",
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
      "Wejdź na /eksploruj/tabela?latest=true, otwórz „Filtry”, rozwiń „Więcej filtrów”, ustaw „Siedziba spółki” na ten region i sprawdź, że pracownicy tej spółki już się nie pokazują.",
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
      "Użyj filtra „Siedziba spółki” (przycisk „Filtry”, sekcja „Więcej filtrów”) dla dowolnego powiatu i sprawdź, że lista się nie zmieniła w stosunku do tego, co było wcześniej.",
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
      "Wejdź na Eksploruj → Tabela, kliknij „Filtry” i rozwiń listę „Typ podmiotu” (tak nazywa się filtr kategorii). Ma mieć dziewięć pozycji, nie trzy.",
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
      "Wyloguj się i wejdź na /eksploruj/tabela. Nad tabelą nie ma postępu weryfikacji - po pasku zapytania od razu idzie tabela. (Od czasu paska zapytania postęp jest drugą linijką tego paska, a nie osobną kartą.)",
      "To samo na wąskim ekranie: pierwszy wiersz tabeli ma być widoczny bez przewijania.",
      "Zaloguj się i odśwież. Postęp ma wrócić jako druga linijka paska zapytania, razem z „Twój wkład” i przyciskiem „Pomóż sprawdzać” - na każdej szerokości, także na telefonie.",
      "Wejdź na /eksploruj/nowe (tylko dla zalogowanych). Tam pasek zostaje pełną kartą z legendą, jak wcześniej.",
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
      "Na /eksploruj/tabela zawężonej do firmy nazwa w karcie z jej danymi jest " +
      "teraz linkiem na stronę tej spółki. Gdy wybranych firm jest kilka i " +
      "karty się zwijają, ten sam link mają chipy z nazwami. Wcześniej z " +
      "tabeli nie dało się przejść na stronę spółki - trzeba było znaleźć ją " +
      "wyszukiwarką.",
    steps: [
      "Wejdź na /eksploruj/tabela?place=ZBcdQ9tUxVyv0o1mnpLH i przewiń pod tabelę - ma tam być karta z nazwą spółki (od czasu paska zapytania karta stoi pod tabelą, a nie nad nią).",
      "Kliknij nazwę w karcie: ma otworzyć /instytucja/… tej spółki.",
      "Wróć i wybierz trzy firmy albo więcej („Filtry” → „Więcej filtrów” → „Instytucje”) - karty mają się zwinąć do chipów z nazwami. Kliknięcie chipa ma prowadzić na stronę tej spółki.",
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
