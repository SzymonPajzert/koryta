import { describe, it, expect } from "vitest";
import {
  answerWords,
  documentHost,
  readingWords,
  readTyped,
  taskContext,
  typedFromValue,
} from "~/utils/declarationReading";
import type { DeclarationTask } from "~~/shared/declarations";

const TODAY = new Date("2026-10-29T12:00:00Z");

const task = (over: Partial<DeclarationTask> = {}): DeclarationTask => ({
  id: "crop-1",
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy",
  declarationYear: 2019,
  images: { date: "data:image/png;base64,AAAA", name: null },
  imageSize: { date: { width: 950, height: 105 }, name: null },
  ...over,
});

/** What the date field on /oswiadczenia says back, which is the one check a
 * reader gets on their own typing: a slip of one digit shows up as the wrong
 * month in words before it is sent. `parseTypedDate` decides what a reading
 * is (tests/shared/declarations.test.ts); these are about the words. */
describe("readTyped", () => {
  it.each([
    ["15.07.1979", "1979-07-15", "15 lipca 1979"],
    ["15071979", "1979-07-15", "15 lipca 1979"],
    ["15 VII 1979", "1979-07-15", "15 lipca 1979"],
    ["1979-07-15", "1979-07-15", "15 lipca 1979"],
  ])("says %s back as a day in words", (typed, value, words) => {
    expect(readTyped(typed, TODAY)).toEqual({
      state: "ok",
      kind: "date",
      value,
      words,
    });
  });

  // The form often gives only the year, and the reader should see that the
  // year is all they sent.
  it("says a year typed alone is only a year", () => {
    expect(readTyped("1979", TODAY)).toEqual({
      state: "ok",
      kind: "year",
      value: "1979",
      words: "tylko rok: 1979",
    });
  });

  it("has nothing to say about an empty field", () => {
    expect(readTyped("", TODAY)).toEqual({ state: "empty" });
    expect(readTyped("   ", TODAY)).toEqual({ state: "empty" });
  });

  it.each([
    ["31.02.1979", "Taki dzień nie istnieje."],
    ["31021979", "Taki dzień nie istnieje."],
    ["15.13.1979", "Nie ma takiego miesiąca."],
    ["15131979", "Nie ma takiego miesiąca."],
    ["1979-13-15", "Nie ma takiego miesiąca."],
    ["15 XIII 1979", "Nie rozpoznaję miesiąca."],
    // A month and a year: the year is there, the day is what is missing.
    ["07.1979", "Brakuje dnia. Wpisz pełną datę albo sam rok."],
    ["lipiec 1979", "Brakuje dnia. Wpisz pełną datę albo sam rok."],
    // A year and something that is no month: no telling what is missing.
    ["15 1979", "To nie wygląda na datę - wpisz np. 15.07.1979."],
    ["150719790", "Za dużo cyfr na jedną datę."],
    ["15.07.1879", "Rok przed 1900 - sprawdź jeszcze raz."],
    ["1850", "Rok przed 1900 - sprawdź jeszcze raz."],
    ["30.10.2026", "To data z przyszłości - sprawdź jeszcze raz."],
    ["15 07 19 79", "To nie wygląda na datę - wpisz np. 15.07.1979."],
  ])("says why %j is not a date, at once", (typed, words) => {
    expect(readTyped(typed, TODAY)).toEqual({
      state: "problem",
      settled: true,
      words,
    });
  });

  // A date on its way: the problem is held back until the reader tries to
  // save, or the hint would change with every key.
  it.each([
    ["15.07", "Brakuje roku."],
    ["15.07.79", "Wpisz cały rok, cztery cyfry."],
    ["150779", "Wpisz rok czterema cyframi, np. 15071979."],
    ["15079", "Za mało cyfr na pełną datę, np. 15071979."],
    ["15", "Wpisz cały rok albo pełną datę."],
    // The year 1507 to the parser, the first half of 15071979 to the reader.
    ["1507", "Wpisz cały rok albo pełną datę, np. 15071979."],
    ["abc", "To nie wygląda na datę - wpisz np. 15.07.1979."],
  ])(
    "holds back the problem with %j until it looks finished",
    (typed, words) => {
      expect(readTyped(typed, TODAY)).toEqual({
        state: "problem",
        settled: false,
        words,
      });
    },
  );
});

describe("readingWords", () => {
  it("words a day in full and a year as only a year", () => {
    expect(readingWords("date", "1958-11-27")).toBe("27 listopada 1958");
    expect(readingWords("year", "1958")).toBe("tylko rok: 1958");
  });
});

describe("typedFromValue", () => {
  // A save that failed puts the crop back with what was typed into it, in
  // the reader's own order rather than the stored one.
  it("gives a stored day back the way it is typed", () => {
    expect(typedFromValue("1979-07-15")).toBe("15.07.1979");
  });

  it("leaves a year as it is, and nothing as nothing", () => {
    expect(typedFromValue("1979")).toBe("1979");
    expect(typedFromValue(null)).toBe("");
    expect(typedFromValue(undefined)).toBe("");
    expect(typedFromValue("")).toBe("");
  });
});

describe("answerWords", () => {
  it.each([
    ["date", "1979-07-15", "15 lipca 1979"],
    ["date", "1979", "tylko rok: 1979"],
    ["date", null, "data"],
    ["unreadable", null, "nie da się odczytać"],
    ["empty", null, "pole jest puste"],
    ["skip", null, "pominięte"],
  ] as const)("words a %s answer of %j as %j", (verdict, value, words) => {
    expect(answerWords(verdict, value)).toBe(words);
  });
});

describe("taskContext", () => {
  // All a reader is told about whose declaration it is: never the person.
  it("names the office, the unit and the year of the declaration", () => {
    expect(taskContext(task())).toBe(
      "Rada gminy · Testowice (gmina miejsko-wiejska) · oświadczenie za 2019",
    );
  });

  it("leaves out what the crop does not know", () => {
    expect(taskContext(task({ office: null, declarationYear: null }))).toBe(
      "Testowice (gmina miejsko-wiejska)",
    );
  });
});

describe("documentHost", () => {
  it("takes the host the server sends", () => {
    expect(
      documentHost("https://bip.gmina-testowa.example/a.pdf", "inny.example"),
    ).toBe("inny.example");
  });

  it("reads it off the link when the server sent none", () => {
    expect(documentHost("https://bip.gmina-testowa.example/a.pdf", null)).toBe(
      "bip.gmina-testowa.example",
    );
  });

  it("gives up on a link that is not one", () => {
    expect(documentHost("not a url", null)).toBeNull();
  });
});
