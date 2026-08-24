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
