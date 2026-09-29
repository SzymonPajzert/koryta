/** Reports a change answers without an entry on the QA list of its own: a fix
 * that does what the report asked and no more, so the report already says what
 * to check and where.
 *
 * Like `QaItem.fixes`, the claim is code, made in the commit that makes the
 * change, so it reaches a page exactly when the change does - a branch's claims
 * show on that branch's /qa, and on koryta.pl once it is rolled out. Nobody but
 * an admin checks these: /qa lists the open ones to an admin under "Zgłoszenia
 * do zamknięcia", with what changed and where to look, and the admin closes a
 * report once it works. A change others should try for themselves still gets a
 * QA entry, with its `fixes`. `shared/feedbackFixes.ts` joins both kinds of
 * claim to the reports.
 */

export type ReportFix = {
  /** What changed, in a sentence, in the language of the site: what the admin
   * checking it should now see. */
  change: string;
  /** The reports it answers, as `feedback` document ids - the part after
   * `#fb-`, as in `QaItem.fixes`. */
  fixes: string[];
  /** Where to look, when it is not the page the report was written on - a
   * report sent from /qa, say. */
  link?: string;
};

/** Newest first: prepend, in the commit that makes the change. An entry stays
 * after its reports are closed - a closed report on /admin/opinie still shows
 * what fixed it. */
export const REPORT_FIXES: ReportFix[] = [
  {
    change:
      "Na szerokim ekranie linijka propozycji w „Czeka na decyzję” zaczyna się od tego, kto ją zgłosił i kiedy, a dopiero po nich mówi, czego dotyczy - tak jak pierwsza kolumna „Zgłoszenie” w dawnej tabeli.",
    fixes: ["YsFCMqAsj9YIEQM2CKAr"],
    link: "/admin/rewizje#kolejka",
  },
  {
    change:
      "Artykuł dodany z linku do strony w starym kodowaniu (ISO-8859-2, windows-1250) ma w tytule polskie litery zamiast „�”. Trzy zapisane już tytuły na stronie Dariusza Bielskiego poprawią się dopiero po wdrożeniu funkcji getPageMeta i uruchomieniu migracji refetch-garbled-article-titles - niezalogowani zobaczą je do 6 godzin później, chyba że pamięć podręczna zostanie wyczyszczona.",
    fixes: ["3qIISyfU0iXo0Sus5bgJ"],
    link: "/osoba/dariusz-bielski-WQgJ49xVVGnKQnlCoDCK",
  },
  {
    change:
      "Na grafie osoba bez partii jest szara, a nie niebieska, więc nie myli się już z granatem PiS i Konfederacji. Legenda podpisuje ją „Osoba: brak partii”; jaśniejsza szarość to nadal „Inne”.",
    fixes: ["wg0ZscDcClubfyTEn5pB"],
  },
  {
    change:
      "Na pasku nad grafem przycisk „Opisy na liniach” ma zawsze ten sam napis, a pole wyboru przy napisie pokazuje, czy opisy są włączone. Kliknięcie nie zmienia już jego szerokości, więc przyciski nie przeskakują między rzędami, a na telefonie „2 kroki” mieści się w pasku zamiast być uciętym.",
    fixes: ["60beJLEWtp6lNuWyz15L"],
  },
  {
    change:
      "Regulamin i polityka prywatności stoją w białym arkuszu z ramką na szarym tle, jak /o-nas i /pomoc, a adres e-mail i link do polityki są ciemnozielone zamiast bladozielonych.",
    fixes: ["3MWd21zn85kJO5T13eNP"],
  },
  {
    change:
      "„Co nowego” na stronie głównej zaczyna się od ośmiu rzędów kafelków - 16 na komputerze i 8 na telefonie, zamiast całej porcji naraz (29 września było ich 37) - więc do stopki jest ponad dwa razy bliżej, a na telefonie cztery razy. „Pokaż więcej” dokłada po osiem rzędów.",
    fixes: [
      "DodgLGSXSPlZjVnyeteO",
      "3PCLXqLV0Kk177sHP6i9",
      "aWb3jMKRKD3sK7VDVwwe",
    ],
  },
  {
    change:
      "Kolejka najłatwiejszego poziomu, posortowana po głosach, zaczyna się od osoby do sprawdzenia: strony scalone z inną (jak Geblewicz czy Pasoń) nie zajmują już w kolejkach miejsc, na których nic się nie pokazywało - od najbliższego przeliczenia statystyk (/api/stats/computeNodes).",
    fixes: ["crR0DWk9Y1gTfy0vp2Mg"],
    link: "/eksploruj/nowe?tier=1&order=votes",
  },
  {
    change:
      "W „Kto kogo zastąpił” chip „zmiana afiliacji” nazywa się teraz „inna partia”, a najechany albo stuknięty mówi, z której partii do której przeszło stanowisko, np. „PiS → PO”.",
    fixes: ["w2IOzxln1HiguDBFzIpG"],
  },
  {
    change:
      "Odpowiedź na „Co liczą Wasze modele?” w FAQ na /pomoc wymienia wszystkie modele oceny i co każdy z nich nagradza.",
    fixes: ["cEF1Mg7xRtR2iWuyyC70"],
    link: "/pomoc",
  },
  {
    change:
      "W „Notatki wymagające działania” na /admin każdy wiersz otwiera swoją notatkę w kolejce notatek.",
    fixes: ["OaW6NI6Acm7wpXWtcTCD"],
  },
  {
    change:
      "„Czeka na decyzję” na /admin/rewizje ma przełącznik „Wszystkie · Bez moich”, który chowa Twoje propozycje - działa dopiero po wdrożeniu czterech nowych indeksów z firestore.indexes.json.",
    fixes: ["xAOt17Oj1PJB6t34O9if"],
  },
  {
    change:
      "W „Obecnym składzie” Przedsiębiorstwa Zagospodarowania Odpadów w Gliwicach osoba ze zgłoszenia jest raz, pod „Prokurent”, a nie drugi raz pod „Funkcja niepodana w rejestrze”. Wpis bez funkcji znika też z historii powiązań instytucji i osoby, gdy ta sama osoba ma w tym samym czasie wpis z funkcją; osobny, wcześniejszy okres bez funkcji zostaje.",
    fixes: ["NBIpuzJnWjqUuExe9rHR"],
    link: "/instytucja/przedsiebiorstwo-zagospodarowania-odpadow-gliwice-7KybWxBJfAIMWwq3md3g",
  },
  {
    change:
      "Na „Problemach” w /qa wpis, który wciąż oceniasz jako „Coś nie działa”, choć jego zgłoszenie zostało już zamknięte, stoi pod nagłówkiem „Twoje problemy bez otwartego zgłoszenia”, a (i) przy nagłówku mówi, że zgłoszenie zamknięto: jeśli już działa, zmień ocenę, a jeśli nie - opisz, co wciąż jest nie tak, a opis trafi do zespołu jako nowe zgłoszenie.",
    fixes: ["2cPCvvILR0TpRna7Y0Ie"],
    link: "/qa?widok=problemy",
  },
  {
    change:
      "W kategoryzacji notatek pod listą typów widać osobę, której dotyczy notatka - jej partie, dane i historię powiązań, a przy notatce o instytucji jej powiązania - i sekcja zmienia się razem z kolejną notatką, więc na telefonie nie trzeba przełączać się do tabeli.",
    fixes: ["g29Mn5m5y6EKQegAviQn"],
  },
  {
    change:
      "Aktywność domyślnie nie pokazuje Twoich własnych zmian: przy filtrach jest zaznaczone „Ukryj moje zmiany”, a po odznaczeniu Twoje linijki wracają z oznaczeniem „Ty”.",
    fixes: ["DdO2vUMtncE6f1lfRtvH"],
  },
  {
    change:
      "„Właściciele” PKP SKM wymieniają każdego właściciela raz, także po załadowaniu strony - Gmina Gdańsk, POLSKIE KOLEJE PAŃSTWOWE (Warszawa), Województwo pomorskie i Gdynia, a gmina, która jest i siedzibą, i właścicielem spółki, ma jeden wiersz.",
    fixes: ["SLaYgF7oCq9VV1fpU08t"],
  },
  {
    change:
      "W kategoryzacji notatek nazwa osoby nad notatką jest prawdziwym linkiem: kliknięta, także z ctrl albo środkowym przyciskiem, otwiera stronę tej osoby w nowej karcie.",
    fixes: ["g29Mn5m5y6EKQegAviQn"],
  },
  {
    change:
      "„Obecny skład” spółki wymienia najpierw prezesa, potem jego zastępców, zarząd i radę nadzorczą, a dopiero dalej resztę.",
    fixes: ["uIj31XYdsMVFjnqHArzX"],
  },
  {
    change:
      "Menu „Eksploruj” na stronie osoby szuka jej też w miastach jej pracodawców, więc Rafała Dyjura także w Jeleniej Górze.",
    fixes: ["1PNZiixNoTWmoIm28Aq2"],
  },
  {
    change:
      "Na stronie osoby na szerokim ekranie notatki stoją w dwóch kolumnach, a w panelu bocznym tabeli nadal w jednej.",
    fixes: ["0B2U7Uvnv84fGNwd8cG3"],
  },
  {
    change:
      "Chipy partii, które nie mieszczą się obok imienia w nagłówku osoby, przechodzą w całości do następnej linii zamiast się ucinać.",
    fixes: ["b4frZNziUAygE6pbFPCm", "Azu0VckVrSGG7Hyi1kuY"],
  },
  {
    change:
      "„Sprawdź pierwszą osobę” na stronie głównej otwiera kolejkę najłatwiejszego poziomu (tier=1) - dopiero gdy poziomy są policzone, czyli po wdrożeniu ich indeksów.",
    fixes: ["crR0DWk9Y1gTfy0vp2Mg"],
    link: "/",
  },
  {
    change:
      "/pomoc zaczyna się od „Możesz sprawdzać osoby” z trzema poziomami trudności, a karta poziomu mówi, ile osób zostało do sprawdzenia - licznik działa dopiero po wdrożeniu nowego indeksu z firestore.indexes.json.",
    fixes: ["8fpBoHyw4dET45YMerEH"],
    link: "/pomoc",
  },
  {
    change:
      "Nowy komentarz widać od razu po dodaniu, a pod „Dyskusja” jedno zdanie mówi, do czego służą komentarze, a co wpisać do notatki.",
    fixes: ["ETKk2tRaOZef2UhAb2NV"],
  },
  {
    change:
      "Wszystkie fakty osoby są dostępne na stronach - po 24 na komputerze i po 6 na telefonie - z przełącznikiem stron pod kartami.",
    fixes: ["Rcw5yR84JN2HCFlS5Jcx", "YpElsRKBCFJ188IrOnXu"],
  },
  {
    change:
      "Nad „Fakty z artykułów” zostało jedno zdanie, a reszta objaśnienia jest pod ikonką (i) przy nagłówku.",
    fixes: ["Ezv02GiJCB8H0LysCf0O"],
  },
  {
    change:
      "Karta faktu na stronie osoby ma pod cytatem link „Artykuł w bazie”, który prowadzi na stronę artykułu w serwisie.",
    fixes: ["s6LJDRorb8Cq9woLl0JM"],
    link: "/osoba/rafal-trzaskowski-8rg6MrDfdiRR7YaAvE5O",
  },
  {
    change:
      "W /eksploruj/tabela na szerokim ekranie nazwiska, firmy i wybory wypełniają całe kolumny, a chipy firm nie urywają się w połowie.",
    fixes: ["ybyB2AgoZH4qLzRsSv2w"],
    link: "/eksploruj/tabela",
  },
  {
    change:
      "Na wykresie „Rozkład ocen” zielony pasek opublikowanych nie ginie już w odstępie, a kolumny są szersze - dwóch najmniejszych liczb nadal nie widać.",
    fixes: ["hXMJb2JF9oLrwYCBR65D"],
  },
  {
    change:
      "Na telefonie wykres „Co się działo w bazie” podpisuje mniej dat - co tydzień albo rzadziej - więc się nie zlewają.",
    fixes: ["Bu83FlO639xnLO0ddmkc"],
  },
  {
    change:
      "Na telefonie pływający przycisk zgłoszeń ma ikonę i napis „Zgłoś” zamiast pustej kropki.",
    fixes: ["3WbbJZv1qumO87LDCMQb"],
  },
  {
    change:
      "„Artykuł stanowi źródło dla” pokazuje każdą relację w jednej linijce, z chipami zamiast niebieskich linków, a artykuł, który potwierdza relację, jest w „Artykuły, które o tym wspominają” na stronach obu jej końców.",
    fixes: ["wEGUmip1NzOZtA3dPaM5"],
  },
  {
    change:
      "Ołówek przy kandydaturze otwiera okno z polem „Uzyskano mandat”, więc wygraną można oznaczyć bez starego formularza.",
    fixes: ["ZASMgbwZm0hewxZ8wLBL"],
    link: "/osoba/kamil-sebastian-barczyk-qFxOI9faG9y0TuYuJAMc",
  },
];
