import { describe, it, expect } from "vitest";
import {
  gminaLabel,
  indexOffices,
  officeChoices,
  officeProposal,
  officesFor,
  storedOffices,
  type RegionOffice,
} from "../../shared/offices";

/** Rows as a region node carries them in `offices`. */
const WEJHEROWO: RegionOffice = {
  teryt: "2215031",
  region: "Wejherowo",
  name: "Urząd Miejski w Wejherowie",
  regon: "000526251",
  nip: "5882155172",
};
const MOKOTOW: RegionOffice = {
  teryt: "1465058",
  region: "Mokotów",
  name: "URZĄD DZIELNICY MOKOTÓW MIASTA STOŁECZNEGO WARSZAWY",
  regon: "01525966300050",
  nip: null,
};
const WEJHEROWO_WIEJSKA: RegionOffice = {
  teryt: "2215102",
  region: "Wejherowo",
  name: "Urząd Gminy Wejherowo",
  regon: "000545113",
  nip: "5881007736",
};
const CHOCZEWO: RegionOffice = {
  teryt: "2215042",
  region: "Choczewo",
  name: "URZĄD GMINY CHOCZEWO",
  regon: "000534463",
  nip: "5881222222",
};
const STAROSTWO: RegionOffice = {
  teryt: "2215",
  region: "wejherowski",
  name: "Starostwo Powiatowe w Wejherowie",
  regon: "191686414",
  nip: "5881831062",
};
const POMORSKIE: RegionOffice[] = [
  {
    teryt: "22",
    region: "POMORSKIE",
    name: "POMORSKI URZĄD WOJEWÓDZKI W GDAŃSKU",
    regon: "000514242",
    nip: "5831066122",
  },
  {
    teryt: "22",
    region: "POMORSKIE",
    name: "Urząd Marszałkowski Województwa Pomorskiego w Gdańsku",
    regon: "191686443",
    nip: "5832569948",
  },
];
/** A city that is its own powiat: one urząd, listed under both codes. */
const OPOLE: RegionOffice[] = [
  {
    teryt: "1661",
    region: "Opole",
    name: "URZĄD MIASTA OPOLA",
    regon: "000584805",
    nip: "7540024002",
  },
  {
    teryt: "1661011",
    region: "Opole",
    name: "URZĄD MIASTA OPOLA",
    regon: "000584805",
    nip: "7540024002",
  },
];
const WARKA: RegionOffice = {
  teryt: "1406113",
  region: "Warka",
  name: "Urząd Miejski w Warce",
  regon: "000526624",
  nip: "7971385756",
};

describe("storedOffices", () => {
  it("reads the rows a region node carries, a missing NIP included", () => {
    expect(storedOffices([WEJHEROWO, MOKOTOW])).toEqual([WEJHEROWO, MOKOTOW]);
  });

  it("skips a row it cannot use rather than losing the rest", () => {
    const rows = [
      "not a row",
      null,
      { teryt: "2215031", name: "Bez REGON-u" },
      WEJHEROWO,
    ];

    expect(storedOffices(rows).map((office) => office.regon)).toEqual([
      "000526251",
    ]);
  });

  it("takes a row without the region's name", () => {
    const [office] = storedOffices([{ ...WEJHEROWO, region: undefined }]);

    expect(office?.region).toBeNull();
  });

  it("reads no rows from a node that carries none", () => {
    expect(storedOffices(undefined)).toEqual([]);
    expect(storedOffices("URZĄD MIASTA OPOLA")).toEqual([]);
  });
});

describe("officesFor", () => {
  const index = indexOffices([WEJHEROWO, ...POMORSKIE, WARKA]);

  it("finds a gmina's urząd by its code", () => {
    expect(officesFor(index, "2215031").map((office) => office.name)).toEqual([
      "Urząd Miejski w Wejherowie",
    ]);
  });

  it("lists both of a województwo's offices", () => {
    expect(officesFor(index, "22")).toHaveLength(2);
  });

  it("has nothing for a region it does not list", () => {
    // The rural gmina of the same name is another region, with another urząd.
    expect(officesFor(index, "2215102")).toEqual([]);
    expect(officesFor(index, "")).toEqual([]);
  });

  it("answers for the town or the villages of a gmina with the gmina's urząd", () => {
    // Warka the town is teryt1406114 and has a node of its own; the urząd
    // that runs it is the gmina miejsko-wiejska's, 1406113.
    for (const half of ["1406114", "1406115"]) {
      expect(officesFor(index, half).map((office) => office.name)).toEqual([
        "Urząd Miejski w Warce",
      ]);
    }
  });

  it("does not stretch that to any other code", () => {
    // A gmina miejska is not half of anything, and a powiat's code is no
    // gmina's.
    expect(officesFor(index, "1406111")).toEqual([]);
    expect(officesFor(index, "1406")).toEqual([]);
  });
});

describe("gminaLabel", () => {
  it("tells a town from the villages around it of the same name", () => {
    expect(gminaLabel(WEJHEROWO)).toBe("Gmina miejska Wejherowo");
    expect(gminaLabel(WEJHEROWO_WIEJSKA)).toBe("Gmina wiejska Wejherowo");
  });

  it("calls a Warsaw dzielnica a dzielnica", () => {
    expect(gminaLabel(MOKOTOW)).toBe("Dzielnica Mokotów");
  });

  it("falls back to the kind without the region's name", () => {
    expect(gminaLabel({ ...WEJHEROWO, region: null })).toBe("Gmina miejska");
  });
});

describe("officeChoices", () => {
  const index = indexOffices([
    WEJHEROWO_WIEJSKA,
    STAROSTWO,
    WEJHEROWO,
    CHOCZEWO,
    ...POMORSKIE,
    ...OPOLE,
  ]);
  const listed = (teryt: string) =>
    officeChoices(index, teryt).map(({ office, gmina }) => [
      office.name,
      gmina,
    ]);

  it("lists a powiat's gminy after its starostwo, each by its name", () => {
    // Most gminy have no region node to pick, and the starostwo is not where
    // a wójt or a burmistrz works.
    expect(listed("2215")).toEqual([
      ["Starostwo Powiatowe w Wejherowie", null],
      ["URZĄD GMINY CHOCZEWO", "Gmina wiejska Choczewo"],
      ["Urząd Miejski w Wejherowie", "Gmina miejska Wejherowo"],
      ["Urząd Gminy Wejherowo", "Gmina wiejska Wejherowo"],
    ]);
  });

  it("lists a city that is its own powiat's urząd once", () => {
    expect(listed("1661")).toEqual([["URZĄD MIASTA OPOLA", null]]);
  });

  it("lists only a gmina's own urząd", () => {
    expect(listed("2215031")).toEqual([["Urząd Miejski w Wejherowie", null]]);
  });

  it("does not list a województwo's gminy", () => {
    expect(listed("22").map(([, gmina]) => gmina)).toEqual([null, null]);
  });
});

describe("officeProposal", () => {
  it("proposes a public place under the register's numbers", () => {
    expect(
      officeProposal({
        teryt: "2215031",
        region: "Wejherowo",
        name: "Urząd Miejski w Wejherowie",
        regon: "000526251",
        nip: "5882155172",
      }),
    ).toEqual({
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      nipNumber: "5882155172",
      isPublic: true,
    });
  });

  it("leaves out a NIP the register does not have", () => {
    const proposal = officeProposal({
      teryt: "1465058",
      region: "Mokotów",
      name: "URZĄD DZIELNICY MOKOTÓW MIASTA STOŁECZNEGO WARSZAWY",
      regon: "01525966300050",
      nip: null,
    });

    expect(proposal).not.toHaveProperty("nipNumber");
  });
});
