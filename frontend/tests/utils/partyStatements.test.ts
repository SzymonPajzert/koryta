import { describe, expect, it } from "vitest";
import {
  backerName,
  backingOf,
  backingYears,
  membershipOf,
  partiesOnlyBacked,
} from "../../app/utils/partyStatements";

const run = (fields: Record<string, unknown>) => ({
  type: "election",
  ...fields,
});

describe("backerName", () => {
  it.each([
    [
      "popierany przez organizację: Mareckie Stowarzyszenie Gospodarcze",
      "Mareckie Stowarzyszenie Gospodarcze",
    ],
    [
      "popierana przez partię polityczną: Prawo i Sprawiedliwość",
      "Prawo i Sprawiedliwość",
    ],
    ["pop. przez: KW OBS", "KW OBS"],
    // The 2018 files hold the bare name.
    [
      "Mareckie Stowarzyszenie Gospodarcze",
      "Mareckie Stowarzyszenie Gospodarcze",
    ],
  ])("reads %s as %s", (said, name) => {
    expect(backerName(said)).toBe(name);
  });
});

describe("backingOf", () => {
  it("gives the parties a backing names, and no name beside them", () => {
    expect(
      backingOf(
        run({
          supported_by: "popierana przez partię polityczną: PSL",
          backing_parties: ["PSL"],
        }),
      ),
    ).toEqual({
      parties: ["PSL"],
      name: undefined,
      said: "popierana przez partię polityczną: PSL",
    });
  });

  it("gives the backer's name where it names no party", () => {
    expect(
      backingOf(
        run({ supported_by: "popierany przez organizację: Miasto Jest Nasze" }),
      ),
    ).toMatchObject({ parties: [], name: "Miasto Jest Nasze" });
  });

  it("says nothing where PKW says nothing, or of a job", () => {
    expect(backingOf(run({}))).toBeUndefined();
    expect(
      backingOf({ type: "employed", supported_by: "PSL" }),
    ).toBeUndefined();
  });
});

describe("membershipOf", () => {
  it("leaves out the party the list already names", () => {
    expect(
      membershipOf(run({ party: "PO", member_parties: ["PO", "Nowoczesna"] })),
    ).toEqual(["Nowoczesna"]);
  });

  it("names none where the cell says the candidate belongs to none", () => {
    // PKW wrote a backing into the membership column once.
    expect(
      membershipOf(
        run({
          party_member:
            "nie należy do partii politycznej, popierany przez Sojusz Lewicy Demokratycznej",
          member_parties: ["SLD"],
        }),
      ),
    ).toEqual([]);
  });
});

describe("partiesOnlyBacked", () => {
  it("keeps a party only a backing names", () => {
    expect(
      partiesOnlyBacked([
        run({ party: "PO", backing_parties: ["PSL"] }),
        run({ party: "PO" }),
      ]),
    ).toEqual(new Set(["PSL"]));
  });

  it("drops one a list or a membership names too", () => {
    expect(
      partiesOnlyBacked([
        run({ backing_parties: ["PO", "Nowoczesna"] }),
        run({ party: "PO" }),
        run({ member_parties: ["Nowoczesna"] }),
      ]),
    ).toEqual(new Set());
  });

  it("counts a backing written into the membership column as no membership", () => {
    expect(
      partiesOnlyBacked([
        run({ backing_parties: ["SLD"] }),
        run({
          party_member:
            "nie należy do partii politycznej, popierany przez Sojusz Lewicy Demokratycznej",
          member_parties: ["SLD"],
        }),
      ]),
    ).toEqual(new Set(["SLD"]));
  });
});

describe("backingYears", () => {
  it("gives each year a party backed a run, once and in order", () => {
    expect(
      backingYears(
        [
          run({ start_date: "2018-01-01", backing_parties: ["PSL"] }),
          run({ start_date: "2006-01-01", backing_parties: ["PSL", "PO"] }),
          run({ start_date: "2018-01-01", backing_parties: ["PSL"] }),
          run({ start_date: "2010-01-01", backing_parties: ["PO"] }),
        ],
        "PSL",
      ),
    ).toEqual(["2006", "2018"]);
  });
});
