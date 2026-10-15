import { describe, it, expect } from "vitest";
import { candidacyDay } from "../../shared/electionDays";
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

  it("dates every election to a real day of its own year", () => {
    // Guards the table against a typo: each day it holds is a calendar day of
    // the year it is filed under.
    for (let year = 1985; year <= 2030; year++) {
      for (const position of [...electionPositions, undefined]) {
        const day = candidacyDay(`${year}-01-01`, position);
        if (day === `${year}-01-01`) continue;
        expect(isoDay(day), `${position} ${year}: ${day}`).not.toBeNull();
        expect(day.startsWith(`${year}-`), `${position} ${year}`).toBe(true);
      }
    }
  });
});
