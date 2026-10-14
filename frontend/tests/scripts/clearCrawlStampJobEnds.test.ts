import { describe, it, expect } from "vitest";
// The class `firebase-admin/firestore` re-exports. Imported from its source
// because under the Nuxt test environment firebase-admin's lazy exports read
// as undefined.
import { Timestamp } from "@google-cloud/firestore";
import {
  dayOf,
  decide,
  exactCopies,
  parseRegister,
  type Case,
  type RegisterRow,
  type RevisionFacts,
  type SpellFacts,
} from "../../scripts/migrate/clear-crawl-stamp-job-ends";

const KRS = "0000123456";
const STAMP = "2026-04-06";

/** A register row of entry 111 at the company: a board seat since 2020 that
 * the register lists as current. */
function row(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    krs: KRS,
    entry: "rejestr.io/111",
    rejestrId: "111",
    fullName: "JAN KOWALSKI",
    firstName: "JAN",
    lastName: "KOWALSKI",
    birthDate: "1970-01-01",
    role: "Zarząd",
    start: "2020-01-01",
    end: null,
    ...overrides,
  };
}

/** What the uploader wrote: the creation revision, carrying the stamp. */
const UPLOAD: RevisionFacts = {
  updateTime: Date.parse("2026-05-11"),
  automatic: true,
  updateUser: "of0BKlwq",
  end: STAMP,
};

/** A stamped board seat on a page linking rejestr.io entry 111. */
function stamped(overrides: Partial<Case> = {}): Case {
  return {
    edge: {
      id: "e1",
      source: "p1",
      name: "Zarząd",
      start_date: "2020-01-01",
      end_date: STAMP,
      removed: false,
    },
    person: {
      name: "Jan Kowalski",
      rejestrIo: "https://rejestr.io/osoby/111",
      gone: false,
    },
    company: { krs: KRS, gone: false },
    revisions: [UPLOAD],
    rows: [row()],
    siblings: [],
    ...overrides,
  };
}

/** The same, on a page with no rejestr.io link. */
function unlinked(name: string, overrides: Partial<Case> = {}): Case {
  const base = stamped(overrides);
  return { ...base, person: { name, gone: false, ...overrides.person } };
}

describe("decide", () => {
  it("removes the end the register lists as current", () => {
    expect(decide(stamped())).toEqual({
      action: "clear",
      via: "rejestr.io id",
    });
  });

  it("writes the register's end where it gives another", () => {
    const rows = [row({ end: "2026-07-17" })];
    expect(decide(stamped({ rows }))).toEqual({
      action: "rewrite",
      end: "2026-07-17",
      via: "rejestr.io id",
    });
  });

  it("writes an end before the stamp as well", () => {
    const rows = [row({ start: "2001-05-28", end: "2003-08-11" })];
    const input = stamped({ rows });
    const edge = { ...input.edge, start_date: "2001-05-28" };
    expect(decide({ ...input, edge })).toMatchObject({
      action: "rewrite",
      end: "2003-08-11",
    });
  });

  it("leaves a real end on the stamp day", () => {
    const rows = [row({ end: STAMP })];
    expect(decide(stamped({ rows }))).toEqual({
      action: "leave",
      reason: "real end",
    });
  });

  it("is none of its business when the end is not a stamp", () => {
    for (const end_date of ["2026-04-07", "", null, undefined]) {
      const input = stamped();
      expect(decide({ ...input, edge: { ...input.edge, end_date } })).toBe(
        undefined,
      );
    }
  });

  it("leaves a removed edge", () => {
    const input = stamped();
    expect(
      decide({ ...input, edge: { ...input.edge, removed: true } }),
    ).toEqual({ action: "leave", reason: "removed" });
  });

  it("leaves an edge whose page is gone", () => {
    const input = stamped();
    expect(
      decide({ ...input, person: { ...input.person!, gone: true } }),
    ).toEqual({ action: "leave", reason: "page gone" });
    expect(decide({ ...input, company: undefined })).toEqual({
      action: "leave",
      reason: "page gone",
    });
  });

  it("leaves an edge with a person's proposal waiting for a reviewer", () => {
    const proposal: RevisionFacts = {
      updateTime: Date.parse("2026-09-06"),
      automatic: false,
      updateUser: "7bu9zrX4",
      status: "pending",
      end: null,
    };
    expect(decide(stamped({ revisions: [UPLOAD, proposal] }))).toEqual({
      action: "leave",
      reason: "pending human proposal",
    });
  });

  it("does not count its own or the pipeline's pending revisions as a person's", () => {
    const own: RevisionFacts = {
      updateTime: Date.parse("2026-10-15"),
      automatic: true,
      updateUser: "migration:clear-crawl-stamp-job-ends",
      status: "pending",
      end: STAMP,
    };
    const pipeline: RevisionFacts = { ...UPLOAD, status: "pending" };
    expect(decide(stamped({ revisions: [pipeline, own] }))).toMatchObject({
      action: "clear",
    });
  });

  it("leaves a stamp a person entered", () => {
    const typed: RevisionFacts = {
      updateTime: Date.parse("2026-06-01"),
      automatic: false,
      updateUser: "someone",
      status: "approved",
      end: STAMP,
    };
    const created = { ...UPLOAD, end: null };
    expect(decide(stamped({ revisions: [created, typed] }))).toEqual({
      action: "leave",
      reason: "entered by a person",
    });
  });

  it("does not take a person restating the stamp for entering it", () => {
    const edit: RevisionFacts = {
      updateTime: Date.parse("2026-06-01"),
      automatic: false,
      updateUser: "someone",
      status: "approved",
      end: STAMP,
    };
    expect(decide(stamped({ revisions: [UPLOAD, edit] }))).toMatchObject({
      action: "clear",
    });
  });

  it("leaves an edge the register has no row for", () => {
    expect(
      decide(
        stamped({
          rows: [
            row({
              rejestrId: "999",
              entry: "rejestr.io/999",
              fullName: "ADAM NOWAK",
              firstName: "ADAM",
              lastName: "NOWAK",
            }),
          ],
        }),
      ),
    ).toEqual({
      action: "leave",
      reason: "no evidence: not at the company",
    });
    expect(decide(stamped({ rows: undefined }))).toEqual({
      action: "leave",
      reason: "no evidence: company not in the register",
    });
    expect(
      decide(stamped({ company: { krs: undefined, gone: false } })),
    ).toEqual({ action: "leave", reason: "no evidence: company has no KRS" });
  });

  it("leaves a spell the register has under another role or start", () => {
    for (const other of [
      row({ role: "Prokurent" }),
      row({ start: "2019-06-30" }),
    ]) {
      expect(decide(stamped({ rows: [other] }))).toEqual({
        action: "leave",
        reason: "no evidence: role or start differs",
      });
    }
  });

  it("matches an unlinked page by its full name", () => {
    const input = unlinked("Jan Kowalski");
    expect(decide(input)).toEqual({ action: "clear", via: "name" });
  });

  it("matches an unlinked page carrying a middle name by its words", () => {
    const rows = [row({ end: "2026-07-17" })];
    expect(decide(unlinked("Jan Adam Kowalski", { rows }))).toEqual({
      action: "rewrite",
      end: "2026-07-17",
      via: "name words",
    });
  });

  it("matches a hyphenated surname word by word, in any case", () => {
    const rows = [
      row({
        fullName: "ANNA NOWAK-KOWALSKA",
        firstName: "ANNA",
        lastName: "NOWAK-KOWALSKA",
      }),
    ];
    expect(decide(unlinked("Anna Maria Nowak-Kowalska", { rows }))).toEqual({
      action: "clear",
      via: "name words",
    });
  });

  it("needs the birth date to agree where the unlinked page has one", () => {
    const born = (birthDate: string) =>
      decide(
        unlinked("Jan Kowalski", {
          person: { name: "Jan Kowalski", birthDate, gone: false },
        }),
      );
    expect(born("1970-01-01")).toEqual({ action: "clear", via: "name" });
    expect(born("1981-05-05")).toEqual({
      action: "leave",
      reason: "no evidence: not at the company",
    });
  });

  it("does not match an unlinked page whose name fits two entries", () => {
    const rows = [
      row(),
      row({
        entry: "rejestr.io/222",
        rejestrId: "222",
        fullName: "JAN ADAM KOWALSKI",
      }),
    ];
    expect(decide(unlinked("Jan Adam Kowalski", { rows }))).toEqual({
      action: "leave",
      reason: "no evidence: name fits two entries",
    });
  });

  it("matches an odpis-only entry, which has no rejestr.io id, by name", () => {
    const rows = [row({ entry: "odpis/abc", rejestrId: null })];
    expect(decide(unlinked("Jan Kowalski", { rows }))).toEqual({
      action: "clear",
      via: "name",
    });
  });

  it("never matches a page linking another entry by name", () => {
    // The page links 333; the register's only fitting row is 444's,
    // a namesake. One entry is one person, so that row says nothing about
    // this page.
    const rows = [row({ entry: "rejestr.io/444", rejestrId: "444" })];
    const input = stamped({ rows });
    expect(
      decide({
        ...input,
        person: {
          ...input.person!,
          rejestrIo: "https://rejestr.io/osoby/333",
        },
      }),
    ).toEqual({
      action: "leave",
      reason: "no evidence: page links another entry",
    });
  });

  it("reads a link pasted with the person's name after the number", () => {
    const input = stamped();
    expect(
      decide({
        ...input,
        person: {
          ...input.person!,
          rejestrIo: "https://rejestr.io/osoby/111/jan-kowalski",
        },
      }),
    ).toEqual({ action: "clear", via: "rejestr.io id" });
  });

  it("leaves an old spell whose person's open spell has no edge", () => {
    // Collapsed-era: the edge has the first spell's start and the stamp stood
    // for "still held". The later spell is open and nothing carries it.
    const rows = [
      row({ start: "2007-03-29", end: "2009-01-06" }),
      row({ start: "2011-01-13", end: null }),
    ];
    const input = stamped({ rows });
    const edge = { ...input.edge, start_date: "2007-03-29" };
    expect(decide({ ...input, edge })).toEqual({
      action: "leave",
      reason: "open spell has no edge",
    });
  });

  it("writes the old spell's end once an edge carries the open one", () => {
    const rows = [
      row({ start: "2007-03-29", end: "2009-01-06" }),
      row({ start: "2011-01-13", end: null }),
    ];
    const carried = {
      id: "e2",
      source: "p2",
      name: "Zarząd",
      start_date: "2011-01-13",
      // Another page of the same entry: still the same person.
      pageEntry: "111",
    };
    const input = stamped({ rows, siblings: [carried] });
    const edge = { ...input.edge, start_date: "2007-03-29" };
    expect(decide({ ...input, edge })).toEqual({
      action: "rewrite",
      end: "2009-01-06",
      via: "rejestr.io id",
    });
  });

  it("does not take a namesake's edge for the open spell", () => {
    const rows = [
      row({ start: "2007-03-29", end: "2009-01-06" }),
      row({ start: "2011-01-13", end: null }),
    ];
    const namesake = {
      id: "e3",
      source: "p3",
      name: "Zarząd",
      start_date: "2011-01-13",
      pageEntry: "222",
    };
    const input = stamped({ rows, siblings: [namesake] });
    const edge = { ...input.edge, start_date: "2007-03-29" };
    expect(decide({ ...input, edge })).toMatchObject({
      reason: "open spell has no edge",
    });
  });

  it("leaves a spell the register gives two ends for", () => {
    const rows = [row({ end: "2024-01-01" }), row({ end: null })];
    expect(decide(stamped({ rows }))).toEqual({
      action: "leave",
      reason: "register disagrees",
    });
  });

  it("does not write an end before the edge's start", () => {
    const rows = [row({ start: "2020-01-01", end: "2019-12-31" })];
    expect(decide(stamped({ rows }))).toEqual({
      action: "leave",
      reason: "end before start",
    });
  });

  it("reads end_date stored as a Timestamp as the Warsaw day", () => {
    // Midnight 2026-04-06 in Warsaw (CEST) is 22:00 UTC the evening before.
    const midnight = Timestamp.fromDate(new Date("2026-04-05T22:00:00Z"));
    const input = stamped();
    expect(
      decide({ ...input, edge: { ...input.edge, end_date: midnight } }),
    ).toEqual({ action: "clear", via: "rejestr.io id" });
    expect(
      decide({
        ...input,
        edge: { ...input.edge, end_date: "2026-04-06T00:00:00Z" },
      }),
    ).toEqual({ action: "clear", via: "rejestr.io id" });
  });
});

describe("dayOf", () => {
  it("reads text, Timestamps and Dates as a day, and blanks as none", () => {
    expect(dayOf("2026-03-18")).toBe("2026-03-18");
    expect(dayOf(" 2026-03-18T10:00:00Z")).toBe("2026-03-18");
    expect(dayOf(Timestamp.fromDate(new Date("2026-03-17T23:00:00Z")))).toBe(
      "2026-03-18",
    );
    expect(dayOf(new Date("2026-03-18T12:00:00Z"))).toBe("2026-03-18");
    for (const blank of ["", null, undefined, false, "2022", 5]) {
      expect(dayOf(blank)).toBe(null);
    }
  });
});

describe("exactCopies", () => {
  const spell = (id: string, end_date: string | undefined): SpellFacts => ({
    id,
    source: "p1",
    target: "c1",
    name: "Zarząd",
    start_date: "2001-05-28",
    end_date,
    removed: false,
  });

  it("lists an edge whose new end makes it its sibling's twin", () => {
    const edges = [spell("a", STAMP), spell("b", "2003-08-11")];
    expect(exactCopies(edges, new Map([["a", "2003-08-11"]]))).toEqual([
      { id: "a", copyOf: "b" },
    ]);
  });

  it("compares with the sibling's end after the run, not before", () => {
    const edges = [spell("a", STAMP), spell("b", "2026-03-18")];
    const newEnds = new Map<string, string | null>([
      ["a", null],
      ["b", null],
    ]);
    expect(exactCopies(edges, newEnds)).toEqual([
      { id: "a", copyOf: "b" },
      { id: "b", copyOf: "a" },
    ]);
  });

  it("ignores a different end, an unchanged edge and a removed sibling", () => {
    const removed = { ...spell("c", "2003-08-11"), removed: true };
    const edges = [spell("a", STAMP), spell("b", "2005-01-01"), removed];
    expect(exactCopies(edges, new Map([["a", "2003-08-11"]]))).toEqual([]);
  });
});

describe("parseRegister", () => {
  it("reads the producer's rows and skips anything else", () => {
    const text = [
      "Downloading files: 4it",
      JSON.stringify({
        krs: "123456",
        entry: "rejestr.io/111",
        rejestrId: "111",
        fullName: "JAN KOWALSKI",
        firstName: "JAN",
        lastName: "KOWALSKI",
        birthDate: null,
        role: "Zarząd",
        start: "2020-01-01",
        end: null,
      }),
      "{not json",
      JSON.stringify({ krs: "1", role: "Zarząd" }),
    ].join("\r\n");
    expect(parseRegister(text)).toEqual([
      row({ krs: "0000123456", birthDate: null }),
    ]);
  });
});
