import { describe, it, expect } from "vitest";
import {
  historySpanCaption,
  ledgerPeriod,
  relationPeriodLabel,
  relationPeriodParts,
  spellLength,
} from "~/utils/relationPeriod";
import type { EdgeNode } from "~/composables/edges";

describe("relationPeriodLabel", () => {
  it("reads both ends of a closed period", () => {
    expect(relationPeriodLabel("2014-11-06", "2017-08-25")).toBe(
      "2014-11-06 - 2017-08-25",
    );
  });

  it("calls an open period ongoing", () => {
    expect(relationPeriodLabel("2014-11-06", undefined)).toBe(
      "2014-11-06 - obecnie",
    );
  });

  it("collapses a period that begins and ends on one day", () => {
    expect(relationPeriodLabel("2014-11-06", "2014-11-06")).toBe("2014-11-06");
  });

  it("never stringifies a missing start", () => {
    // An edge entered through the editor may carry no start date, and the
    // template used to interpolate it straight into the caption - which is how
    // 117 published people came to read "undefined - obecnie". A missing start
    // is unknown, not today, so it is a "?" rather than "obecnie".
    expect(relationPeriodLabel(undefined, "2017-08-25")).toBe("? - 2017-08-25");
  });

  it("says nothing at all when no date was recorded", () => {
    // `connection` edges have no date fields in the schema, and the row asks
    // for a label before it knows that.
    expect(relationPeriodLabel(undefined, undefined)).toBe("");
  });
});

describe("relationPeriodParts", () => {
  it("hands back both ends of a closed period, not current", () => {
    expect(relationPeriodParts("2014-11-06", "2017-08-25")).toEqual({
      start: "2014-11-06",
      end: "2017-08-25",
      current: false,
    });
  });

  it("marks a post still held as current, so the caller can set „obecnie” apart", () => {
    expect(relationPeriodParts("2014-11-06", undefined)).toEqual({
      start: "2014-11-06",
      end: "obecnie",
      current: true,
    });
    // An empty end is as open as a missing one.
    expect(relationPeriodParts("2014-11-06", "")).toEqual({
      start: "2014-11-06",
      end: "obecnie",
      current: true,
    });
  });

  it("gives a missing start as „?”, never today", () => {
    expect(relationPeriodParts(undefined, "2017-08-25")).toEqual({
      start: "?",
      end: "2017-08-25",
      current: false,
    });
  });

  it("has no end to print for a single day or no dates at all", () => {
    expect(relationPeriodParts("2014-11-06", "2014-11-06")).toEqual({
      start: "2014-11-06",
      current: false,
    });
    expect(relationPeriodParts(undefined, undefined)).toEqual({
      start: "",
      current: false,
    });
  });
});

/** The day every case below is read on, so a post's „od” and a term still
 * ahead do not change meaning as the calendar moves. */
const TODAY = "2026-10-24";

describe("ledgerPeriod", () => {
  it("says „od” for a post still held, in the register's day format", () => {
    expect(ledgerPeriod("2026-08-19", undefined, { today: TODAY })).toEqual({
      text: "od 19.08.2026",
      years: "od 2026",
      current: true,
    });
    // An empty end is as open as a missing one: the edge editor writes "".
    expect(ledgerPeriod("2026-08-19", "", { today: TODAY })?.text).toBe(
      "od 19.08.2026",
    );
  });

  it("prints both days of a post that ended, and its years with an unspaced hyphen", () => {
    expect(ledgerPeriod("2023-05-15", "2024-12-04", { today: TODAY })).toEqual({
      text: "15.05.2023 - 04.12.2024",
      years: "2023-2024",
      current: false,
    });
  });

  it("gives a post that began and ended in one year that year once", () => {
    expect(
      ledgerPeriod("2023-02-01", "2023-11-30", { today: TODAY })?.years,
    ).toBe("2023");
  });

  it("prints a single day once, over once it has passed", () => {
    expect(ledgerPeriod("2005-09-25", "2005-09-25", { today: TODAY })).toEqual({
      text: "25.09.2005",
      years: "2005",
      current: false,
    });
  });

  it("counts a single day still ahead as current, as a post held today", () => {
    // An election announced for next spring.
    expect(ledgerPeriod("2027-04-11", "2027-04-11", { today: TODAY })).toEqual({
      text: "11.04.2027",
      years: "2027",
      current: true,
    });
  });

  it("says „do” where only the end is known", () => {
    expect(ledgerPeriod(undefined, "2010-07-26", { today: TODAY })).toEqual({
      text: "do 26.07.2010",
      years: "do 2010",
      current: false,
    });
  });

  it("counts a term whose end is still ahead as held, and keeps its range", () => {
    // „Kadencja do 2027”: never „- obecnie”, and still set in bold.
    expect(ledgerPeriod("2023-01-01", "2027-06-30", { today: TODAY })).toEqual({
      text: "01.01.2023 - 30.06.2027",
      years: "2023-2027",
      current: true,
    });
  });

  it("compares a partial end at its own precision", () => {
    // A term entered as „2026” runs all of 2026, and is over in 2027.
    expect(ledgerPeriod("2022-01-01", "2026", { today: TODAY })).toEqual({
      text: "01.01.2022 - 2026",
      years: "2022-2026",
      current: true,
    });
    expect(ledgerPeriod("2022-01-01", "2025", { today: TODAY })?.current).toBe(
      false,
    );
    expect(ledgerPeriod("2016-05", "2026-10", { today: TODAY })?.current).toBe(
      true,
    );
  });

  it("writes a month the relation form takes as RRRR-MM as „05.2016”", () => {
    expect(ledgerPeriod("2016-05", "2019-03", { today: TODAY })).toEqual({
      text: "05.2016 - 03.2019",
      years: "2016-2019",
      current: false,
    });
  });

  it("prints a date it cannot read as it was written, rather than guessing", () => {
    expect(ledgerPeriod("15.05.2023", undefined, { today: TODAY })).toEqual({
      text: "od 15.05.2023",
      years: "od 15.05.2023",
      current: true,
    });
    // A day the calendar does not have is not rolled into March.
    expect(
      ledgerPeriod("2024-02-31", "2024-06-30", { today: TODAY })?.text,
    ).toBe("2024-02-31 - 30.06.2024");
  });

  it("prints the year alone for a candidacy, whose day is the server's guess", () => {
    expect(
      ledgerPeriod("2010-06-20", "2010-06-20", {
        today: TODAY,
        yearOnly: true,
      })?.text,
    ).toBe("2010");
    expect(
      ledgerPeriod("2015-10-25", undefined, { today: TODAY, yearOnly: true })
        ?.text,
    ).toBe("od 2015");
  });

  it("has nothing to print for a relation with no dates", () => {
    expect(
      ledgerPeriod(undefined, undefined, { today: TODAY }),
    ).toBeUndefined();
    expect(ledgerPeriod("", "", { today: TODAY })).toBeUndefined();
  });
});

describe("spellLength", () => {
  it("measures a spell in months, and in years and months past a year", () => {
    expect(spellLength("2025-06-12", "2026-04-03", TODAY)).toBe("9 mies.");
    expect(spellLength("2024-07-02", "2026-10-02", TODAY)).toBe(
      "2 lata 3 mies.",
    );
  });

  it("counts a month only once its day has come round", () => {
    expect(spellLength("2024-05-16", "2024-07-02", TODAY)).toBe("1 mies.");
    expect(spellLength("2024-05-16", "2024-06-15", TODAY)).toBe(
      "poniżej miesiąca",
    );
    expect(spellLength("2024-05-16", "2024-05-16", TODAY)).toBe(
      "poniżej miesiąca",
    );
  });

  it("declines the years and leaves out a month count of nought", () => {
    expect(spellLength("2025-01-01", "2026-01-01", TODAY)).toBe("1 rok");
    expect(spellLength("2024-01-01", "2026-01-01", TODAY)).toBe("2 lata");
    expect(spellLength("2021-01-01", "2026-01-01", TODAY)).toBe("5 lat");
    expect(spellLength("2014-01-01", "2026-01-01", TODAY)).toBe("12 lat");
    expect(spellLength("2004-01-01", "2026-01-01", TODAY)).toBe("22 lata");
  });

  it("measures a post still held to today", () => {
    expect(spellLength("2026-05-14", null, TODAY)).toBe("5 mies.");
    expect(spellLength("2026-05-14", "", TODAY)).toBe("5 mies.");
    expect(spellLength("2024-07-02", undefined, TODAY)).toBe("2 lata 3 mies.");
  });

  it("says nothing where an end or the start is not a whole day", () => {
    // A year alone cannot be counted in months, and used to be measured to
    // today instead.
    expect(spellLength("2020-01-01", "2026", TODAY)).toBe("");
    expect(spellLength("2016-05", "2019-03-01", TODAY)).toBe("");
    expect(spellLength(null, "2020-01-01", TODAY)).toBe("");
  });
});

describe("historySpanCaption", () => {
  /** A row of a company's history: the far end is the person who held it. */
  function seat(
    personId: string,
    start?: string,
    type: "person" | "place" = "person",
  ): EdgeNode {
    return {
      id: `${personId}-${start ?? "bez-daty"}`,
      type: "employed",
      label: "Zarząd",
      source: personId,
      target: "pkp",
      start_date: start,
      richNode: { id: personId, type, name: personId },
    } as EdgeNode;
  }

  it("counts the people and the year the earliest post began", () => {
    expect(
      historySpanCaption([
        seat("anna", "2016-02-16"),
        seat("jan", "2001-05-01"),
        seat("ewa", "2023-07-01"),
      ]),
    ).toBe("3 osoby · wpisy od 2001");
  });

  it("counts a person with two spells once, and two namesakes twice", () => {
    const namesake = { ...seat("jan-2", "2019-01-01") };
    namesake.richNode = { ...namesake.richNode, name: "jan" };
    expect(
      historySpanCaption([
        seat("jan", "2010-01-01"),
        seat("jan", "2018-01-01"),
        namesake,
      ]),
    ).toBe("2 osoby · wpisy od 2010");
    expect(historySpanCaption([seat("jan", "2010-01-01")])).toBe(
      "1 osoba · wpisy od 2010",
    );
  });

  it("declines the count", () => {
    const people = (count: number) =>
      Array.from({ length: count }, (_, i) => seat(`p${i}`, "2020-01-01"));
    expect(historySpanCaption(people(5))).toBe("5 osób · wpisy od 2020");
    expect(historySpanCaption(people(12))).toBe("12 osób · wpisy od 2020");
    expect(historySpanCaption(people(22))).toBe("22 osoby · wpisy od 2020");
  });

  it("gives the count alone where no post has a start", () => {
    expect(historySpanCaption([seat("anna"), seat("jan")])).toBe("2 osoby");
  });

  it("leaves out rows that lead to anything but a person", () => {
    expect(
      historySpanCaption([
        seat("anna", "2016-02-16"),
        seat("orlen", "1999-01-01", "place"),
      ]),
    ).toBe("1 osoba · wpisy od 2016");
    expect(historySpanCaption([seat("orlen", "1999-01-01", "place")])).toBe("");
    expect(historySpanCaption([])).toBe("");
  });
});
