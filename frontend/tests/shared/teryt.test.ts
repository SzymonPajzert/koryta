import { describe, it, expect } from "vitest";
import {
  isWojewodztwoTeryt,
  wojewodztwoOf,
  isInWojewodztwo,
  wojewodztwoLabel,
  regionFilterOptions,
  powiatOf,
  terytCoversPowiat,
  withWojewodztwa,
  isWojewodztwoMarker,
} from "../../shared/teryt";

describe("withWojewodztwa", () => {
  it("adds the województwo of every region, each once, after the ids", () => {
    expect(
      withWojewodztwa([
        "company",
        "teryt1465",
        "teryt1465011",
        "teryt1261",
        "teryt14",
      ]),
    ).toEqual([
      "company",
      "teryt1465",
      "teryt1465011",
      "teryt1261",
      "teryt14",
      "woj:14",
      "woj:12",
    ]);
  });

  it("leaves a list with no region as it was", () => {
    const ids = ["company", "person"];
    expect(withWojewodztwa(ids)).toBe(ids);
    expect(withWojewodztwa([])).toEqual([]);
  });
});

describe("isWojewodztwoMarker", () => {
  it("tells a marker from a node id", () => {
    expect(isWojewodztwoMarker("woj:14")).toBe(true);
    expect(isWojewodztwoMarker("teryt14")).toBe(false);
    expect(isWojewodztwoMarker(14)).toBe(false);
  });
});

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

describe("powiatOf", () => {
  it("takes the first four digits of anything finer", () => {
    expect(powiatOf("1465")).toBe("1465");
    expect(powiatOf("1465011")).toBe("1465");
  });

  it("has no answer for a województwo or a non-code", () => {
    expect(powiatOf("14")).toBeNull();
    expect(powiatOf("")).toBeNull();
    expect(powiatOf("mazowieckie")).toBeNull();
  });
});

describe("terytCoversPowiat", () => {
  it("colours the powiat a gmina sits in", () => {
    expect(terytCoversPowiat("1465011", "1465")).toBe(true);
    expect(terytCoversPowiat("1465011", "1425")).toBe(false);
  });

  it("colours every powiat of a województwo", () => {
    expect(terytCoversPowiat("14", "1465")).toBe(true);
    expect(terytCoversPowiat("14", "1425")).toBe(true);
    expect(terytCoversPowiat("14", "1261")).toBe(false);
  });

  it("colours a powiat itself", () => {
    expect(terytCoversPowiat("1261", "1261")).toBe(true);
  });

  it("colours nothing for a code we cannot read", () => {
    expect(terytCoversPowiat("Kraków", "1261")).toBe(false);
    expect(terytCoversPowiat("", "1261")).toBe(false);
  });
});
