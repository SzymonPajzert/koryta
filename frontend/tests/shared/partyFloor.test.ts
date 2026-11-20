import { describe, it, expect } from "vitest";
import { OTHER_PARTY } from "../../shared/misc";
import {
  partiesAfterImport,
  partyFloor,
  showsCandidacyAndPaidPost,
} from "../../shared/partyFloor";

/** A councillor's run on a KWW list, and a seat on the board of the gmina's
 * water company: what Anna Jedynak-Rykała's page showed with no party. */
const run = {
  type: "election" as const,
  target: "teryt2475",
  name: "kandydatura",
  published: true,
};
const board = {
  type: "employed" as const,
  target: "wodociagi",
  name: "Zarząd",
  published: true,
};
const companies: Record<
  string,
  { isPublic?: boolean; supervisoryBody?: string }
> = {
  wodociagi: { isPublic: true },
  prywatna: { isPublic: false },
  szpital: { isPublic: true, supervisoryBody: "rada-spoleczna" },
};
const companyOf = (id: string) => companies[id];

describe("showsCandidacyAndPaidPost", () => {
  it("is a live run beside a live paid post at a public company", () => {
    expect(showsCandidacyAndPaidPost([run, board], companyOf)).toBe(true);
  });

  it("wants both", () => {
    expect(showsCandidacyAndPaidPost([run], companyOf)).toBe(false);
    expect(showsCandidacyAndPaidPost([board], companyOf)).toBe(false);
  });

  it("counts neither a draft nor a removed relation", () => {
    expect(
      showsCandidacyAndPaidPost(
        [{ ...run, published: false }, board],
        companyOf,
      ),
    ).toBe(false);
    expect(
      showsCandidacyAndPaidPost([run, { ...board, deleted: true }], companyOf),
    ).toBe(false);
  });

  it("counts no job at a private company, nor a seat nobody is paid for", () => {
    expect(
      showsCandidacyAndPaidPost(
        [run, { ...board, target: "prywatna" }],
        companyOf,
      ),
    ).toBe(false);
    expect(
      showsCandidacyAndPaidPost(
        [run, { ...board, target: "szpital", name: "Rada Nadzorcza" }],
        companyOf,
      ),
    ).toBe(false);
    expect(
      showsCandidacyAndPaidPost(
        [run, { ...board, target: "nieznana" }],
        companyOf,
      ),
    ).toBe(false);
  });
});

describe("partyFloor", () => {
  it("is „Inne” on a page that names no party", () => {
    expect(partyFloor({})).toEqual([OTHER_PARTY]);
    expect(partyFloor({ parties: [] })).toEqual([OTHER_PARTY]);
    expect(partyFloor({ parties: null })).toEqual([OTHER_PARTY]);
  });

  it("leaves a page that names one, in the old numbered shape too", () => {
    expect(partyFloor({ parties: ["PSL"] })).toBeNull();
    expect(partyFloor({ parties: { 0: "PiS" } })).toBeNull();
    expect(partyFloor({ parties: [OTHER_PARTY] })).toBeNull();
  });

  it("leaves a list a person set, an empty one too", () => {
    expect(partyFloor({ parties: [], partiesSource: "manual" })).toBeNull();
  });
});

describe("partiesAfterImport", () => {
  it("is the union, named parties first", () => {
    expect(partiesAfterImport(["PO"], ["PiS"])).toEqual(["PO", "PiS"]);
    expect(partiesAfterImport(["PiS"], [OTHER_PARTY])).toEqual([
      "PiS",
      OTHER_PARTY,
    ]);
    expect(partiesAfterImport([], [])).toEqual([]);
  });

  it("lets a lone „Inne” give way to the parties the payload names", () => {
    expect(partiesAfterImport([OTHER_PARTY], ["PSL"])).toEqual(["PSL"]);
  });

  it("keeps „Inne” the payload names, or where it names nothing", () => {
    expect(partiesAfterImport([OTHER_PARTY], ["PSL", OTHER_PARTY])).toEqual([
      "PSL",
      OTHER_PARTY,
    ]);
    expect(partiesAfterImport([OTHER_PARTY], [])).toEqual([OTHER_PARTY]);
  });

  it("keeps „Inne” beside a named party it already stood with", () => {
    expect(partiesAfterImport(["PO", OTHER_PARTY], ["PiS"])).toEqual([
      "PO",
      "PiS",
      OTHER_PARTY,
    ]);
  });
});
