import { describe, it, expect } from "vitest";
import {
  companyPage,
  companyRows,
  companySort,
  seatIsIn,
  sortCompanyRows,
  type CompanyRow,
} from "~/utils/companyRows";
import type { Company } from "~~/shared/model";

const place = (
  name: string,
  extra: Partial<Company> & { visibility?: boolean; deleted?: boolean } = {},
) => ({ name, type: "place", ...extra }) as Company & { visibility?: boolean };

const places = {
  pkp: place("PKP INTERCITY (Warszawa)", {
    categories: ["koleje"],
    isPublic: true,
  }),
  // Stored the way a node written before 2026-07-28 keeps an array.
  mpk: place("MPK KRAKÓW", {
    categories: {
      0: "koleje",
      1: "komunikacja-miejska",
    } as unknown as string[],
  }),
  szpital: place("SZPITAL POWIATOWY", { categories: ["szpitale"] }),
  bez: place("ZAKŁAD BEZ BRANŻY"),
};

const seats = {
  pkp: { name: "Warszawa", teryt: "1465" },
  mpk: { name: "Kraków", teryt: "1261" },
  szpital: { name: "Powiat krakowski", teryt: "1206" },
};

const people = {
  pkp: { people: 3, current: 1, latestStart: "2024-04-12" },
  mpk: { people: 1, current: 1, latestStart: "2020-01-01" },
};

const ids = (rows: CompanyRow[]) => rows.map((row) => row.id);

describe("seatIsIn", () => {
  it("places a seat inside every region its code extends", () => {
    expect(seatIsIn("1261", "12")).toBe(true);
    expect(seatIsIn("1261", "1261")).toBe(true);
    // Seated at the powiat, so not in any one gmina of it.
    expect(seatIsIn("1261", "1261011")).toBe(false);
    expect(seatIsIn("1465", "12")).toBe(false);
    expect(seatIsIn(undefined, "12")).toBe(false);
  });
});

describe("companyRows", () => {
  it("lists every institution when nothing is filtered, counts filled in", () => {
    const rows = companyRows(places, seats, people);

    expect(ids(rows).sort()).toEqual(["bez", "mpk", "pkp", "szpital"]);
    expect(rows.find((row) => row.id === "pkp")).toEqual({
      id: "pkp",
      name: "PKP INTERCITY (Warszawa)",
      categories: ["koleje"],
      seat: { name: "Warszawa", teryt: "1465" },
      isPublic: true,
      isPublicSource: undefined,
      visibility: undefined,
      people: 3,
      current: 1,
      latestStart: "2024-04-12",
    });
    // Nobody counted there is zero, not missing: the column prints a dash.
    expect(rows.find((row) => row.id === "bez")).toMatchObject({
      people: 0,
      current: 0,
      latestStart: undefined,
    });
  });

  it("keeps the institutions of a sector, whichever shape it is stored in", () => {
    expect(
      ids(companyRows(places, seats, people, { category: "koleje" })),
    ).toEqual(["pkp", "mpk"]);
  });

  it("reads both region filters as the seat, and wants both to hold", () => {
    // `bez` has no seat on record, so no region filter can keep it.
    expect(
      ids(companyRows(places, seats, people, { regions: ["12", null] })),
    ).toEqual(["mpk", "szpital"]);
    expect(
      ids(companyRows(places, seats, people, { regions: ["12", "1261"] })),
    ).toEqual(["mpk"]);
    expect(
      ids(companyRows(places, seats, people, { regions: ["14", "1261"] })),
    ).toEqual([]);
    expect(
      ids(companyRows(places, seats, people, { regions: ["14"] })),
    ).toEqual(["pkp"]);
  });

  it("narrows to the institutions picked by id", () => {
    expect(
      ids(companyRows(places, seats, people, { places: ["szpital", "gone"] })),
    ).toEqual(["szpital"]);
    // An empty pick is no filter, as it is on the people table.
    expect(companyRows(places, seats, people, { places: [] })).toHaveLength(4);
  });

  it("builds the rows before the counts arrive, at zero", () => {
    const rows = companyRows(places, seats, undefined, { category: "koleje" });
    expect(rows.map((row) => row.people)).toEqual([0, 0]);
  });

  it("leaves out an institution merged into another", () => {
    const rows = companyRows(
      { ...places, old: place("STARA NAZWA", { deleted: true }) },
      seats,
      people,
    );
    expect(ids(rows)).not.toContain("old");
  });
});

describe("sortCompanyRows", () => {
  const row = (
    id: string,
    name: string,
    peopleCount: number,
    current: number,
    latestStart?: string,
  ): CompanyRow => ({
    id,
    name,
    categories: [],
    people: peopleCount,
    current,
    latestStart,
  });

  const rows = [
    row("a", "„ZIELONA” SPÓŁKA", 1, 0, "2019-01-01"),
    row("b", "BETA", 5, 2, "2024-04-12"),
    row("c", "ALFA", 1, 1),
    row("d", "ĆMA", 0, 0),
    row("e", "CEZAR", 1, 1, "2025-06-01"),
  ];

  it("opens on the most people, then the most there now, then A to Z", () => {
    expect(ids(sortCompanyRows(rows, undefined))).toEqual([
      "b",
      "c",
      "e",
      "a",
      "d",
    ]);
  });

  it("files a name under its first letter, in Polish order", () => {
    // „ZIELONA” opens on a quotation mark and still sorts under Z, and Ć
    // comes after C rather than with it.
    expect(ids(sortCompanyRows(rows, { key: "name", order: "asc" }))).toEqual([
      "c",
      "b",
      "e",
      "d",
      "a",
    ]);
  });

  it("puts an institution with no dated post last, whichever way", () => {
    const newest = ids(
      sortCompanyRows(rows, { key: "latestStart", order: "desc" }),
    );
    expect(newest.slice(0, 3)).toEqual(["e", "b", "a"]);
    const oldest = ids(
      sortCompanyRows(rows, { key: "latestStart", order: "asc" }),
    );
    expect(oldest.slice(0, 3)).toEqual(["a", "b", "e"]);
    // The undated ones by name at the end either way.
    expect(newest.slice(3)).toEqual(["c", "d"]);
    expect(oldest.slice(3)).toEqual(["c", "d"]);
  });

  it("orders by how many are there now when asked", () => {
    expect(
      ids(sortCompanyRows(rows, { key: "current", order: "desc" })).slice(0, 3),
    ).toEqual(["b", "c", "e"]);
  });

  it("falls back to the default for a key the view does not know", () => {
    // `latestEmploymentStart` is the people table's, carried over by hand.
    expect(companySort({ key: "latestEmploymentStart", order: "asc" })).toEqual(
      { key: "people", order: "desc" },
    );
    expect(
      ids(
        sortCompanyRows(rows, { key: "latestEmploymentStart", order: "asc" }),
      ),
    ).toEqual(ids(sortCompanyRows(rows, undefined)));
  });
});

describe("companyPage", () => {
  it("cuts out one page, numbered from 1", () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ id: String(i) }));
    const page = (n: number, size: number) =>
      companyPage(rows as unknown as CompanyRow[], n, size).map((r) => r.id);

    expect(page(1, 10)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(page(3, 10)).toEqual(["20", "21", "22"]);
    expect(page(4, 10)).toEqual([]);
  });
});
