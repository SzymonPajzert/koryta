import { describe, it, expect } from "vitest";
import {
  answerWords,
  documentHost,
  dotTyped,
  lineParts,
  readingWords,
  readTyped,
  typedFromValue,
} from "~/utils/declarationReading";
import { REFUSED } from "../serverRefusals";

const TODAY = new Date("2026-10-29T12:00:00Z");

/** What the date field on /oswiadczenia says back, which is the one check a
 * reader gets on their own typing: a slip of one digit shows up as the wrong
 * month in words before it is sent. The field holds the eight digits of
 * dd.mm.rrrr with their dots (`dotTyped`), and part of a date is of no use:
 * `parseTypedDate` decides what a day is (tests/shared/declarations.test.ts);
 * these are about the words. */
describe("readTyped", () => {
  it.each([
    ["15.07.1979", "1979-07-15", "15 lipca 1979"],
    ["15071979", "1979-07-15", "15 lipca 1979"],
    ["01.01.1900", "1900-01-01", "1 stycznia 1900"],
  ])("says %s back as a day in words", (typed, value, words) => {
    expect(readTyped(typed, TODAY)).toEqual({ state: "ok", value, words });
  });

  it("has nothing to say about an empty field", () => {
    expect(readTyped("", TODAY)).toEqual({ state: "empty" });
    expect(readTyped("   ", TODAY)).toEqual({ state: "empty" });
  });

  it.each([
    ["31.02.1979", "Taki dzień nie istnieje."],
    ["00.07.1979", "Taki dzień nie istnieje."],
    ["15.13.1979", "Nie ma takiego miesiąca."],
    ["15.00.1979", "Nie ma takiego miesiąca."],
    ["15.07.1879", "Rok przed 1900 - sprawdź jeszcze raz."],
    ["30.10.2026", "To data z przyszłości - sprawdź jeszcze raz."],
    ["15.07.2027", "To data z przyszłości - sprawdź jeszcze raz."],
    ["150719790", "Za dużo cyfr na jedną datę."],
  ])("says why the whole of %j is not a day, at once", (typed, words) => {
    expect(readTyped(typed, TODAY)).toEqual({
      state: "problem",
      whole: true,
      words,
    });
  });

  // A date on its way, and a year alone, which is no more use than any other
  // part of a date: the field wants all eight digits, and says so once the
  // reader stops short of them or tries to save.
  it.each(["1", "15", "15.07", "15.07.19", "15.07.197", "1979", "1507"])(
    "wants all eight digits of %j",
    (typed) => {
      expect(readTyped(typed, TODAY)).toEqual({
        state: "problem",
        whole: false,
        words: "Wpisz wszystkie 8 cyfr.",
      });
    },
  );
});

/** What the field shows as a reader types: the digits with the dots put in,
 * each with the first digit after it, and the caret where the next digit
 * goes. */
describe("dotTyped", () => {
  /** The field after typing `keys` one by one at its end, as a phone's keypad
   * does. */
  function typeKeys(keys: string): string {
    let text = "";
    for (const key of keys) {
      text = dotTyped(text + key, text.length + 1, key).text;
    }
    return text;
  }

  it.each([
    ["1", "1"],
    ["15", "15"],
    ["150", "15.0"],
    ["1507", "15.07"],
    ["15071", "15.07.1"],
    ["15071979", "15.07.1979"],
  ])("shows %s as %s", (keys, shown) => {
    expect(typeKeys(keys)).toBe(shown);
  });

  it("takes no ninth digit, and no letter", () => {
    expect(typeKeys("150719791")).toBe("15.07.1979");
    expect(typeKeys("15a0b7")).toBe("15.07");
    expect(typeKeys("abc")).toBe("");
  });

  // A computer's keyboard, or a phone's with a dot on it: the reader's own
  // separator closes the day or the month, whichever digits it follows.
  it.each([
    ["15.", "15."],
    ["15.07.1979", "15.07.1979"],
    ["1.7.1979", "01.07.1979"],
    ["1.", "01."],
    ["15.7.", "15.07."],
    ["15/07/1979", "15.07.1979"],
    ["15 07 1979", "15.07.1979"],
    ["15-07-1979", "15.07.1979"],
    ["15..07", "15.07"],
    [".15", "15"],
    ["15.07.1979.", "15.07.1979"],
  ])("reads the separators of %j as the dots of %j", (keys, shown) => {
    expect(typeKeys(keys)).toBe(shown);
  });

  // A dot shows with the digit after it, so every backspace takes a digit,
  // and a dot left with nothing after it goes with that digit.
  it("gives back one digit to every backspace", () => {
    const shown: string[] = [];
    let text = "15.07.1979";
    while (text) {
      text = dotTyped(text.slice(0, -1), text.length - 1).text;
      shown.push(text);
    }
    expect(shown).toEqual([
      "15.07.197",
      "15.07.19",
      "15.07.1",
      "15.07",
      "15.0",
      "15",
      "1",
      "",
    ]);
  });

  it("takes a date pasted or filled in whole, whatever its separators", () => {
    expect(dotTyped("15.07.1979", 10, "15.07.1979")).toEqual({
      text: "15.07.1979",
      caret: 10,
    });
    expect(dotTyped("15/07/1979", 10)).toEqual({
      text: "15.07.1979",
      caret: 10,
    });
  });

  // A reader who went back to mend a digit keeps the caret after it, though
  // the dots move around it.
  it("keeps the caret after the digit it was after", () => {
    // „15.07.1979” with its „0” taken out by a backspace.
    expect(dotTyped("15.7.1979", 3)).toEqual({ text: "15.71.979", caret: 2 });
    // A „1” typed where the „0” was.
    expect(dotTyped("151.71.979", 3, "1")).toEqual({
      text: "15.17.1979",
      caret: 4,
    });
    // A separator typed in the middle is not one that closes anything.
    expect(dotTyped("15..07", 3, ".")).toEqual({ text: "15.07", caret: 2 });
  });
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

/** The failure lines of /oswiadczenia, which carry the server's words: a
 * hyphenated word in them is drawn on one line, as Polish breaks a line at a
 * hyphen only by repeating it on the next, which no browser does. */
describe("lineParts", () => {
  it("keeps a hyphenated word whole, and the text around it as it was", () => {
    expect(lineParts("bez potwierdzonego adresu e-mail, ile możemy.")).toEqual([
      { text: "bez potwierdzonego adresu ", whole: false },
      { text: "e-mail", whole: true },
      { text: ", ile możemy.", whole: false },
    ]);
  });

  it("leaves a hyphen with a space beside it, a dash, free to end a line", () => {
    expect(lineParts(REFUSED.dailyLimit)).toEqual([
      { text: "Na dziś wystarczy - dziękujemy! Wróć jutro.", whole: false },
    ]);
  });

  it("takes a word of several hyphens, and one at either end of the line", () => {
    expect(lineParts("Kędzierzyn-Koźle-Kłodnica i e-mail")).toEqual([
      { text: "Kędzierzyn-Koźle-Kłodnica", whole: true },
      { text: " i ", whole: false },
      { text: "e-mail", whole: true },
    ]);
  });

  it("gives nothing for an empty line, as the failure line is when closed", () => {
    expect(lineParts("")).toEqual([]);
  });

  it.each(Object.entries(REFUSED))(
    "puts the server's %s line back together word for word",
    (_, message) => {
      expect(
        lineParts(message)
          .map((part) => part.text)
          .join(""),
      ).toBe(message);
    },
  );
});
