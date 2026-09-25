import { describe, it, expect } from "vitest";
import { contractValueLabel, plnCompact, plnExact } from "../../shared/money";

/** `Intl` puts a narrow no-break space between groups and money.ts puts a
 * plain no-break space before „zł". Neither is typeable, so every expectation
 * is written against the ordinary spaces and normalised here - otherwise a
 * failure prints two strings that look identical. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

describe("plnExact", () => {
  it("groups from four digits, which the Polish locale does not do on its own", () => {
    // `Intl.NumberFormat("pl-PL", { style: "currency" })` renders this as
    // „6300,00 zł": CLDR starts grouping Polish at five digits.
    expect(plain(plnExact(6300))).toBe("6 300 zł");
    expect(plain(plnExact(38_490))).toBe("38 490 zł");
    expect(plain(plnExact(1_105_491_462))).toBe("1 105 491 462 zł");
  });

  it("prints grosze only where there are any", () => {
    expect(plain(plnExact(1436.5))).toBe("1 436,50 zł");
    expect(plain(plnExact(1436))).toBe("1 436 zł");
    expect(plain(plnExact(120))).toBe("120 zł");
  });

  it("keeps a zero, which is a real contract value and not a missing one", () => {
    // 251 of the 149 683 contracts in the window are worth 0 zł.
    expect(plain(plnExact(0))).toBe("0 zł");
  });

  it("says nothing rather than NaN", () => {
    expect(plnExact(null)).toBe("—");
    expect(plnExact(undefined)).toBe("—");
    expect(plnExact(Number.NaN)).toBe("—");
  });
});

describe("plnCompact", () => {
  it("does not round up across a magnitude", () => {
    // `notation: "compact"` alone turns this into „10 tys.", which claims more
    // money than the contract was worth.
    expect(plain(plnCompact(9999))).toBe("9 999 zł");
  });

  it("compacts from ten thousand up", () => {
    expect(plain(plnCompact(10_000))).toBe("10 tys. zł");
    expect(plain(plnCompact(46_908_205))).toBe("46,9 mln zł");
    expect(plain(plnCompact(12_325_630_169))).toBe("12,3 mld zł");
  });

  it("leaves small figures exact, so two of them stay comparable", () => {
    expect(plain(plnCompact(1436))).toBe("1 436 zł");
    expect(plain(plnCompact(120))).toBe("120 zł");
  });

  it("says nothing rather than NaN", () => {
    expect(plnCompact(null)).toBe("—");
  });
});

describe("contractValueLabel", () => {
  it("prints the figure when there is one", () => {
    expect(plain(contractValueLabel(1436.5, false))).toBe("1 436,50 zł");
  });

  it("names a withheld value rather than leaving the cell empty", () => {
    expect(contractValueLabel(null, true)).toBe("Utajniona");
  });

  it("tells a withheld value from one the register simply never stated", () => {
    expect(contractValueLabel(null, false)).toBe("Bez podanej wartości");
    expect(contractValueLabel(undefined, undefined)).toBe(
      "Bez podanej wartości",
    );
  });

  it("prefers the figure when a contract is flagged and states one anyway", () => {
    // Five contracts in the window carry the redaction flag and a value; the
    // flag is not evidence that the figure is missing.
    expect(plain(contractValueLabel(4200, true))).toBe("4 200 zł");
  });
});
