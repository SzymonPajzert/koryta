import { longDate } from "~~/shared/dates";
import { parseTypedDate, type AnswerVerdict } from "~~/shared/declarations";

/**
 * What a reader typed into the date field on /oswiadczenia, said back in
 * words.
 *
 * The page reads the crop's handwriting through the reader's fingers, so the
 * one check it can offer is to repeat what it understood: „15 lipca 1979”
 * under „15.07.1979” is how a slip of one digit gets seen before it is sent.
 * The field takes the eight digits of dd.mm.rrrr and puts the dots in itself
 * (`dotTyped`), so the digits are all there is to read; `parseTypedDate`
 * decides whether they make a day.
 */
export type TypedReading =
  | { state: "empty" }
  | { state: "ok"; value: string; words: string }
  | {
      state: "problem";
      words: string;
      /** Whether all eight digits are typed. Then what is wrong is said at
       * once: a day that does not exist, say. Short of them the text is a
       * date on its way („15.0”), and what is missing is said once the
       * reader stops typing or asks to save it: a hint that changed with
       * every key would be noise. */
      whole: boolean;
    };

/** How a reading is shown. A year alone, which the server still takes, is
 * said to be only a year. */
export function readingWords(kind: "date" | "year", value: string): string {
  return kind === "year" ? `tylko rok: ${value}` : longDate(value);
}

/** The digits of a date, dd.mm.rrrr without its dots. Part of a date is of
 * no use, so a reading is all eight of them. */
const DATE_DIGITS = 8;

export function readTyped(
  text: string,
  today: Date = new Date(),
): TypedReading {
  const digits = text.replace(/\D/g, "");
  if (!digits) return { state: "empty" };
  if (digits.length < DATE_DIGITS) {
    return { state: "problem", whole: false, words: "Wpisz wszystkie 8 cyfr." };
  }
  const parsed = parseTypedDate(digits, today);
  if (parsed.kind === "date") {
    return { state: "ok", value: parsed.value, words: longDate(parsed.value) };
  }
  const outOfRange = parsed.kind === "invalid" && parsed.reason === "range";
  return {
    state: "problem",
    whole: true,
    words: dayProblem(digits, outOfRange),
  };
}

/** Why the digits typed are not a day, in the reader's terms. `outOfRange`
 * is `parseTypedDate`'s word that the year is before 1900, or the day after
 * today. */
function dayProblem(digits: string, outOfRange: boolean): string {
  if (digits.length > DATE_DIGITS) return "Za dużo cyfr na jedną datę.";
  if (outOfRange) {
    return Number(digits.slice(4)) < 1900
      ? "Rok przed 1900 - sprawdź jeszcze raz."
      : "To data z przyszłości - sprawdź jeszcze raz.";
  }
  const month = Number(digits.slice(2, 4));
  return month >= 1 && month <= 12
    ? "Taki dzień nie istnieje."
    : "Nie ma takiego miesiąca.";
}

/** What a reader may type between the parts of a date. */
const SEPARATOR = /^[\s.,/-]$/;

/** What a key did to the date field, as its input event says: the text an
 * `insertText` typed, or a deletion, with the field's text before it. */
export type DateKey = {
  inserted?: string | null;
  deleted?: { forward: boolean; before: string };
};

/**
 * The date field after a key, and where its caret goes: the digits of
 * dd.mm.rrrr with the dots put in, so a reader types „15071979” and reads
 * „15.07.1979”. The dot after the day and after the month is there as soon as
 * they are typed („15.”), so the reader sees it is not theirs to type. The
 * dots being the field's, a key that deletes only a dot deletes the digit
 * beside it too: Backspace after „15.” gives „1”, never a field that will not
 * shrink. A separator the reader types after a lone digit closes the day or
 * the month: „1.” is „01.”. Nothing else is taken, a letter or a ninth digit.
 *
 * The caret stays after the digit it was after: at the end, where a reader
 * types, or wherever they went back to mend one.
 */
export function dotTyped(
  raw: string,
  caret: number,
  key: DateKey = {},
): { text: string; caret: number } {
  const atEnd = caret >= raw.length;
  let digits = raw.replace(/\D/g, "");
  let before = raw.slice(0, caret).replace(/\D/g, "").length;
  const { deleted, inserted } = key;
  if (deleted && digits.length === deleted.before.replace(/\D/g, "").length) {
    const at = deleted.forward ? before : before - 1;
    if (at >= 0 && at < digits.length) {
      digits = digits.slice(0, at) + digits.slice(at + 1);
      before = at;
    }
  }
  if (
    atEnd &&
    inserted &&
    SEPARATOR.test(inserted) &&
    (digits.length === 1 || digits.length === 3)
  ) {
    digits = `${digits.slice(0, -1)}0${digits.slice(-1)}`;
  }
  digits = digits.slice(0, DATE_DIGITS);
  let text = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
    .filter(Boolean)
    .join(".");
  if (atEnd && (digits.length === 2 || digits.length === 4)) text += ".";
  if (atEnd) return { text, caret: text.length };

  let at = 0;
  for (let seen = 0; at < text.length && seen < before; at++) {
    if (/\d/.test(text[at]!)) seen++;
  }
  return { text, caret: at };
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
