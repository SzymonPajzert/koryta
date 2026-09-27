import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  gminaLabel,
  indexOffices,
  officeChoices,
  officeProposal,
  officesFor,
  parseOffices,
} from "../../shared/offices";
import { isValidNip, isValidRegon } from "../../shared/identifiers";

/** Lines as the pipeline writes them - pandas escapes every letter outside
 * ASCII, so the Polish ones arrive as `\u` sequences. */
const WEJHEROWO =
  '{"teryt":"2215031","region":"Wejherowo","name":"Urz\\u0105d Miejski w Wejherowie","regon":"000526251","nip":"5882155172"}';
const MOKOTOW =
  '{"teryt":"1465058","region":"Mokot\\u00f3w","name":"URZ\\u0104D DZIELNICY MOKOT\\u00d3W MIASTA STO\\u0141ECZNEGO WARSZAWY","regon":"01525966300050","nip":null}';
const WEJHEROWO_WIEJSKA =
  '{"teryt":"2215102","region":"Wejherowo","name":"Urz\\u0105d Gminy Wejherowo","regon":"000545113","nip":"5881007736"}';
const CHOCZEWO =
  '{"teryt":"2215042","region":"Choczewo","name":"URZ\\u0104D GMINY CHOCZEWO","regon":"000534463","nip":"5881222222"}';
const STAROSTWO =
  '{"teryt":"2215","region":"wejherowski","name":"Starostwo Powiatowe w Wejherowie","regon":"191686414","nip":"5881831062"}';
const POMORSKIE = [
  '{"teryt":"22","region":"POMORSKIE","name":"POMORSKI URZ\\u0104D WOJEW\\u00d3DZKI W GDA\\u0143SKU","regon":"000514242","nip":"5831066122"}',
  '{"teryt":"22","region":"POMORSKIE","name":"Urz\\u0105d Marsza\\u0142kowski Wojew\\u00f3dztwa Pomorskiego w Gda\\u0144sku","regon":"191686443","nip":"5832569948"}',
];
/** A city that is its own powiat: one urząd, listed under both codes. */
const OPOLE = [
  '{"teryt":"1661","region":"Opole","name":"URZ\\u0104D MIASTA OPOLA","regon":"000584805","nip":"7540024002"}',
  '{"teryt":"1661011","region":"Opole","name":"URZ\\u0104D MIASTA OPOLA","regon":"000584805","nip":"7540024002"}',
];
const WARKA =
  '{"teryt":"1406113","region":"Warka","name":"Urz\\u0105d Miejski w Warce","regon":"000526624","nip":"7971385756"}';

describe("parseOffices", () => {
  it("reads the pipeline's lines, letters and missing NIP included", () => {
    expect(parseOffices(`${WEJHEROWO}\n${MOKOTOW}\n`)).toEqual([
      {
        teryt: "2215031",
        region: "Wejherowo",
        name: "Urząd Miejski w Wejherowie",
        regon: "000526251",
        nip: "5882155172",
      },
      {
        teryt: "1465058",
        region: "Mokotów",
        name: "URZĄD DZIELNICY MOKOTÓW MIASTA STOŁECZNEGO WARSZAWY",
        regon: "01525966300050",
        nip: null,
      },
    ]);
  });

  it("skips a line it cannot use rather than losing the rest", () => {
    const text = [
      "not json",
      '{"teryt":"2215031","name":"Bez REGON-u"}',
      WEJHEROWO,
    ].join("\n");

    expect(parseOffices(text).map((office) => office.regon)).toEqual([
      "000526251",
    ]);
  });

  it("takes a line without the region's name", () => {
    const [office] = parseOffices(
      '{"teryt":"2215031","name":"Urz\\u0105d Miejski w Wejherowie","regon":"000526251","nip":"5882155172"}',
    );

    expect(office?.region).toBeNull();
  });
});

describe("officesFor", () => {
  const index = indexOffices(
    parseOffices([WEJHEROWO, ...POMORSKIE, WARKA].join("\n")),
  );

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
  const [town, villages, dzielnica] = parseOffices(
    [WEJHEROWO, WEJHEROWO_WIEJSKA, MOKOTOW].join("\n"),
  );

  it("tells a town from the villages around it of the same name", () => {
    expect(gminaLabel(town!)).toBe("Gmina miejska Wejherowo");
    expect(gminaLabel(villages!)).toBe("Gmina wiejska Wejherowo");
  });

  it("calls a Warsaw dzielnica a dzielnica", () => {
    expect(gminaLabel(dzielnica!)).toBe("Dzielnica Mokotów");
  });

  it("falls back to the kind without the region's name", () => {
    expect(gminaLabel({ ...town!, region: null })).toBe("Gmina miejska");
  });
});

describe("officeChoices", () => {
  const index = indexOffices(
    parseOffices(
      [
        WEJHEROWO_WIEJSKA,
        STAROSTWO,
        WEJHEROWO,
        CHOCZEWO,
        ...POMORSKIE,
        ...OPOLE,
      ].join("\n"),
    ),
  );
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

describe("the shipped table", () => {
  const offices = parseOffices(
    readFileSync(
      resolve(__dirname, "../../server/assets/local_government_offices.jsonl"),
      "utf8",
    ),
  );
  const index = indexOffices(offices);

  it("names an office for Wejherowo, the town", () => {
    // What the report that asked for this was about: a deputy mayor of
    // Wejherowo works in the town's urząd, not in the rural gmina's next door.
    expect(officesFor(index, "2215031").map((office) => office.name)).toEqual([
      "Urząd Miejski w Wejherowie",
    ]);
  });

  it("reaches both Wejherowo gminy through their powiat", () => {
    const gminy = officeChoices(index, "2215").map(({ gmina }) => gmina);

    expect(gminy[0]).toBeNull();
    expect(gminy).toContain("Gmina miejska Wejherowo");
    expect(gminy).toContain("Gmina wiejska Wejherowo");
  });

  it("names the gmina of an urząd the catalogue calls only URZĄD GMINY", () => {
    expect(officesFor(index, "0412042").map((office) => office.name)).toEqual([
      "URZĄD GMINY RYPIN",
    ]);
  });

  it("carries the region's name on every row", () => {
    expect(offices.filter((office) => !office.region)).toEqual([]);
  });

  it("carries only numbers /api/revisions/create would accept", () => {
    // A proposal made from a row that fails its check digit would be refused,
    // and the contributor told the register's own number is wrong.
    const refused = offices.filter(
      (office) =>
        !isValidRegon(office.regon) ||
        (office.nip !== null && !isValidNip(office.nip)),
    );
    expect(refused).toEqual([]);
    expect(offices.length).toBeGreaterThan(2800);
  });
});
