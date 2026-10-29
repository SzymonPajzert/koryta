import { describe, it, expect } from "vitest";
import {
  agreedName,
  declarationIngestSchema,
  extractId,
  isPng,
  nameFitsPage,
  parseTypedDate,
  pngSize,
  settleReading,
  type ReaderAnswer,
} from "../../shared/declarations";

const TODAY = new Date("2026-10-29T12:00:00Z");

/** Readers' answers from a compact list: a date or year, "?" for unreadable,
 * "-" for an empty field, "skip" for a skip. */
function answers(...values: string[]): ReaderAnswer[] {
  return values.map((value, i) => {
    const uid = `reader-${i}`;
    if (value === "?") return { uid, verdict: "unreadable" };
    if (value === "-") return { uid, verdict: "empty" };
    if (value === "skip") return { uid, verdict: "skip" };
    return { uid, verdict: "date", value };
  });
}

describe("parseTypedDate", () => {
  it.each([
    ["15.07.1979", "1979-07-15"],
    ["15 07 1979", "1979-07-15"],
    ["15-07-1979", "1979-07-15"],
    ["15/07/1979", "1979-07-15"],
    ["5.7.1979", "1979-07-05"],
    ["1979-07-15", "1979-07-15"],
    ["15 lipca 1979", "1979-07-15"],
    ["15 Lipiec 1979", "1979-07-15"],
    ["15 VII 1979", "1979-07-15"],
    ["15.vii.1979", "1979-07-15"],
    ["3 IX 1971", "1971-09-03"],
    ["1 października 1960", "1960-10-01"],
    ["1 pazdziernika 1960", "1960-10-01"],
    ["29 lutego 1980", "1980-02-29"],
    ["15071979", "1979-07-15"],
  ])("reads %s as a day", (typed, value) => {
    expect(parseTypedDate(typed, TODAY)).toEqual({ kind: "date", value });
  });

  it("reads a year typed alone as a year", () => {
    expect(parseTypedDate(" 1979 ", TODAY)).toEqual({
      kind: "year",
      value: "1979",
    });
  });

  it.each([
    ["", "empty"],
    ["15.07.79", "format"],
    ["31.02.1979", "format"],
    ["15.13.1979", "format"],
    ["lipiec", "format"],
    ["29 lutego 1981", "format"],
    ["15.07.1879", "range"],
    ["15.07.2027", "range"],
    ["30.10.2026", "range"],
  ])("refuses %j (%s)", (typed, reason) => {
    expect(parseTypedDate(typed, TODAY)).toEqual({ kind: "invalid", reason });
  });
});

describe("settleReading", () => {
  it("waits for a second reader", () => {
    expect(settleReading(answers("1979-07-15"))).toEqual({ status: "open" });
  });

  it("settles two readers who typed the same day", () => {
    expect(settleReading(answers("1979-07-15", "1979-07-15"))).toEqual({
      status: "agreed",
      value: "1979-07-15",
      kind: "date",
      readers: 2,
    });
  });

  it("waits on a 2-1 and settles a 3-1", () => {
    const twoOne = answers("1979-07-15", "1979-07-16", "1979-07-15");
    expect(settleReading(twoOne)).toEqual({ status: "open" });
    const threeOne: ReaderAnswer[] = [
      ...twoOne,
      { uid: "fourth", verdict: "date", value: "1979-07-15" },
    ];
    expect(settleReading(threeOne)).toMatchObject({
      status: "agreed",
      value: "1979-07-15",
      readers: 3,
    });
  });

  it("counts a year typed alone towards the days in it, not against them", () => {
    expect(settleReading(answers("1979-07-15", "1979"))).toEqual({
      status: "agreed",
      value: "1979-07-15",
      kind: "date",
      readers: 2,
    });
  });

  it("settles a year when only the year is on the form", () => {
    expect(settleReading(answers("1979", "1979"))).toMatchObject({
      status: "agreed",
      value: "1979",
      kind: "year",
    });
  });

  it("counts a reader once, by their last answer", () => {
    const sameReader: ReaderAnswer[] = [
      { uid: "a", verdict: "date", value: "1979-07-15" },
      { uid: "a", verdict: "date", value: "1979-07-15" },
    ];
    expect(settleReading(sameReader)).toEqual({ status: "open" });
  });

  it("never counts a robot as a reader", () => {
    const robots: ReaderAnswer[] = [
      { uid: "pipeline-declarations", verdict: "date", value: "1979-07-15" },
      { uid: "migration:test", verdict: "date", value: "1979-07-15" },
      { uid: "a", verdict: "date", value: "1979-07-15" },
    ];
    expect(settleReading(robots)).toEqual({ status: "open" });
  });

  it("lets a high-confidence machine reading count as one voice", () => {
    expect(
      settleReading(answers("1979-07-15"), { machine: "1979-07-15" }),
    ).toMatchObject({ status: "agreed", value: "1979-07-15", readers: 2 });
    expect(
      settleReading(answers("1979-07-16"), { machine: "1979-07-15" }),
    ).toEqual({ status: "open" });
  });

  it("ignores skips", () => {
    expect(settleReading(answers("skip", "skip", "1979-07-15"))).toEqual({
      status: "open",
    });
  });

  it("does not let readers who could not read it outvote a date", () => {
    expect(
      settleReading(answers("?", "1979-07-15", "1979-07-15")),
    ).toMatchObject({
      status: "agreed",
      value: "1979-07-15",
    });
  });

  it("settles as unreadable once three readers say so", () => {
    expect(settleReading(answers("?", "-"))).toEqual({ status: "open" });
    expect(settleReading(answers("?", "-", "?"))).toEqual({
      status: "unreadable",
      readers: 3,
    });
  });

  it("hands six answers nobody agrees on to an admin", () => {
    expect(
      settleReading(
        answers(
          "1979-07-15",
          "1979-07-16",
          "1978-07-15",
          "1979-07-17",
          "?",
          "1979-01-15",
        ),
      ),
    ).toEqual({ status: "disputed" });
  });
});

describe("agreedName", () => {
  it("agrees on a name two readers spelled alike once folded", () => {
    const named: ReaderAnswer[] = [
      { uid: "a", verdict: "date", value: "1966-05-21", name: "Ewa Przykład" },
      { uid: "b", verdict: "date", value: "1966-05-21", name: "ewa przyklad" },
      { uid: "c", verdict: "date", value: "1966-05-21", name: "Ewa Przyklat" },
    ];
    expect(agreedName(named)).toBe("Ewa Przykład");
  });

  it("has no name with one reader", () => {
    expect(
      agreedName([
        { uid: "a", verdict: "date", value: "1979", name: "Jan Nowak" },
      ]),
    ).toBeNull();
  });
});

describe("nameFitsPage", () => {
  it("takes a maiden name and middle names on the form", () => {
    expect(nameFitsPage("Ewa Anna Przykład Szkicowa", "Ewa Przykład")).toBe(
      true,
    );
  });

  it("takes a double surname split on the page", () => {
    expect(nameFitsPage("Anna Nowak-Kowalska", "Anna Nowak-Kowalska")).toBe(
      true,
    );
  });

  it("refuses another first name or surname", () => {
    expect(nameFitsPage("Marek Przykład", "Ewa Przykład")).toBe(false);
    expect(nameFitsPage("Ewa Szkicowa", "Ewa Przykład")).toBe(false);
  });
});

describe("the upload", () => {
  const candidacy = {
    key: "f23a52f46489f75f",
    kids: ["fx0001Atrapa00000000"],
    teryt: "021704",
    level: "gmina",
    office: "Rada gminy",
    year: 2024,
    status: "found",
    reason: "named",
  };
  const extract = {
    sha256: "a".repeat(64),
    page: 0,
    url: "https://bip.strzelin.pl/download/1",
    candidacies: ["f23a52f46489f75f"],
    outcome: "crop",
    images: { date: "iVBORw0KGgo=" },
  };

  it("accepts the contract's example", () => {
    const parsed = declarationIngestSchema.parse({
      tag: "bip-cut-v1",
      candidacies: [candidacy],
      extracts: [extract],
    });
    expect(parsed.extracts[0]!.page).toBe(0);
  });

  it("refuses a crop without images and a register date in the reading", () => {
    expect(() =>
      declarationIngestSchema.parse({
        tag: "t",
        extracts: [{ ...extract, images: undefined }],
      }),
    ).toThrow();
    expect(() =>
      declarationIngestSchema.parse({
        tag: "t",
        extracts: [{ ...extract, machine: { birthDate: "15.07.1979" } }],
      }),
    ).toThrow();
  });

  it("refuses more crops than a request may carry", () => {
    expect(() =>
      declarationIngestSchema.parse({
        tag: "t",
        extracts: Array.from({ length: 26 }, () => extract),
      }),
    ).toThrow();
  });

  it("names one extract per file and page", () => {
    expect(extractId("ab".repeat(32), 3)).toBe(`${"ab".repeat(32)}-p3`);
  });
});

describe("isPng / pngSize", () => {
  it("reads a PNG's signature and size", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0x03, 0xe7, 0, 0, 0, 0x65,
    ]);
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 999, height: 101 });
    expect(isPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });
});
