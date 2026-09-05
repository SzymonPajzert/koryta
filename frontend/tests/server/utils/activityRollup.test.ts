import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyActivityCounts } from "../../../shared/activity";
import type { ActivityEvent } from "../../../server/utils/activityStats";

import {
  dayEndIso,
  dayStartIso,
  ensureDailyRollups,
  mergeRollups,
  mergeTruncated,
  rollupForDay,
  splitSettledDays,
} from "../../../server/utils/activityRollup";

const { mockCollect } = vi.hoisted(() => ({ mockCollect: vi.fn() }));

// Hoisted above the import, so the rollup gets the stub rather than a real
// scan. What it reads is `activityEvents`' business and is tested there; here
// the only question is which days are scanned and what is done with them.
vi.mock("~~/server/utils/activityEvents", () => ({
  collectActivityEvents: mockCollect,
}));

const counts = (partial: Partial<ReturnType<typeof emptyActivityCounts>>) => ({
  ...emptyActivityCounts(),
  ...partial,
});

const event = (
  uid: string,
  kind: ActivityEvent["kind"],
  at: string,
  count?: number,
): ActivityEvent => ({ uid, kind, at, count });

/** A Firestore stand-in that keeps documents in a plain map, so a test can see
 * exactly which days were stored and read them back the way the real one is
 * read on the next request. */
function fakeDb(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  const writes: string[] = [];
  const failWrites = { value: false };

  const db = {
    store,
    writes,
    failWrites,
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}`, id }),
    }),
    getAll: async (...refs: { path: string; id: string }[]) =>
      refs.map((ref) => ({
        id: ref.id,
        data: () => store.get(ref.path),
      })),
    batch: () => ({
      set: (ref: { path: string }, data: unknown) => {
        store.set(ref.path, data);
        writes.push(ref.path);
      },
      commit: async () => {
        if (failWrites.value) throw new Error("permission denied");
      },
    }),
  };

  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollect.mockResolvedValue({ events: [], truncated: [] });
});

describe("day bounds", () => {
  it("spans exactly one UTC day, half open", () => {
    expect(dayStartIso("2026-08-20")).toBe("2026-08-20T00:00:00.000Z");
    expect(dayEndIso("2026-08-20")).toBe("2026-08-21T00:00:00.000Z");
  });

  it("crosses a month end", () => {
    expect(dayEndIso("2026-08-31")).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("splitSettledDays", () => {
  const days = ["2026-08-18", "2026-08-19", "2026-08-20"];

  it("keeps today live, whatever the hour", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T23:59:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18", "2026-08-19"]);
    expect(live).toEqual(["2026-08-20"]);
  });

  it("leaves yesterday live until it has settled", () => {
    // Six hours after midnight, a vote stamped by a browser whose clock is a
    // couple of hours behind can still be written into yesterday.
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T03:00:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18"]);
    expect(live).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("stores yesterday once the window has passed", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T07:00:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18", "2026-08-19"]);
    expect(live).toEqual(["2026-08-20"]);
  });

  it("splits into a settled prefix and a live suffix, never interleaved", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T12:00:00.000Z"),
    );

    expect([...settled, ...live]).toEqual(days);
  });
});

describe("rollupForDay", () => {
  it("counts a day the same way a live scan would", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [
        event("anna", "vote", "2026-08-20T09:00:00.000Z"),
        event("anna", "vote", "2026-08-20T18:00:00.000Z"),
        event("bob", "noteSource", "2026-08-20T12:00:00.000Z", 3),
      ],
      [],
    );

    expect(rollup.totals).toEqual(counts({ vote: 2, noteSource: 3 }));
    expect(rollup.contributors.anna).toEqual({
      counts: counts({ vote: 2 }),
      // The latest instant of the day, not the first one seen.
      lastActiveAt: "2026-08-20T18:00:00.000Z",
    });
    expect(rollup.contributors.bob!.counts.noteSource).toBe(3);
  });

  it("leaves the pipeline out, like every other count on the page", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [event("pipeline-pagerank", "vote", "2026-08-20T09:00:00.000Z")],
      [],
    );

    expect(rollup.contributors).toEqual({});
    expect(rollup.totals.vote).toBe(0);
  });

  it("ignores an event that belongs to another day", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [event("anna", "vote", "2026-08-19T23:00:00.000Z")],
      [],
    );

    expect(rollup.totals.vote).toBe(0);
  });
});

describe("mergeRollups", () => {
  const days = ["2026-08-19", "2026-08-20", "2026-08-21"];
  const rollups = [
    rollupForDay(
      "2026-08-19",
      [
        event("anna", "vote", "2026-08-19T09:00:00.000Z"),
        event("bob", "publication", "2026-08-19T09:00:00.000Z"),
      ],
      [],
    ),
    rollupForDay(
      "2026-08-21",
      [
        event("anna", "revision", "2026-08-21T09:00:00.000Z"),
        event("anna", "vote", "2026-08-21T10:00:00.000Z"),
      ],
      [],
    ),
  ];

  it("adds a contributor's days up and keeps their latest", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.contributors[0]).toEqual({
      uid: "anna",
      counts: counts({ vote: 2, revision: 1 }),
      total: 3,
      lastActiveAt: "2026-08-21T10:00:00.000Z",
    });
  });

  it("ranks by total, then by uid so equal totals do not shuffle", () => {
    expect(mergeRollups(days, rollups).contributors.map((c) => c.uid)).toEqual([
      "anna",
      "bob",
    ]);
  });

  it("draws a day with no rollup as a zero column, not as a gap", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.daily.map((day) => day.date)).toEqual(days);
    expect(aggregate.daily[1]).toEqual({
      date: "2026-08-20",
      counts: emptyActivityCounts(),
      total: 0,
    });
  });

  it("totals the window", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.total).toBe(4);
    expect(aggregate.totals).toEqual(
      counts({ vote: 2, publication: 1, revision: 1 }),
    );
  });

  it("counts a day only once, however many rollups mention it", () => {
    // The endpoint appends a live "today" to whatever was stored; if a stored
    // copy of today ever slipped in, its numbers must not be added twice.
    const today = rollupForDay(
      "2026-08-21",
      [event("anna", "revision", "2026-08-21T09:00:00.000Z")],
      [],
    );

    const aggregate = mergeRollups(["2026-08-21"], [today, today]);

    expect(aggregate.total).toBe(1);
  });
});

describe("mergeTruncated", () => {
  it("reports a kind that any day in the window cut short, once", () => {
    const rollups = [
      rollupForDay("2026-08-19", [], ["vote"]),
      rollupForDay("2026-08-20", [], ["vote", "revision"]),
    ];

    expect(mergeTruncated(rollups).sort()).toEqual(["revision", "vote"]);
  });
});

describe("ensureDailyRollups", () => {
  it("reads a stored day instead of counting it again", async () => {
    const db = fakeDb({
      "activityDaily/2026-08-19": {
        version: 3,
        date: "2026-08-19",
        totals: { vote: 4 },
        truncated: [],
        contributors: {
          anna: { vote: 4, lastActiveAt: "2026-08-19T20:00:00.000Z" },
        },
      },
    });

    const rollups = await ensureDailyRollups(db as never, ["2026-08-19"]);

    expect(mockCollect).not.toHaveBeenCalled();
    expect(rollups[0]!.totals.vote).toBe(4);
    expect(rollups[0]!.contributors.anna).toEqual({
      counts: counts({ vote: 4 }),
      lastActiveAt: "2026-08-19T20:00:00.000Z",
    });
  });

  it("counts a missing day, stores it, and does not count it twice", async () => {
    const db = fakeDb();
    mockCollect.mockResolvedValue({
      events: [event("anna", "vote", "2026-08-19T09:00:00.000Z")],
      truncated: [],
    });

    await ensureDailyRollups(db as never, ["2026-08-19"]);
    expect(db.writes).toEqual(["activityDaily/2026-08-19"]);

    mockCollect.mockClear();
    const second = await ensureDailyRollups(db as never, ["2026-08-19"]);
    expect(mockCollect).not.toHaveBeenCalled();
    expect(second[0]!.totals.vote).toBe(1);
  });

  it("reads a run of missing days in one scan, and splits it per day", async () => {
    const db = fakeDb();
    mockCollect.mockResolvedValue({
      events: [
        event("anna", "vote", "2026-08-19T09:00:00.000Z"),
        event("anna", "publication", "2026-08-20T09:00:00.000Z"),
      ],
      truncated: [],
    });

    const rollups = await ensureDailyRollups(db as never, [
      "2026-08-19",
      "2026-08-20",
    ]);

    // One scan for the pair, not one per day - that is the whole point of
    // reading them as a range.
    expect(mockCollect).toHaveBeenCalledTimes(1);
    expect(mockCollect.mock.calls[0]![1]).toEqual({
      sinceIso: "2026-08-19T00:00:00.000Z",
      untilIso: "2026-08-21T00:00:00.000Z",
    });
    expect(rollups[0]!.totals.vote).toBe(1);
    expect(rollups[1]!.totals.publication).toBe(1);
  });

  it("does not scan across a day it already has", async () => {
    // Scanning 19th-21st to fill in the 19th and the 21st would re-read the
    // 20th for nothing.
    const db = fakeDb({
      "activityDaily/2026-08-20": {
        version: 3,
        date: "2026-08-20",
        totals: {},
        contributors: {},
        truncated: [],
      },
    });

    await ensureDailyRollups(db as never, [
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);

    expect(mockCollect).toHaveBeenCalledTimes(2);
    expect(mockCollect.mock.calls.map((call) => call[1])).toEqual([
      {
        sinceIso: "2026-08-19T00:00:00.000Z",
        untilIso: "2026-08-20T00:00:00.000Z",
      },
      {
        sinceIso: "2026-08-21T00:00:00.000Z",
        untilIso: "2026-08-22T00:00:00.000Z",
      },
    ]);
  });

  it("recounts a day that was stored under an older counting rule", async () => {
    // The rule has changed three times - article nodes, then the migration
    // scripts, then the merge down to four kinds - so a day counted under an
    // older one has to be thrown away, or the change would only ever apply to
    // days nobody had looked at yet. The last of the three also renamed the
    // fields, so a version-2 day would come back as one on which nobody voted.
    const db = fakeDb({
      "activityDaily/2026-08-19": {
        version: 1,
        date: "2026-08-19",
        totals: { revision: 999 },
        contributors: {},
        truncated: [],
      },
    });
    mockCollect.mockResolvedValue({
      events: [event("anna", "revision", "2026-08-19T09:00:00.000Z")],
      truncated: [],
    });

    const rollups = await ensureDailyRollups(db as never, ["2026-08-19"]);

    expect(mockCollect).toHaveBeenCalledTimes(1);
    expect(rollups[0]!.totals.revision).toBe(1);
  });

  it("redoes a truncated range one day at a time", async () => {
    // A cap shared by seven days costs the oldest of them its events, and
    // writing that down would make an undercount permanent.
    const db = fakeDb();
    mockCollect.mockImplementation(
      async (
        _db: unknown,
        window: { sinceIso: string; untilIso?: string },
      ) => ({
        events: [],
        // Only the scan that covers both days is over the cap; one day on its
        // own gets the same allowance to itself and comes back complete.
        truncated:
          window.sinceIso === "2026-08-19T00:00:00.000Z" &&
          window.untilIso === "2026-08-21T00:00:00.000Z"
            ? ["vote"]
            : [],
      }),
    );

    const rollups = await ensureDailyRollups(db as never, [
      "2026-08-19",
      "2026-08-20",
    ]);

    // The range scan, then one scan per day.
    expect(mockCollect).toHaveBeenCalledTimes(3);
    expect(rollups.every((rollup) => rollup.truncated.length === 0)).toBe(true);
  });

  it("still answers when it cannot store what it counted", async () => {
    // A rules or credentials problem should cost the cache, not the page.
    const db = fakeDb();
    db.failWrites.value = true;
    mockCollect.mockResolvedValue({
      events: [event("anna", "vote", "2026-08-19T09:00:00.000Z")],
      truncated: [],
    });

    const rollups = await ensureDailyRollups(db as never, ["2026-08-19"]);

    expect(rollups[0]!.totals.vote).toBe(1);
  });

  it("asks for nothing when the window has no finished days", async () => {
    expect(await ensureDailyRollups(fakeDb() as never, [])).toEqual([]);
    expect(mockCollect).not.toHaveBeenCalled();
  });
});
