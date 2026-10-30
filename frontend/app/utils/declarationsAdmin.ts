import { PEOPLE_IMPORT_WINDOW, readingKind } from "~~/shared/declarations";
import type {
  DeclarationOverview,
  DrainResult,
  ExtractStatus,
  PublicationHoldReason,
} from "~~/shared/declarations";
import { shortDate, warsawDate } from "~~/shared/dates";
import { nominativeNoun, polishNumber } from "~/composables/polish";
import type { RowTone } from "~/composables/rowTone";

/**
 * The words /admin/oswiadczenia puts on the job's codes, and the little
 * arithmetic its blocks share.
 *
 * The codes are the crawler's and the cutter's own (`jobs/bip_crawler`), so a
 * new one can arrive before anybody has named it here: it is shown as the code
 * rather than dropped, since a reason nobody can read is still a count somebody
 * has to look into.
 */

/** Why a candidacy has no declaration, or a declaration no crop. */
const REASON_LABELS: Record<string, string> = {
  no_seed: "brak adresu BIP urzędu",
  unreachable: "BIP nie odpowiada",
  robots: "robots.txt nie pozwala",
  no_declarations: "nie znaleziono działu z oświadczeniami",
  not_listed: "brak tej osoby na liście",
  download_failed: "plik się nie pobrał",
  timeout: "przerwane, koniec czasu",
  error: "błąd wyszukiwania",
  blank_form: "pusty formularz do pobrania",
  scan_in_word: "skan zapisany jako Word",
  no_label: "nie znaleziono pola daty",
  blank_field: "puste pole daty",
  no_date_line: "brak linii z datą",
  not_fetched: "nie pobrano",
  unreadable: "plik nieczytelny",
};

export function declarationReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export const declarationHoldLabels: Record<PublicationHoldReason, string> = {
  two_pages: "dwie strony tej osoby",
  needs_split: "strona do rozdzielenia",
  kept_hidden: "administrator zostawił stronę ukrytą",
  pending_proposal: "czeka propozycja zmiany od osoby",
  name_differs: "odczytane nazwisko się nie zgadza",
  no_candidacy_on_page: "na stronie brak tej kandydatury",
  ambiguous_candidacy: "dwie pasujące kandydatury w powiecie",
  two_places: "kandydatura w dwóch miejscach naraz",
  no_revision: "strona nie pokazuje wersji z importu",
  no_longer_matches: "data na stronie się zmieniła",
  candidacy_reviewed: "kandydaturę ktoś już rozpatrzył",
  revision_rejected: "ktoś odrzucił wersję tej strony",
  conflicting_reading: "inne oświadczenie podaje inną datę",
};

/** What an admin can do about a hold, for the open row. */
export const declarationHoldNotes: Record<PublicationHoldReason, string> = {
  two_pages:
    "Ta osoba ma w serwisie dwie strony. Połącz je albo opublikuj właściwą ręcznie.",
  needs_split:
    "Strona jest oznaczona do rozdzielenia. Najpierw ją rozdziel, potem publikuj.",
  kept_hidden:
    "Ktoś z administratorów zostawił tę stronę ukrytą. Automat tej decyzji nie zmienia.",
  pending_proposal:
    "Na stronie czeka propozycja zmiany. Rozpatrz ją, zanim strona wyjdzie.",
  name_differs:
    "Czytelnicy odczytali z oświadczenia inne imię albo nazwisko niż na stronie.",
  no_candidacy_on_page:
    "Strona nie ma kandydatury, dla której znaleziono oświadczenie.",
  ambiguous_candidacy:
    "W powiecie z oświadczenia pasują dwie kandydatury tej osoby. Nie wiadomo, którą opublikować.",
  two_places:
    "Ta sama kandydatura wypada w dwóch miejscach naraz. Sprawdź, czy to na pewno jedna osoba.",
  no_revision:
    "Strona nie pokazuje ostatniej wersji z importu albo nie ma żadnej. Automat publikuje tylko to, co sprawdził.",
  no_longer_matches:
    "Od odczytu zmieniła się data urodzenia na stronie albo sam odczyt. Porównaj je jeszcze raz.",
  candidacy_reviewed:
    "Ktoś już rozpatrzył tę kandydaturę: odrzucił ją albo czeka jego własna wersja. Automat jej nie publikuje.",
  revision_rejected:
    "Ktoś z recenzentów odrzucił wersję tej strony. Automat tej decyzji nie zmienia.",
  conflicting_reading:
    "Inny odczytany wycinek tej osoby podaje inną datę. Sprawdź oba oświadczenia.",
};

/** Blue for a hold that is somebody's decision, which the automation only
 * respects; amber for a doubt somebody has to clear up. */
export function declarationHoldTone(
  reason: PublicationHoldReason | null,
): RowTone {
  return reason === "kept_hidden" ||
    reason === "pending_proposal" ||
    reason === "revision_rejected" ||
    reason === "candidacy_reviewed"
    ? "info"
    : "warning";
}

export const declarationStatusLabels: Record<ExtractStatus, string> = {
  open: "czeka na czytelników",
  agreed: "odczytane zgodnie",
  unreadable: "nieczytelne",
  disputed: "sporne",
  failed: "bez wycinka",
  withdrawn: "wycofane",
};

/** The machine's confidence, as a reader says it. */
export function declarationConfidenceLabel(
  confidence: string | null,
): string | null {
  if (confidence === "high") return "wysoka pewność";
  if (confidence === "medium") return "średnia pewność";
  if (confidence === "low") return "niska pewność";
  return null;
}

/** A reading or a page's date as the page prints it: `15.07.1979`, or a year
 * alone where the form gave no more. */
export function declarationDateText(value: string | null | undefined): string {
  if (!value) return "brak";
  return readingKind(value) === "date" ? shortDate(value) : value;
}

/** How a settled reading differs from the date a page stores.
 *
 * Kept apart because they call for different things: one digit off is
 * usually a crop read wrong (a 9 taken for a 6), a day and a month swapped is
 * a slip on either side, while a different year is more often somebody
 * else's declaration filed under this person - which is withdrawn, not
 * corrected. */
export type DeclarationDateDifference =
  "same" | "digit" | "swap" | "day" | "year";

export const declarationDifferenceLabels: Record<
  DeclarationDateDifference,
  string
> = {
  same: "ta sama data",
  digit: "jedna cyfra",
  swap: "dzień ⇄ miesiąc",
  day: "inny dzień",
  year: "inny rok",
};

export function declarationDifferenceTone(
  kind: DeclarationDateDifference,
): RowTone {
  if (kind === "year") return "danger";
  if (kind === "same") return "success";
  return "warning";
}

/** One character of a date as printed, and whether it differs from the other
 * date's character in the same place. */
export type DeclarationDateChar = { char: string; differs: boolean };

/** The two dates as printed, character by character, and the kind of their
 * difference. A reading of a year alone is compared with the page's year
 * only, and the page's day and month are printed but never marked. */
export function compareDeclarationDates(
  reading: string,
  stored: string | null,
): {
  reading: DeclarationDateChar[];
  stored: DeclarationDateChar[];
  kind: DeclarationDateDifference;
} | null {
  if (!stored) return null;
  const readingIsYear = readingKind(reading) === "year";
  const readText = declarationDateText(reading);
  const storedText = declarationDateText(stored);
  // Both texts end in the year, so a year alone lines up with the last four
  // characters of a whole date.
  const offset = readingIsYear ? storedText.length - readText.length : 0;
  const readChars = [...readText].map((char, i) => ({
    char,
    differs: char !== storedText[i + offset],
  }));
  const storedChars = [...storedText].map((char, i) => ({
    char,
    differs: i >= offset && char !== readText[i - offset],
  }));

  const differing = readChars.filter((c) => c.differs).length;
  let kind: DeclarationDateDifference;
  if (differing === 0) kind = "same";
  else if (differing === 1) kind = "digit";
  else if (reading.slice(0, 4) !== stored.slice(0, 4)) kind = "year";
  else if (
    !readingIsYear &&
    reading.slice(5, 7) === stored.slice(8, 10) &&
    reading.slice(8, 10) === stored.slice(5, 7)
  ) {
    kind = "swap";
  } else kind = "day";
  return { reading: readChars, stored: storedChars, kind };
}

/** The stages from a candidacy searched to a person published, as the chain
 * counts them. Each stage counts in its own unit - candidacies, declarations,
 * crops, pages, people - since a re-elected councillor's two runs share one
 * declaration and one crop can serve two pages. */
export function declarationStages(overview: DeclarationOverview) {
  const { candidacies, extracts, pages, publications } = overview;
  // Counted by separate aggregations, a moment apart: an upload landing in
  // between can make the parts outrun the whole, and a stage never shows
  // less than nothing.
  const crops = Math.max(
    0,
    extracts.total - extracts.byStatus.failed - extracts.byStatus.withdrawn,
  );
  return {
    candidacies: candidacies.total,
    found: candidacies.byStatus.found,
    declarations: extracts.total,
    crops,
    agreed: extracts.byStatus.agreed,
    compared: pages.same + pages.different + pages.noDate + pages.confirmed,
    same: pages.same,
    decided: publications.published + publications.queued + publications.held,
    published: publications.published,
  };
}

/** Days the queue takes to clear at the daily limit, or null when nothing
 * publishes on its own. */
export function declarationQueueDays(
  queued: number,
  dailyLimit: number,
): number | null {
  if (dailyLimit <= 0) return null;
  return Math.ceil(queued / dailyLimit);
}

/** People in the accusative a count takes after "opublikować" or
 * "wstrzymać": jedną osobę, 2 osoby, 5 osób, 22 osoby. */
export function declarationPeopleAccusative(count: number): string {
  return count === 1
    ? "jedną osobę"
    : `${polishNumber(count)} ${nominativeNoun(count, "osobę", "osoby", "osób")}`;
}

/** What a press of „Opublikuj z kolejki” did, from the server's own account of
 * the pass: who went up and who was held, why nobody did, and how many still
 * wait, for the next press. A press goes past the daily limit, but not past
 * the people import's night window or a running import (`DrainResult`), so
 * "nobody" is an answer it can give. */
export function declarationDrainText(result: DrainResult): string {
  const published = result.published.length;
  const { from, to } = PEOPLE_IMPORT_WINDOW;
  const why =
    result.skipped === "night"
      ? `od ${from}:00 do ${to}:00 trwa nocny import osób, który mógłby cofnąć publikację`
      : result.skipped === "import"
        ? "trwa import osób albo nie da się sprawdzić, czy trwa"
        : null;
  const lines = [
    published > 0
      ? `Opublikowano z kolejki ${declarationPeopleAccusative(published)}.`
      : why
        ? `Nikogo nie opublikowano: ${why}.`
        : "Nikogo nie opublikowano.",
  ];
  if (result.held.length > 0) {
    lines.push(
      `Wstrzymano ${declarationPeopleAccusative(result.held.length)}; powody są na liście „Wstrzymane publikacje”.`,
    );
  }
  if (result.failed.length > 0) {
    lines.push(
      "Części publikacji nie udało się dokończyć: poczekają na kolejną próbę.",
    );
  }
  if (result.waiting !== null) {
    lines.push(declarationWaitingText(result.waiting));
  }
  return lines.join(" ");
}

/** „W kolejce czekają jeszcze 2 osoby.” What a press left in the queue; the
 * verb agrees with the count the way the noun does. */
function declarationWaitingText(waiting: number): string {
  if (waiting <= 0) return "W kolejce nikt już nie czeka.";
  const verb = nominativeNoun(waiting, "czeka", "czekają", "czeka");
  const people =
    waiting === 1
      ? "jedna osoba"
      : `${polishNumber(waiting)} ${nominativeNoun(waiting, "osoba", "osoby", "osób")}`;
  return `W kolejce ${verb} jeszcze ${people}.`;
}

/** One run of the job, or one day of a tag's uploads where the job sent no
 * run id. Uploads come in requests of at most 25 crops, so a run is dozens of
 * rows of `runs`; the block shows it once, with its crops summed. */
export type DeclarationRunGroup = {
  key: string;
  tag: string;
  runId: string | null;
  uploads: number;
  extracts: number;
  first: string;
  last: string;
};

export function groupDeclarationRuns(
  runs: DeclarationOverview["runs"],
): DeclarationRunGroup[] {
  const groups = new Map<string, DeclarationRunGroup>();
  for (const run of runs) {
    const key = `${run.tag}|${run.runId ?? warsawDate(new Date(run.at))}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        tag: run.tag,
        runId: run.runId,
        uploads: 1,
        extracts: run.extracts,
        first: run.at,
        last: run.at,
      });
      continue;
    }
    group.uploads += 1;
    group.extracts += run.extracts;
    if (run.at < group.first) group.first = run.at;
    if (run.at > group.last) group.last = run.at;
  }
  return [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));
}
