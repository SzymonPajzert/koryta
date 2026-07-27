import { describe, it, expect } from "vitest";
import {
  isWojewodztwoTeryt,
  wojewodztwoOf,
  isInWojewodztwo,
  wojewodztwoLabel,
  regionFilterOptions,
} from "../../shared/teryt";

describe("isWojewodztwoTeryt", () => {
  it("accepts two digit codes only", () => {
    expect(isWojewodztwoTeryt("14")).toBe(true);
    expect(isWojewodztwoTeryt("02")).toBe(true);
    expect(isWojewodztwoTeryt("1465")).toBe(false);
    expect(isWojewodztwoTeryt("1465011")).toBe(false);
    expect(isWojewodztwoTeryt("")).toBe(false);
    expect(isWojewodztwoTeryt("mazowieckie")).toBe(false);
  });
});

describe("wojewodztwoOf", () => {
  it("takes the leading two digits", () => {
    expect(wojewodztwoOf("14")).toBe("14");
    expect(wojewodztwoOf("1465")).toBe("14");
    expect(wojewodztwoOf("1465011")).toBe("14");
  });

  it("rejects non numeric codes", () => {
    expect(wojewodztwoOf("")).toBeNull();
    expect(wojewodztwoOf("1")).toBeNull();
    expect(wojewodztwoOf("teryt14")).toBeNull();
  });
});

describe("isInWojewodztwo", () => {
  it("matches the województwo itself and everything below it", () => {
    expect(isInWojewodztwo("14", "14")).toBe(true);
    expect(isInWojewodztwo("1425", "14")).toBe(true);
    expect(isInWojewodztwo("1465011", "14")).toBe(true);
  });

  it("does not match a neighbouring województwo", () => {
    expect(isInWojewodztwo("12", "14")).toBe(false);
    expect(isInWojewodztwo("1261", "14")).toBe(false);
    // "04" must not be read as a prefix of "0465".
    expect(isInWojewodztwo("0465", "14")).toBe(false);
  });
});

describe("wojewodztwoLabel", () => {
  it("normalizes both spellings found in the database", () => {
    expect(wojewodztwoLabel("Województwo mazowieckie")).toBe(
      "Województwo mazowieckie",
    );
    expect(wojewodztwoLabel("dolnośląskie")).toBe("Województwo dolnośląskie");
    expect(wojewodztwoLabel("Śląskie")).toBe("Województwo śląskie");
  });
});

describe("regionFilterOptions", () => {
  const regions = [
    { name: "Radom", teryt: "1425" },
    { name: "Województwo mazowieckie", teryt: "14" },
    { name: "Kraków", teryt: "1261" },
    { name: "dolnośląskie", teryt: "02" },
  ];

  it("lists województwa first, then the rest alphabetically", () => {
    expect(regionFilterOptions(regions)).toEqual([
      { title: "Województwo dolnośląskie", value: "02" },
      { title: "Województwo mazowieckie", value: "14" },
      { title: "Kraków", value: "1261" },
      { title: "Radom", value: "1425" },
    ]);
  });

  it("drops regions that cannot be filtered on", () => {
    const options = regionFilterOptions([
      ...regions,
      { name: "Powiat Testowy", teryt: "" },
      { name: undefined, teryt: "1401" },
    ]);
    expect(options.map((o) => o.value)).not.toContain("");
    expect(options.map((o) => o.value)).not.toContain("1401");
  });
});
