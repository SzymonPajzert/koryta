import { longDate } from "~~/shared/dates";
import {
  parseTypedDate,
  type AnswerVerdict,
  type DeclarationTask,
} from "~~/shared/declarations";

/**
 * What a reader typed into a date field on /oswiadczenia, said back in words.
 *
 * The page reads the crop's handwriting through the reader's fingers, so the
 * one check it can offer is to repeat what it understood: „15 lipca 1979”
 * under „15.07.1979” is how a slip of one digit gets seen before it is sent.
 * `parseTypedDate` decides what a reading is; this only words its answer.
 */
export type TypedReading =
  | { state: "empty" }
  | { state: "ok"; kind: "date" | "year"; value: string; words: string }
  | {
      state: "problem";
      words: string;
      /** Whether the text looks finished, so the problem is worth saying
       * before the reader asks to save. „15.0” is a date on its way, and a
       * hint that changed with every key would be noise. */
      settled: boolean;
    };

/** How a valid reading is shown. A year alone says so, because the form often
 * gives only the year and the reader should see that is all they sent. */
export function readingWords(kind: "date" | "year", value: string): string {
  return kind === "year" ? `tylko rok: ${value}` : longDate(value);
}

export function readTyped(
  text: string,
  today: Date = new Date(),
): TypedReading {
  const parsed = parseTypedDate(text, today);
  if (parsed.kind !== "invalid") {
    return {
      state: "ok",
      kind: parsed.kind,
      value: parsed.value,
      words: readingWords(parsed.kind, parsed.value),
    };
  }
  if (parsed.reason === "empty") return { state: "empty" };

  const raw = text.trim().toLowerCase();
  const tokens = raw.split(/[\s./-]+/).filter(Boolean);
  const year = tokens.find((token) => /^\d{4}$/.test(token));
  // „15.07.19” is „15.07.1979” two keys early, not a two-digit year.
  const settled = !!year || raw.replace(/\D/g, "").length >= 8;

  if (parsed.reason === "range") {
    // „1507” is the year 1507 to the parser, and the first half of
    // „15071979” to the reader typing it.
    const halfTyped =
      /^\d{4}$/.test(raw) &&
      Number(raw.slice(0, 2)) >= 1 &&
      Number(raw.slice(0, 2)) <= 31 &&
      Number(raw.slice(2)) >= 1 &&
      Number(raw.slice(2)) <= 12;
    let words = "To data z przyszłości - sprawdź jeszcze raz.";
    if (halfTyped && Number(raw) < 1900) {
      words = "Wpisz cały rok albo pełną datę, np. 15071979.";
    } else if (year && Number(year) < 1900) {
      words = "Rok przed 1900 - sprawdź jeszcze raz.";
    }
    return { state: "problem", settled: !halfTyped, words };
  }
  return { state: "problem", settled, words: formatProblem(raw, tokens) };
}

/** Why a text is not a date, in the reader's terms. The month is checked by
 * asking `parseTypedDate` about the 1st of it in 2000, so the words it knows
 * („lipca”, „VII”, „7”) are not listed a second time here. */
function formatProblem(raw: string, tokens: string[]): string {
  if (/^\d+$/.test(raw)) {
    if (raw.length === 8) {
      return Number(raw.slice(2, 4)) > 12
        ? "Nie ma takiego miesiąca."
        : "Taki dzień nie istnieje.";
    }
    if (raw.length > 8) return "Za dużo cyfr na jedną datę.";
    if (raw.length === 6) return "Wpisz rok czterema cyframi, np. 15071979.";
    return raw.length < 4
      ? "Wpisz cały rok albo pełną datę."
      : "Za mało cyfr na pełną datę, np. 15071979.";
  }
  if (tokens.length === 2) {
    // „07.1979” and „lipiec 1979” have their year: what they lack is the
    // day, and the year alone would be a reading too.
    const year = tokens.findIndex((token) => /^\d{4}$/.test(token));
    if (year < 0) return "Brakuje roku.";
    if (parseTypedDate(`1 ${tokens[1 - year]} 2000`).kind === "date") {
      return "Brakuje dnia. Wpisz pełną datę albo sam rok.";
    }
  }
  if (tokens.length === 3) {
    // 1979-07-15 reads year first, the way `parseTypedDate` takes it too.
    const yearFirst = /^\d{4}$/.test(tokens[0]!);
    const [day, month, year] = (
      yearFirst ? [tokens[2], tokens[1], tokens[0]] : tokens
    ) as [string, string, string];
    if (/^\d{1,3}$/.test(year)) return "Wpisz cały rok, cztery cyfry.";
    if (/^\d{4}$/.test(year)) {
      if (/^\d{1,2}$/.test(month) && Number(month) > 12) {
        return "Nie ma takiego miesiąca.";
      }
      if (parseTypedDate(`1 ${month} 2000`).kind !== "date") {
        return "Nie rozpoznaję miesiąca.";
      }
      if (/^\d{1,2}$/.test(day)) return "Taki dzień nie istnieje.";
    }
  }
  return "To nie wygląda na datę - wpisz ją jako dd.mm.rrrr.";
}

/** A stored reading as the reader would type it back, for a field refilled
 * after a save that failed: „1979-07-15” becomes „15.07.1979”. */
export function typedFromValue(value: string | null | undefined): string {
  if (!value) return "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return day ? `${day[3]}.${day[2]}.${day[1]}` : value;
}

/** The answer just sent, for the line under the next crop. */
export function answerWords(
  verdict: AnswerVerdict,
  value: string | null | undefined,
): string {
  switch (verdict) {
    case "date": {
      if (!value) return "data";
      return readingWords(/^\d{4}$/.test(value) ? "year" : "date", value);
    }
    case "unreadable":
      return "nie da się odczytać";
    case "empty":
      return "pole jest puste";
    case "skip":
      return "pominięte";
  }
}

/** „Rada gminy · Strzelin (gmina miejsko-wiejska) · oświadczenie za 2019”:
 * all a reader is told about whose declaration it is - the unit and the
 * office it was filed for, never the person (see `DeclarationTask`). */
export function taskContext(task: DeclarationTask): string {
  return [
    task.office,
    task.unit,
    task.declarationYear ? `oświadczenie za ${task.declarationYear}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A piece of a line of copy: a hyphenated word, kept whole, or the text
 * between two such words. */
export type LinePart = { text: string; whole: boolean };

/**
 * A line of copy in pieces, so that each hyphenated word („e-mail”) can be
 * drawn on one line (`text-no-wrap`). Polish breaks a line at a hyphen only
 * by repeating the hyphen on the next line, which no browser does: a line
 * ending in „e-” over one starting with „mail” reads as a typo. A hyphen
 * with a space beside it, the dash of „wystarczy - dziękujemy”, is no part
 * of a word and may end a line.
 */
export function lineParts(text: string): LinePart[] {
  const parts: LinePart[] = [];
  let from = 0;
  for (const word of text.matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu)) {
    if (word.index > from) {
      parts.push({ text: text.slice(from, word.index), whole: false });
    }
    parts.push({ text: word[0], whole: true });
    from = word.index + word[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), whole: false });
  return parts;
}

/** The host a document link names, for the reader to see where it leads
 * before they click. The server sends it; this covers an answer without. */
export function documentHost(url: string, host: string | null): string | null {
  if (host) return host;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
