import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  PLAN,
  REASONS,
  SITE_INSTANTS,
  STAMP,
  corrections,
  direction,
  formatPlan,
  honestDate,
  isStamp,
  parsePlan,
  type NodeRow,
  type PlanRow,
} from "../../scripts/migrate/correct-10-24-stamp";
import {
  pagesChangedOn1007,
  pagesWithRelations,
  planFor,
} from "../../scripts/migrate/correct-10-24-stamp/build-plan";
import { SITE_CHANGES } from "../../scripts/migrate/stamp-site-changes";

describe("isStamp", () => {
  it("takes the exact string the stamp stored and nothing else", () => {
    expect(isStamp("2026-10-24T14:08:20.000Z")).toBe(true);
    // The same instant written another way was not written by the stamp.
    expect(isStamp("2026-10-24T14:08:20Z")).toBe(false);
    expect(isStamp({ _seconds: 1792850900, _nanoseconds: 0 })).toBe(false);
    expect(isStamp("2026-10-24T14:08:20.001Z")).toBe(false);
    expect(isStamp("2026-10-24T21:46:02.000Z")).toBe(false);
    expect(isStamp(undefined)).toBe(false);
    expect(isStamp(null)).toBe(false);
  });
});

describe("honestDate", () => {
  it("takes the newest instant that applies, with its reason", () => {
    expect(
      honestDate([
        { reason: "own", at: "2026-08-22T20:45:26.912Z" },
        { reason: "links-0918", at: SITE_INSTANTS["links-0918"] },
        { reason: "snippets-1024", at: undefined },
        { reason: "board-1024", at: null },
      ]),
    ).toEqual({ target: "2026-09-18T21:30:38.000Z", reason: "links-0918" });
  });

  it("raises a page whose description changed after the stamp", () => {
    expect(
      honestDate([
        { reason: "own", at: "2026-10-06T10:34:23.567Z" },
        { reason: "snippets-1024", at: SITE_INSTANTS["snippets-1024"] },
      ]),
    ).toEqual({ target: "2026-10-24T15:20:13.600Z", reason: "snippets-1024" });
  });

  it("compares instants, not strings, and writes them as toISOString does", () => {
    expect(
      honestDate([
        { reason: "own", at: "2026-10-24T21:46:02.5Z" },
        { reason: "board-1024", at: "2026-10-24T21:46:02Z" },
      ]),
    ).toEqual({ target: "2026-10-24T21:46:02.500Z", reason: "own" });
  });

  it("settles a tie on the reason listed first", () => {
    expect(
      honestDate([
        { reason: "board-1024", at: "2026-10-24T21:46:02.000Z" },
        { reason: "own", at: "2026-10-24T21:46:02.000Z" },
      ]),
    ).toEqual({ target: "2026-10-24T21:46:02.000Z", reason: "own" });
  });

  it("has nothing to say when nothing applies", () => {
    expect(honestDate([{ reason: "own", at: undefined }])).toBeUndefined();
    expect(honestDate([])).toBeUndefined();
  });

  it("refuses a value that is not an instant", () => {
    expect(() => honestDate([{ reason: "own", at: "wczoraj" }])).toThrow(
      /not an instant/,
    );
  });
});

describe("plan file", () => {
  const rows: PlanRow[] = [
    { id: "b", target: "2026-10-24T21:46:02.000Z", reason: "board-1024" },
    { id: "a", target: "2026-08-22T20:45:26.912Z", reason: "own" },
  ];

  it("round-trips, sorted by id", () => {
    const text = formatPlan(rows);
    expect(text.split("\n")[1]).toBe("a,2026-08-22T20:45:26.912Z,own");
    expect([...parsePlan(text).values()]).toEqual([rows[1], rows[0]]);
  });

  it("refuses anything it would have to guess at", () => {
    const head = "id,target,reason\n";
    expect(() => parsePlan("a,2026-08-22T20:45:26.912Z,own\n")).toThrow(
      /start with/,
    );
    expect(() => parsePlan(head + "a,2026-08-22T20:45:26Z,own")).toThrow(
      /ISO instant/,
    );
    expect(() => parsePlan(head + "a,2026-08-22T20:45:26.912Z,guess")).toThrow(
      /not one of/,
    );
    expect(() =>
      parsePlan(head + "a,2026-08-22T20:45:26.912Z,own,extra"),
    ).toThrow(/id,target,reason/);
    expect(() =>
      parsePlan(
        head +
          "a,2026-08-22T20:45:26.912Z,own\na,2026-09-18T21:30:38.000Z,links-0918",
      ),
    ).toThrow(/twice/);
  });
});

describe("corrections", () => {
  const plan = parsePlan(
    formatPlan([
      { id: "lower", target: "2026-08-22T20:45:26.912Z", reason: "own" },
      { id: "raise", target: "2026-10-24T21:46:02.000Z", reason: "board-1024" },
      { id: "stay", target: STAMP, reason: "own" },
      { id: "later", target: "2026-09-01T00:00:00.000Z", reason: "own" },
      { id: "earlier", target: "2026-10-30T00:00:00.000Z", reason: "own" },
      { id: "spelled", target: "2026-09-01T00:00:00.000Z", reason: "own" },
      { id: "none", target: "2026-09-01T00:00:00.000Z", reason: "own" },
    ]),
  );
  const nodes = new Map<string, NodeRow>([
    ["lower", { type: "article", content_changed_at: STAMP }],
    ["raise", { type: "place", content_changed_at: STAMP }],
    ["stay", { type: "person", content_changed_at: STAMP }],
    ["unplanned", { type: "person", content_changed_at: STAMP }],
    // Moved off the stamp since: whatever the plan says, never touched.
    [
      "later",
      { type: "place", content_changed_at: "2026-11-02T08:00:00.000Z" },
    ],
    [
      "earlier",
      { type: "place", content_changed_at: "2026-10-01T08:00:00.000Z" },
    ],
    ["spelled", { type: "place", content_changed_at: "2026-10-24T14:08:20Z" }],
    ["none", { type: "place" }],
  ]);

  it("moves only the planned nodes at the exact stamp, either way", () => {
    const { write, same, unplanned } = corrections(nodes, plan);
    expect(write).toEqual([
      {
        id: "lower",
        type: "article",
        target: "2026-08-22T20:45:26.912Z",
        reason: "own",
        direction: "lower",
      },
      {
        id: "raise",
        type: "place",
        target: "2026-10-24T21:46:02.000Z",
        reason: "board-1024",
        direction: "raise",
      },
    ]);
    expect(same.map((row) => row.id)).toEqual(["stay"]);
    expect(unplanned).toEqual(["unplanned"]);
  });

  it("finds nothing to do once applied", () => {
    const after = new Map(nodes);
    for (const row of corrections(nodes, plan).write) {
      after.set(row.id, {
        ...after.get(row.id),
        content_changed_at: row.target,
      });
    }
    const again = corrections(after, plan);
    expect(again.write).toEqual([]);
  });

  it("names the direction against the stamp", () => {
    expect(direction("2026-10-24T14:08:19.999Z")).toBe("lower");
    expect(direction("2026-10-24T14:08:20.001Z")).toBe("raise");
    expect(direction(STAMP)).toBe("same");
  });
});

describe("planFor", () => {
  const none = {
    desc: new Set<string>(),
    board: new Set<string>(),
    links0918: new Set<string>(),
    site1007: new Set<string>(),
    days1020: new Set<string>(),
  };

  it("takes the page's own date before the stamp where nothing later reached it", () => {
    expect(
      planFor("p", { content_changed_at: "2026-03-10T09:00:00.000Z" }, none),
    ).toEqual({ id: "p", target: "2026-03-10T09:00:00.000Z", reason: "own" });
  });

  it("floors it at each site change that reached the page", () => {
    const before = { content_changed_at: "2026-03-10T09:00:00.000Z" };
    expect(
      planFor("p", before, { ...none, links0918: new Set(["p"]) }),
    ).toMatchObject({
      target: SITE_INSTANTS["links-0918"],
      reason: "links-0918",
    });
    expect(
      planFor("p", before, {
        ...none,
        links0918: new Set(["p"]),
        days1020: new Set(["p"]),
      }),
    ).toMatchObject({
      target: SITE_INSTANTS["days-1020"],
      reason: "days-1020",
    });
    expect(
      planFor("p", before, {
        ...none,
        desc: new Set(["p"]),
        board: new Set(["p"]),
      }),
    ).toMatchObject({
      target: SITE_INSTANTS["board-1024"],
      reason: "board-1024",
    });
    // A floor older than the page's own date does not pull it down.
    expect(
      planFor(
        "p",
        { content_changed_at: "2026-10-10T09:00:00.000Z" },
        { ...none, links0918: new Set(["p"]), site1007: new Set(["p"]) },
      ),
    ).toMatchObject({ target: "2026-10-10T09:00:00.000Z", reason: "own" });
  });

  it("falls back to the approved revision date only where there is no own date", () => {
    const revisions = { latest_time: "2026-05-01T00:00:00.000Z" };
    expect(planFor("p", { revisions }, none)).toMatchObject({
      target: "2026-05-01T00:00:00.000Z",
      reason: "revised",
    });
    expect(
      planFor("p", { revisions: { ...revisions, has_unapproved: true } }, none),
    ).toBeUndefined();
    expect(
      planFor(
        "p",
        { content_changed_at: "2026-04-01T00:00:00.000Z", revisions },
        none,
      ),
    ).toMatchObject({ reason: "own" });
  });

  it("plans nothing for a page the 14:12 export does not have", () => {
    expect(planFor("p", undefined, { ...none, board: new Set(["p"]) })).toBe(
      undefined,
    );
  });
});

const live = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  name: `${type} name`,
  published: true,
  ...extra,
});

describe("the scopes the plan reads off old exports", () => {
  const nodes = new Map<string, Record<string, unknown>>([
    ["ala", live("person")],
    ["ola", live("person", { parties: ["Inne"] })],
    ["ula", live("person")],
    ["draft", live("person", { published: false })],
    ["mpwik", live("place", { categories: ["wodociagi"] })],
    ["bare", live("place")],
    ["region", live("region")],
    ["article", live("article")],
  ]);
  const edges = [
    {
      id: "e1",
      type: "employed",
      source: "ala",
      target: "mpwik",
      published: true,
    },
    {
      id: "e2",
      type: "employed",
      source: "draft",
      target: "bare",
      published: true,
    },
    {
      id: "e3",
      type: "employed",
      source: "ula",
      target: "bare",
      published: false,
    },
    {
      id: "e4",
      type: "election",
      source: "ula",
      target: "region",
      position: "Rada miasta",
      published: true,
    },
    {
      id: "e5",
      type: "mentions",
      source: "article",
      target: "ala",
      published: true,
    },
  ];
  const dump = { nodes, edges } as never;

  it("finds the person and company pages that listed a live relation", () => {
    // ala-mpwik both live; ula's candidacy is live; the draft's post and
    // ula's unpublished post are not shown; an article is not such a page.
    expect(pagesWithRelations(dump)).toEqual(new Set(["ala", "mpwik", "ula"]));
  });

  it("finds the pages rollout 10-07 changed", () => {
    // ala: a row naming a company with sectors. ula: a candidacy with an
    // office. ola: „Inne” left her description. mpwik lists only a person.
    expect(pagesChangedOn1007(dump)).toEqual(new Set(["ala", "ula", "ola"]));
  });
});

describe("the committed plan", () => {
  const plan = parsePlan(readFileSync(PLAN, "utf8"));

  it("parses whole, and dates every page between its first change and the last site change", () => {
    expect(plan.size).toBeGreaterThan(0);
    const newest = SITE_INSTANTS["board-1024"];
    for (const row of plan.values()) {
      expect(REASONS).toContain(row.reason);
      expect(row.target <= newest).toBe(true);
      expect(row.target > "2025-01-01").toBe(true);
      expect(row.target).not.toBe(STAMP);
    }
  });
});

describe("SITE_INSTANTS", () => {
  it("dates the board change where stamp-site-changes.ts does", () => {
    const board = SITE_CHANGES.find(
      (change) => change.id === "company-boards-unpublished-holders",
    );
    expect(new Date(board!.at!).toISOString()).toBe(
      SITE_INSTANTS["board-1024"],
    );
  });

  it("names the stamp canonical-and-snippets-2026-10-24 wrote", () => {
    const stamp = SITE_CHANGES.find(
      (change) => change.id === "canonical-and-snippets-2026-10-24",
    );
    expect(new Date(stamp!.at!).toISOString()).toBe(STAMP);
  });
});
