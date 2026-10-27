import { describe, it, expect } from "vitest";
import {
  candidacyDay,
  candidacyElection,
  electionKindsIn,
  electionName,
  electionOptions,
} from "../../shared/electionDays";
import { isoDay } from "../../shared/dates";
import { electionPositions } from "../../shared/misc";

describe("candidacyDay", () => {
  it("dates a European candidacy to the European election, not the Sejm's", () => {
    // Paweł Kobyliński's 2019 run (xFCwXT4EuQUrjyN532Zt), shown on 13 October
    // until the day was looked up by the office as well as the year.
    expect(candidacyDay("2019-01-01", "Parlament Europejski")).toBe(
      "2019-05-26",
    );
    expect(candidacyDay("2019-01-01", "Sejm")).toBe("2019-10-13");
    expect(candidacyDay("2019-01-01", "Senat")).toBe("2019-10-13");
  });

  it("tells the European election from the local one in the years of both", () => {
    expect(candidacyDay("2014-01-01", "Parlament Europejski")).toBe(
      "2014-05-25",
    );
    expect(candidacyDay("2014-01-01", "Samorząd")).toBe("2014-11-16");
    expect(candidacyDay("2024-01-01", "Parlament Europejski")).toBe(
      "2024-06-09",
    );
    expect(candidacyDay("2024-01-01", "Samorząd")).toBe("2024-04-07");
  });

  it("dates 2010's local candidacies to the local election", () => {
    // Not to 20 June, the presidential election's day, which the site has no
    // candidacy in.
    expect(candidacyDay("2010-01-01", "Samorząd")).toBe("2010-11-21");
    expect(candidacyDay("2010-01-01")).toBe("2010-11-21");
  });

  it("reads every local office as the local election", () => {
    for (const office of [
      "Sejmik",
      "Rada miasta",
      "Rada gminy",
      "Rada powiatu",
      "Burmistrz",
      "Wójt",
      // A city's prezydent, the only one the site holds.
      "Prezydent",
    ]) {
      expect(candidacyDay("2024-01-01", office)).toBe("2024-04-07");
    }
  });

  describe("a candidacy stored without its office", () => {
    it("is taken for the Sejm's before the European one", () => {
      // 35 of the 42 of 2019 are in PKW's Sejm or Senate lists.
      expect(candidacyDay("2019-01-01")).toBe("2019-10-13");
      expect(candidacyDay("2019-01-01", "")).toBe("2019-10-13");
      expect(candidacyDay("2019-01-01", null)).toBe("2019-10-13");
    });

    it("is taken for the local one before the European one", () => {
      expect(candidacyDay("2014-01-01")).toBe("2014-11-16");
      expect(candidacyDay("2024-01-01")).toBe("2024-04-07");
    });

    it("is the year's only election where there was one", () => {
      expect(candidacyDay("2004-01-01")).toBe("2004-06-13");
      expect(candidacyDay("2023-01-01")).toBe("2023-10-15");
      expect(candidacyDay("2018-01-01")).toBe("2018-10-21");
    });
  });

  it("dates a bare year the way it dates the ingest's", () => {
    // What the edit form stores when a year is all the reader typed.
    expect(candidacyDay("2019", "Parlament Europejski")).toBe("2019-05-26");
    expect(candidacyDay("2001", "")).toBe("2001-09-23");
  });

  it("keeps a date that names a day or a month", () => {
    // A reviewer's correction, a run-off and a by-election typed in by hand:
    // each says when, and none of them is the year's first round.
    expect(candidacyDay("2019-05-26", "Sejm")).toBe("2019-05-26");
    expect(candidacyDay("2024-04-21", "Burmistrz")).toBe("2024-04-21");
    expect(candidacyDay("2022-04-08", "")).toBe("2022-04-08");
    expect(candidacyDay("2010-11", "")).toBe("2010-11");
  });

  it("leaves a by-election at its year", () => {
    // Held on a day of its own, which a year does not say.
    expect(candidacyDay("2019-01-01", "Senat", true)).toBe("2019");
    expect(candidacyDay("2019-01-01", "Senat", false)).toBe("2019-10-13");
  });

  it("leaves a year at the year when no election of the kind was held in it", () => {
    // The first of January would be a day nobody voted on.
    expect(candidacyDay("2027-01-01", "Sejm")).toBe("2027");
    expect(candidacyDay("2014-01-01", "Sejm")).toBe("2014");
    expect(candidacyDay("2022-01-01")).toBe("2022");
  });

  it("dates every election to a real day of its own year", () => {
    // Guards the table against a typo: each day it holds is a calendar day of
    // the year it is filed under, and never the first of January.
    for (let year = 1985; year <= 2030; year++) {
      for (const position of [...electionPositions, undefined]) {
        const day = candidacyDay(`${year}-01-01`, position);
        if (day === String(year)) continue;
        expect(isoDay(day), `${position} ${year}: ${day}`).not.toBeNull();
        expect(day.startsWith(`${year}-`), `${position} ${year}`).toBe(true);
        expect(day, `${position} ${year}`).not.toBe(`${year}-01-01`);
      }
    }
  });
});

describe("electionKindsIn", () => {
  it("names the one election of most years", () => {
    expect(electionKindsIn("2023")).toEqual(["parliament"]);
    expect(electionKindsIn("2009")).toEqual(["european"]);
    expect(electionKindsIn("2018")).toEqual(["local"]);
  });

  it("names both elections of the years that held two", () => {
    expect(electionKindsIn("2019").sort()).toEqual(["european", "parliament"]);
    expect(electionKindsIn("2014").sort()).toEqual(["european", "local"]);
    expect(electionKindsIn("2024").sort()).toEqual(["european", "local"]);
  });

  it("names none in a year without an election the site records", () => {
    // 2020 and 2025 held presidential elections, which the site has no
    // candidacy in.
    expect(electionKindsIn("2020")).toEqual([]);
    expect(electionKindsIn("2025")).toEqual([]);
  });
});

describe("candidacyElection", () => {
  it("files a run under the kind and the year of its election", () => {
    expect(candidacyElection("2023-01-01", "Sejm")).toBe("parliament-2023");
    expect(candidacyElection("2023-01-01", "Senat")).toBe("parliament-2023");
    expect(candidacyElection("2018-01-01", "Rada miasta")).toBe("local-2018");
    expect(candidacyElection("2018-01-01", "Samorząd")).toBe("local-2018");
    expect(candidacyElection("2019-01-01", "Parlament Europejski")).toBe(
      "european-2019",
    );
  });

  /** The same reading `candidacyDay` gives, so a person listed under an
   * election is one whose page dates the run to that election's day. */
  it("files a run stored without an office the way its page dates it", () => {
    expect(candidacyElection("2023-01-01", null)).toBe("parliament-2023");
    expect(candidacyElection("2019-01-01", null)).toBe("parliament-2019");
    expect(candidacyElection("2024-01-01", "")).toBe("local-2024");
    expect(candidacyElection("2004-01-01", undefined)).toBe("european-2004");
  });

  it("counts a date that names a day by its year", () => {
    // A mayor's run-off, typed in by a reviewer.
    expect(candidacyElection("2024-04-21", "Prezydent")).toBe("local-2024");
    expect(candidacyElection("2023", "Sejm")).toBe("parliament-2023");
  });

  it("names no election where there was none to stand in", () => {
    // A by-election is a contest of its own.
    expect(candidacyElection("2023-01-01", "Senat", true)).toBeNull();
    // No Sejm was elected in 2006, and nothing at all in 2022.
    expect(candidacyElection("2006-01-01", "Sejm")).toBeNull();
    expect(candidacyElection("2022-01-01", null)).toBeNull();
    expect(candidacyElection(undefined, "Sejm")).toBeNull();
    expect(candidacyElection("", "Sejm")).toBeNull();
  });
});

describe("electionOptions", () => {
  /** Szymon's pick on the design board (election-filter-r1, 2026-10-27):
   * the chamber as the name, one line, newest first. */
  it("offers every election newest first, by what it elected", () => {
    expect(electionOptions.slice(0, 4).map((option) => option.title)).toEqual([
      "Parlament Europejski 2024",
      "Samorządowe 2024",
      "Sejm i Senat 2023",
      // October's Sejm after May's European Parliament: by day, not by kind.
      "Sejm i Senat 2019",
    ]);
    expect(electionOptions.at(-1)!.title).toBe("Sejm i Senat 1989");
  });

  it("offers each election once, under a key the stats can hold", () => {
    const values = electionOptions.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    for (const { value, title } of electionOptions) {
      expect(electionName(value)).toBe(title);
    }
  });
});

describe("electionName", () => {
  it("names a key the way the menu does", () => {
    expect(electionName("parliament-2023")).toBe("Sejm i Senat 2023");
    expect(electionName("local-2024")).toBe("Samorządowe 2024");
  });

  it("names nothing the list does not offer", () => {
    expect(electionName("sejm-2025")).toBeNull();
    expect(electionName("parliament-2006")).toBeNull();
    expect(electionName("")).toBeNull();
  });
});
