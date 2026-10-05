import { describe, expect, it } from "vitest";
import roleClaims from "~~/shared/roleClaims.json";
import {
  claimsFor,
  describeRole,
  levelClaims,
  roleFromClaims,
  roleLevels,
  roleLosesClaims,
  sameRoleState,
} from "~~/shared/roles";
import { HANDLE_PATTERN, isValidHandle } from "~~/shared/userAdmin";

describe("levelClaims", () => {
  it("is the ladder the claims script is tested against", () => {
    expect(levelClaims).toEqual(roleClaims);
  });
});

describe("claimsFor", () => {
  it("accumulates the levels", () => {
    expect(claimsFor({ level: "normal", trial: false })).toEqual({});
    expect(claimsFor({ level: "trusted", trial: false })).toEqual({
      trusted: true,
    });
    expect(claimsFor({ level: "datascience", trial: false })).toEqual({
      trusted: true,
      datascience: true,
    });
    expect(claimsFor({ level: "admin", trial: false })).toEqual({
      trusted: true,
      datascience: true,
      admin: true,
    });
  });

  it("adds newAdmin and owner only to an administrator", () => {
    expect(claimsFor({ level: "admin", trial: true }, { owner: true })).toEqual(
      {
        trusted: true,
        datascience: true,
        admin: true,
        newAdmin: true,
        owner: true,
      },
    );
    expect(
      claimsFor({ level: "datascience", trial: true }, { owner: true }),
    ).toEqual({ trusted: true, datascience: true });
  });
});

describe("roleFromClaims", () => {
  it("reads back every level claimsFor writes", () => {
    for (const level of roleLevels) {
      for (const trial of [false, true]) {
        const state = { level, trial: level === "admin" && trial };
        expect(roleFromClaims(claimsFor(state))).toEqual({
          ...state,
          owner: false,
        });
      }
    }
  });

  it("takes the highest claim present, and ignores stray modifiers", () => {
    expect(roleFromClaims({ admin: true })).toEqual({
      level: "admin",
      trial: false,
      owner: false,
    });
    expect(roleFromClaims({ newAdmin: true, owner: true })).toEqual({
      level: "normal",
      trial: false,
      owner: false,
    });
    expect(roleFromClaims(undefined).level).toBe("normal");
  });
});

describe("roleLosesClaims", () => {
  const role = (level: (typeof roleLevels)[number], trial = false) => ({
    level,
    trial,
    owner: false,
  });

  it("is true for any demotion and false for a promotion", () => {
    expect(roleLosesClaims(role("admin"), role("datascience"))).toBe(true);
    expect(roleLosesClaims(role("datascience"), role("admin"))).toBe(false);
    expect(roleLosesClaims(role("trusted"), role("normal"))).toBe(true);
    // A trial administrator demoted loses `admin` with the trial.
    expect(roleLosesClaims(role("admin", true), role("datascience"))).toBe(
      true,
    );
  });

  // `newAdmin` takes nothing away from anybody who loses it: it only narrows
  // what an administrator sees. Ending a trial is a promotion, and revoking
  // the graduate's sessions would sign them out of the tab in which they were
  // just told the page refreshes by itself.
  it("does not count the end of a trial as a loss", () => {
    expect(roleLosesClaims(role("admin", true), role("admin"))).toBe(false);
    expect(roleLosesClaims(role("admin"), role("admin", true))).toBe(false);
  });

  it("counts the owner's claim as one to lose", () => {
    expect(
      roleLosesClaims(
        { level: "admin", trial: false, owner: true },
        role("admin"),
      ),
    ).toBe(true);
  });
});

describe("sameRoleState", () => {
  it("ignores trial below admin", () => {
    expect(
      sameRoleState(
        { level: "datascience", trial: true },
        { level: "datascience", trial: false },
      ),
    ).toBe(true);
  });
});

describe("describeRole", () => {
  it("names the owner, the trial and the levels", () => {
    expect(describeRole({ level: "admin", trial: false, owner: true })).toBe(
      "Właściciel serwisu",
    );
    expect(describeRole({ level: "admin", trial: true })).toBe(
      "Administrator (okres próbny)",
    );
    expect(describeRole({ level: "datascience", trial: false })).toBe("Zespół");
  });
});

describe("handles", () => {
  it("accepts slugs of 3-30 characters", () => {
    expect(isValidHandle("ala")).toBe(true);
    expect(isValidHandle("jan-kowalski-2")).toBe(true);
    expect(isValidHandle("a".repeat(30))).toBe(true);
  });

  it("refuses everything else", () => {
    for (const bad of [
      "ab",
      "a".repeat(31),
      "-ala",
      "ala-",
      "ala--ma",
      "Ala",
      "żaba",
      "ala ma",
      "admin",
      "redakcja",
    ]) {
      expect(isValidHandle(bad), bad).toBe(false);
    }
    expect(HANDLE_PATTERN.test("ab")).toBe(false);
  });
});
