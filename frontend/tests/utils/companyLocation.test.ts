import { describe, it, expect } from "vitest";
import {
  employmentPlaceIds,
  employmentTowns,
  regionNamesByPlaceId,
  regionsByPlaceId,
  townInCompanyName,
  workLocationNames,
  workLocationRegions,
} from "~/utils/companyLocation";
import type { Region } from "~~/shared/model";

function region(
  name: string,
  teryt: string,
  targets: { all?: string[]; approved?: string[] },
): Region {
  return {
    name,
    type: "region",
    teryt,
    stats: {
      isApproved: true,
      notesCount: 0,
      votes: {},
      edges: {
        all: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.all ?? [],
          currentlyEmployed: false,
        },
        approved: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.approved ?? [],
          currentlyEmployed: false,
        },
      },
    },
  } as Region;
}

describe("regionNamesByPlaceId", () => {
  it("names the region that owns a company", () => {
    const regions = {
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
  });

  it("reads the edge scope it is asked for", () => {
    const regions = {
      teryt1462: region("Płock", "1462", {
        all: ["orlen", "pending"],
        approved: ["orlen"],
      }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
    expect(regionNamesByPlaceId(regions, "all")).toEqual({
      orlen: "Płock",
      pending: "Płock",
    });
  });

  it("prefers the most specific region claiming a company", () => {
    // The region hierarchy shares the owns edge, so a województwo can end up
    // listing a company its powiat owns.
    const regions = {
      teryt14: region("mazowieckie", "14", {
        approved: ["teryt1462", "orlen"],
      }),
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved").orlen).toBe("Płock");
  });

  it("survives regions the stats job has not reached", () => {
    const regions = {
      teryt14: { name: "mazowieckie", type: "region", teryt: "14" } as Region,
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({});
  });
});

describe("employmentPlaceIds", () => {
  const edge = (type: string, id: string, nodeType = "place") => ({
    type,
    richNode: { id, type: nodeType, name: id },
  });

  it("keeps the companies a person was employed at", () => {
    expect(
      employmentPlaceIds([edge("employed", "orlen"), edge("employed", "pkp")]),
    ).toEqual(["orlen", "pkp"]);
  });

  it("ignores relations that are not employment", () => {
    // Owning a company or being mentioned beside one says nothing about where
    // somebody sat.
    expect(
      employmentPlaceIds([
        edge("owns", "orlen"),
        edge("connection", "pkp"),
        edge("election", "teryt1461", "region"),
      ]),
    ).toEqual([]);
  });

  it("ignores employment edges that do not lead to a place", () => {
    expect(employmentPlaceIds([edge("employed", "jan", "person")])).toEqual([]);
  });
});

describe("townInCompanyName", () => {
  it("reads the town the pipelines put after a company's name", () => {
    expect(
      townInCompanyName(
        "WOJEWÓDZKIE CENTRUM SZPITALNE KOTLINY JELENIOGÓRSKIEJ (Jelenia Góra)",
      ),
    ).toBe("Jelenia Góra");
    expect(townInCompanyName("PKP CARGO (Kędzierzyn-Koźle)")).toBe(
      "Kędzierzyn-Koźle",
    );
    expect(townInCompanyName("ZGK (Nowe Miasto nad Pilicą)")).toBe(
      "Nowe Miasto nad Pilicą",
    );
  });

  it("leaves a name with no town after it alone", () => {
    expect(townInCompanyName("MIEJSKIE WODOCIĄGI W OLSZTYNIE")).toBeUndefined();
    expect(townInCompanyName(undefined)).toBeUndefined();
    // A bracket in the middle is part of the name.
    expect(townInCompanyName("SPÓŁKA (Kraków) S.A.")).toBeUndefined();
  });

  it("does not take a bracket that is part of the name for a town", () => {
    // Names are in capitals and towns are not, so an abbreviation or a
    // lower-case remark cannot be a town the pipelines added.
    expect(
      townInCompanyName("POLSKA GRUPA ENERGETYCZNA (PGE)"),
    ).toBeUndefined();
    expect(
      townInCompanyName("ZAKŁAD KOMUNALNY (w likwidacji)"),
    ).toBeUndefined();
  });
});

describe("employmentTowns", () => {
  const edge = (type: string, name: string, nodeType = "place") => ({
    type,
    richNode: { id: name, type: nodeType, name },
  });

  it("names the town of every employer, once each", () => {
    expect(
      employmentTowns([
        edge("employed", "WOJEWÓDZKIE CENTRUM SZPITALNE (Jelenia Góra)"),
        edge("employed", "KARKONOSKIE CENTRUM MEDYCZNE (Jelenia Góra)"),
        edge("employed", "POLSKIE KOLEJE PAŃSTWOWE (Warszawa)"),
      ]),
    ).toEqual(["Jelenia Góra", "Warszawa"]);
  });

  it("reads employment only, as employmentPlaceIds does", () => {
    expect(
      employmentTowns([
        edge("owns", "ORLEN (Płock)"),
        edge("election", "Powiat lwówecki", "region"),
        edge("employed", "Jan (Kraków)", "person"),
      ]),
    ).toEqual([]);
  });
});

describe("workLocationNames", () => {
  const regionNames = { orlen: "Płock", pkp: "Warszawa", mpk: "Płock" };

  it("names the region of every employer", () => {
    expect(workLocationNames(["orlen", "pkp"], regionNames)).toEqual([
      "Płock",
      "Warszawa",
    ]);
  });

  it("names a city once however many employers sit in it", () => {
    expect(workLocationNames(["orlen", "mpk"], regionNames)).toEqual(["Płock"]);
  });

  it("drops companies no region claims", () => {
    expect(workLocationNames(["orlen", "unknown"], regionNames)).toEqual([
      "Płock",
    ]);
  });
});

describe("regionsByPlaceId", () => {
  it("carries the code the map needs, not only the name", () => {
    const regions = {
      r1: region("Województwo Pomorskie", "22", { approved: ["c1"] }),
    };
    expect(regionsByPlaceId(regions, "approved")).toEqual({
      c1: { name: "Województwo Pomorskie", teryt: "22" },
    });
  });

  it("still lets the more specific region claim the company", () => {
    const regions = {
      woj: region("Województwo Mazowieckie", "14", { approved: ["c1"] }),
      pow: region("Płock", "1462", { approved: ["c1"] }),
    };
    expect(regionsByPlaceId(regions, "approved").c1).toEqual({
      name: "Płock",
      teryt: "1462",
    });
  });
});

describe("workLocationRegions", () => {
  it("names a region once, keeping its code", () => {
    const seats = {
      c1: { name: "Płock", teryt: "1462" },
      c2: { name: "Płock", teryt: "1462" },
    };
    expect(workLocationRegions(["c1", "c2"], seats)).toEqual([
      { name: "Płock", teryt: "1462" },
    ]);
  });

  it("drops an employer no region claims", () => {
    expect(workLocationRegions(["c1"], {})).toEqual([]);
  });
});
