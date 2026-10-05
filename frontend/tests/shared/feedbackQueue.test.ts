import { describe, it, expect } from "vitest";
import {
  OPEN_CAP,
  OPEN_STATUSES,
  QUEUE_STEP,
  SETTLED_STATUSES,
  compareNewest,
  compareQueue,
  feedbackSection,
  isQueued,
  isSettled,
  rankBetween,
  rankForSlot,
  renumberQueue,
  slotHasRoom,
} from "../../shared/feedbackQueue";
import type { Feedback, FeedbackStatus } from "../../shared/model";

const DAY = "2026-09-01T00:00:00.000Z";

function report(id: string, fields: Partial<Feedback> = {}): Feedback {
  return {
    id,
    kind: "bug",
    message: `report ${id}`,
    context: { route: "/" },
    createdAt: DAY,
    adminStatus: "new",
    ...fields,
  };
}

const ranked = (id: string, queueRank: number, createdAt = DAY) =>
  report(id, { queueRank, createdAt });

const ids = (reports: readonly Feedback[]) => reports.map((r) => r.id);

/** What the page does on a drop: rank the report among the others, then show
 * the queue sorted. Returns the queue as it reads afterwards. */
function drop(
  queue: readonly Feedback[],
  item: Feedback,
  index: number,
): Feedback[] {
  const others = queue.filter((entry) => entry.id !== item.id);
  const moved = { ...item, queueRank: rankForSlot(others, index) };
  return [...others, moved].sort(compareQueue);
}

describe("statuses", () => {
  const all: FeedbackStatus[] = ["new", "in_progress", "resolved", "wont_fix"];

  it("splits every status into open or settled, never both", () => {
    for (const status of all) {
      expect(
        OPEN_STATUSES.includes(status) !== SETTLED_STATUSES.includes(status),
      ).toBe(true);
    }
  });

  it("keeps new and in-progress work open, the rest settled", () => {
    expect(OPEN_STATUSES).toEqual(["new", "in_progress"]);
    expect(SETTLED_STATUSES).toEqual(["resolved", "wont_fix"]);
  });

  it("names every status exactly once across the two sides", () => {
    // The endpoint reads the two sides separately: a status on neither would
    // vanish from the page, one on both would be listed twice.
    const both = [...OPEN_STATUSES, ...SETTLED_STATUSES];
    expect(both).toHaveLength(all.length);
    expect([...both].sort()).toEqual([...all].sort());
  });
});

describe("OPEN_CAP", () => {
  it("is 500", () => {
    // The list endpoint returns this many open reports and the summary reads
    // this many new ones; the page's truncation banner shows the number.
    expect(OPEN_CAP).toBe(500);
  });
});

describe("isSettled", () => {
  it("is true for a report dealt with or declined", () => {
    expect(isSettled({ adminStatus: "resolved" })).toBe(true);
    expect(isSettled({ adminStatus: "wont_fix" })).toBe(true);
  });

  it("is false for new work and work in progress", () => {
    expect(isSettled({ adminStatus: "new" })).toBe(false);
    // Somebody is on it, so it still belongs in the queue.
    expect(isSettled({ adminStatus: "in_progress" })).toBe(false);
  });
});

describe("isQueued", () => {
  it("is true for any rank, including zero and negative ones", () => {
    expect(isQueued({ queueRank: 1024 })).toBe(true);
    // The first report put into an empty queue gets rank 0 (see
    // rankBetween), so a truthiness check would lose it straight away.
    expect(isQueued({ queueRank: 0 })).toBe(true);
    // Anything put on top of a queue starting at 0 goes negative.
    expect(isQueued({ queueRank: -QUEUE_STEP })).toBe(true);
  });

  it("is false when no rank was ever given", () => {
    expect(isQueued({})).toBe(false);
    expect(isQueued({ queueRank: undefined })).toBe(false);
  });

  it("does not read a null as a rank", () => {
    // Taking a report out of the queue sends `queueRank: null`; if one ever
    // came back over JSON it must not count as a place in the queue.
    expect(isQueued({ queueRank: null as unknown as number })).toBe(false);
  });
});

describe("feedbackSection", () => {
  it("puts a ranked open report in the queue", () => {
    expect(feedbackSection({ queueRank: 2048 }, false)).toBe("queue");
  });

  it("puts an unranked open report outside the queue", () => {
    expect(feedbackSection({}, false)).toBe("inbox");
  });

  it("counts rank 0 as ranked", () => {
    expect(feedbackSection({ queueRank: 0 }, false)).toBe("queue");
  });

  it("puts a report settled at load among the closed ones, rank or not", () => {
    expect(feedbackSection({}, true)).toBe("closed");
    // A rank is kept when a report is settled so reopening it puts it back
    // where it was; that must not drag a closed report into the queue.
    expect(feedbackSection({ queueRank: 0 }, true)).toBe("closed");
    expect(feedbackSection({ queueRank: 4096 }, true)).toBe("closed");
  });

  it("goes by settledness at load, not by the status the report has now", () => {
    // Closed from its card: stays in the queue until the next load rather
    // than jumping out from under the cursor.
    const closedJustNow = report("a", {
      queueRank: 0,
      adminStatus: "resolved",
    });
    expect(feedbackSection(closedJustNow, false)).toBe("queue");
    const closedJustNowUnranked = report("b", { adminStatus: "wont_fix" });
    expect(feedbackSection(closedJustNowUnranked, false)).toBe("inbox");
    // Reopened from its card: stays among the closed ones the same way.
    const reopenedJustNow = report("c", { queueRank: 0, adminStatus: "new" });
    expect(feedbackSection(reopenedJustNow, true)).toBe("closed");
  });
});

describe("rankBetween", () => {
  it("starts an empty queue at 0", () => {
    expect(rankBetween()).toBe(0);
    expect(rankBetween(undefined, undefined)).toBe(0);
  });

  it("goes a step above the first report when put on top", () => {
    expect(rankBetween(undefined, 0)).toBe(-QUEUE_STEP);
    expect(rankBetween(undefined, 5000)).toBe(5000 - QUEUE_STEP);
  });

  it("goes a step below the last report when put at the end", () => {
    expect(rankBetween(0, undefined)).toBe(QUEUE_STEP);
    expect(rankBetween(-3000, undefined)).toBe(-3000 + QUEUE_STEP);
  });

  it("halves the gap between two neighbours", () => {
    expect(rankBetween(0, QUEUE_STEP)).toBe(QUEUE_STEP / 2);
    expect(rankBetween(-QUEUE_STEP, 0)).toBe(-QUEUE_STEP / 2);
    expect(rankBetween(10, 11)).toBe(10.5);
  });

  it("treats a neighbour at rank 0 as present", () => {
    // The first report of a fresh queue sits at 0; a truthiness check in
    // place of the undefined one would read it as a missing neighbour.
    expect(rankBetween(0, 2048)).toBe(1024);
    expect(rankBetween(-2048, 0)).toBe(-1024);
  });
});

describe("rankForSlot", () => {
  const queue = [ranked("a", 0), ranked("b", 1024), ranked("c", 2048)];

  it("gives an empty queue its first rank", () => {
    expect(rankForSlot([], 0)).toBe(0);
  });

  it("goes above the first report at index 0", () => {
    expect(rankForSlot(queue, 0)).toBe(-QUEUE_STEP);
  });

  it("goes below the last report at the index past the end", () => {
    expect(rankForSlot(queue, 3)).toBe(2048 + QUEUE_STEP);
  });

  it("goes between the two reports around a middle index", () => {
    expect(rankForSlot(queue, 1)).toBe(512);
    expect(rankForSlot(queue, 2)).toBe(1536);
  });

  it("clamps an index outside the queue to its ends", () => {
    expect(rankForSlot(queue, -1)).toBe(-QUEUE_STEP);
    expect(rankForSlot(queue, -100)).toBe(-QUEUE_STEP);
    expect(rankForSlot(queue, 4)).toBe(2048 + QUEUE_STEP);
    expect(rankForSlot(queue, 100)).toBe(2048 + QUEUE_STEP);
    expect(rankForSlot([], 5)).toBe(0);
    expect(rankForSlot([], -5)).toBe(0);
  });

  it("counts the slot among the others, so the moved report must not be in the list", () => {
    // Moving "a" one down means it should end up between "b" and "c".
    // Counted without "a", index 1 is exactly that gap.
    expect(ids(drop(queue, queue[0]!, 1))).toEqual(["b", "a", "c"]);
    // Counted with "a" still in the list, index 1 is the gap "a" already sits
    // above, so the move would not take: this is why the page filters first.
    const withItself = { ...queue[0]!, queueRank: rankForSlot(queue, 1) };
    expect(ids([withItself, queue[1]!, queue[2]!].sort(compareQueue))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("lands a report at the index asked for, whichever way it moves", () => {
    const five = ["a", "b", "c", "d", "e"].map((id, i) =>
      ranked(id, i * QUEUE_STEP),
    );
    for (let from = 0; from < five.length; from++) {
      for (let to = 0; to < five.length; to++) {
        const expected = ids(five).filter((id) => id !== five[from]!.id);
        expected.splice(to, 0, five[from]!.id);
        expect(ids(drop(five, five[from]!, to)), `${from} -> ${to}`).toEqual(
          expected,
        );
      }
    }
  });

  it("lands a report from outside the queue at the index asked for", () => {
    const three = [ranked("a", 0), ranked("b", 1024), ranked("c", 2048)];
    // Older than everything in the queue, so a rank collision would show up
    // as it sorting to the top of the tie.
    const newcomer = report("z", { createdAt: "2020-01-01T00:00:00.000Z" });
    for (let to = 0; to <= three.length; to++) {
      const expected = ids(three);
      expected.splice(to, 0, "z");
      expect(ids(drop(three, newcomer, to)), `-> ${to}`).toEqual(expected);
    }
  });
});

describe("slotHasRoom", () => {
  const queue = [ranked("a", 0), ranked("b", 1024), ranked("c", 2048)];

  it("has room in an empty queue", () => {
    expect(slotHasRoom([], 0)).toBe(true);
    expect(slotHasRoom([], 3)).toBe(true);
  });

  it("has room between neighbours a gap apart", () => {
    expect(slotHasRoom(queue, 1)).toBe(true);
    expect(slotHasRoom(queue, 2)).toBe(true);
    // A gap of 1 still halves to something in between.
    expect(slotHasRoom([ranked("a", 10), ranked("b", 11)], 1)).toBe(true);
  });

  it("has no room between neighbours sharing a rank", () => {
    // A closed report keeps its rank; reopened, it can find a newer report
    // sitting on the same one. Halving the gap would land on both.
    const shared = [ranked("a", 0), ranked("b", 512), ranked("c", 512)];
    expect(slotHasRoom(shared, 1)).toBe(true);
    expect(slotHasRoom(shared, 2)).toBe(false);
  });

  it("has no room between neighbours one float apart", () => {
    const touching = [ranked("a", 1), ranked("b", 1 + Number.EPSILON)];
    expect(slotHasRoom(touching, 1)).toBe(false);
    // And it is right to say so: the rank it would get is one of theirs.
    expect([1, 1 + Number.EPSILON]).toContain(rankForSlot(touching, 1));
  });

  it("always has room at either end, however jammed the middle is", () => {
    const jammed = [ranked("a", 512), ranked("b", 512), ranked("c", 512)];
    expect(slotHasRoom(jammed, 0)).toBe(true);
    expect(slotHasRoom(jammed, 3)).toBe(true);
    expect(slotHasRoom(queue, 0)).toBe(true);
    expect(slotHasRoom(queue, 3)).toBe(true);
  });

  it("clamps an index outside the queue to its ends", () => {
    const shared = [ranked("a", 512), ranked("b", 512)];
    expect(slotHasRoom(shared, -1)).toBe(true);
    expect(slotHasRoom(shared, -100)).toBe(true);
    expect(slotHasRoom(shared, 3)).toBe(true);
    expect(slotHasRoom(shared, 100)).toBe(true);
    // Only the clamp tells these apart: a rank so large that a step does not
    // change it has no room even on top, and an index before the top is the
    // top. Unclamped, -1 would see no neighbours at all and say yes.
    const huge = [ranked("a", 2 ** 70)];
    expect(slotHasRoom(huge, 0)).toBe(false);
    expect(slotHasRoom(huge, -1)).toBe(false);
  });

  it("says yes exactly as long as rankForSlot lands strictly between", () => {
    // Keep dropping into the gap after "a" until it runs out.
    let jam = [ranked("a", 4 * QUEUE_STEP), ranked("b", 5 * QUEUE_STEP)];
    let drops = 0;
    while (slotHasRoom(jam, 1)) {
      const rank = rankForSlot(jam, 1);
      expect(rank, `drop ${drops}`).toBeGreaterThan(jam[0]!.queueRank!);
      expect(rank, `drop ${drops}`).toBeLessThan(jam[1]!.queueRank!);
      jam = drop(jam, report(`drop${drops}`), 1);
      drops++;
      if (drops > 200) throw new Error("the gap never ran out");
    }
    // About 50 halvings, as QUEUE_STEP's comment promises - and then the rank
    // it would get is no longer strictly between.
    expect(drops).toBeGreaterThan(40);
    const rank = rankForSlot(jam, 1);
    expect(rank > jam[0]!.queueRank! && rank < jam[1]!.queueRank!).toBe(false);
  });
});

describe("renumberQueue", () => {
  it("gives the queue fresh ranks a full step apart, in queue order", () => {
    const jammed = [ranked("a", 512), ranked("b", 512), ranked("c", 513)];
    const renumbered = renumberQueue(jammed);
    expect(renumbered.map(({ item }) => item.id)).toEqual(["a", "b", "c"]);
    expect(renumbered.map(({ rank }) => rank)).toEqual([
      QUEUE_STEP,
      2 * QUEUE_STEP,
      3 * QUEUE_STEP,
    ]);
    // The same objects, so the page can write back to the reports it holds.
    expect(renumbered[0]!.item).toBe(jammed[0]);
  });

  it("leaves out the reports whose rank would not change", () => {
    // Each one returned is a write, so the ones already in place are skipped.
    const queue = [
      ranked("a", QUEUE_STEP),
      ranked("b", 1500),
      ranked("c", 3 * QUEUE_STEP),
      // Rank 0 is a rank like any other, and it is not index 3's.
      ranked("d", 0),
    ];
    expect(
      renumberQueue(queue).map(({ item, rank }) => [item.id, rank]),
    ).toEqual([
      ["b", 2 * QUEUE_STEP],
      ["d", 4 * QUEUE_STEP],
    ]);
    const settled = [ranked("a", QUEUE_STEP), ranked("b", 2 * QUEUE_STEP)];
    expect(renumberQueue(settled)).toEqual([]);
  });

  it("has nothing to renumber in an empty queue", () => {
    expect(renumberQueue([])).toEqual([]);
  });

  it("makes room where there was none, without changing the order", () => {
    // What the page does when a slot is full: renumber the others, then drop.
    const others = [ranked("a", 512), ranked("b", 512), ranked("c", 2048)];
    expect(slotHasRoom(others, 1)).toBe(false);
    const newRank = new Map(
      renumberQueue(others).map(({ item, rank }) => [item.id, rank]),
    );
    const fresh = others
      .map((r) => ({ ...r, queueRank: newRank.get(r.id!) ?? r.queueRank }))
      .sort(compareQueue);
    expect(ids(fresh)).toEqual(ids(others));
    for (let slot = 0; slot <= fresh.length; slot++) {
      expect(slotHasRoom(fresh, slot), `slot ${slot}`).toBe(true);
    }
    const moved = report("z", { createdAt: "2020-01-01T00:00:00.000Z" });
    expect(ids(drop(fresh, moved, 1))).toEqual(["a", "z", "b", "c"]);
  });
});

describe("repeated drops into one gap", () => {
  // The ranks are sparse and a move halves a gap, so the question is whether
  // a long run of drops into the same slot still orders correctly. The
  // neighbours sit away from zero, as they would in a queue that has been
  // appended to for a while, so float precision is actually being spent.
  const DROPS = 45;
  const base = () =>
    [0, 1, 2, 3, 4, 5, 6].map((i) => ranked(`base${i}`, (4 + i) * QUEUE_STEP));

  /** Drops DROPS new reports, one at a time, into the slot `slotOf` picks,
   * checking after each that it went strictly between its neighbours and that
   * the sorted queue reads the way the drop asked. `newcomer(n)` should make
   * the tie-breaks point the wrong way, so that only the rank can put a
   * report in its place. */
  function run(
    slotOf: (queue: readonly Feedback[]) => number,
    newcomer: (n: number) => Feedback,
  ): Feedback[] {
    let queue = base();
    for (let n = 1; n <= DROPS; n++) {
      const item = newcomer(n);
      const slot = slotOf(queue);
      const rank = rankForSlot(queue, slot);
      expect(rank, `drop ${n}`).toBeGreaterThan(queue[slot - 1]!.queueRank!);
      expect(rank, `drop ${n}`).toBeLessThan(queue[slot]!.queueRank!);

      const expected = ids(queue);
      expected.splice(slot, 0, item.id);
      queue = drop(queue, item, slot);
      expect(ids(queue), `drop ${n}`).toEqual(expected);
    }
    return queue;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const afterBase3 = (q: readonly Feedback[]) =>
    q.findIndex((r) => r.id === "base3") + 1;
  const beforeBase4 = (q: readonly Feedback[]) =>
    q.findIndex((r) => r.id === "base4");

  it("keeps drops closing in on the upper neighbour strictly between", () => {
    // Each drop goes right after base3, above the drops before it. Older than
    // base3 and with ids that grow, a tie would sort it above base3 or below
    // the earlier drops - both wrong.
    const queue = run(afterBase3, (n) =>
      report(`drop${pad(n)}`, { createdAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(queue).toHaveLength(7 + DROPS);
    expect(ids(queue.slice(3, 5))).toEqual(["base3", `drop${DROPS}`]);
    expect(ids(queue.slice(3 + DROPS, 5 + DROPS))).toEqual(["drop01", "base4"]);
  });

  it("keeps drops closing in on the lower neighbour strictly between", () => {
    // Each drop goes right before base4, below the drops before it. Newer
    // than base4 and with ids that shrink, a tie would sort it below base4 or
    // above the earlier drops - both wrong.
    const queue = run(beforeBase4, (n) =>
      report(`drop${pad(100 - n)}`, {
        createdAt: "2030-01-01T00:00:00.000Z",
      }),
    );
    expect(queue).toHaveLength(7 + DROPS);
    expect(ids(queue.slice(3, 5))).toEqual(["base3", "drop99"]);
    expect(ids(queue.slice(3 + DROPS, 5 + DROPS))).toEqual([
      `drop${100 - DROPS}`,
      "base4",
    ]);
  });

  it("gives every drop a rank of its own, so any order sorts back the same", () => {
    const queue = run(afterBase3, (n) => report(`drop${pad(n)}`));
    // Distinct ranks, not merely tie-broken ones.
    expect(new Set(queue.map((r) => r.queueRank)).size).toBe(queue.length);
    const reversed = [...queue].reverse();
    // Interleave so neither the sorted nor the reversed order is a hint.
    const mixed = [
      ...reversed.filter((_, i) => i % 2 === 0),
      ...reversed.filter((_, i) => i % 2 === 1),
    ];
    expect(ids(mixed.sort(compareQueue))).toEqual(ids(queue));
  });
});

describe("compareQueue", () => {
  it("orders by rank, lowest first", () => {
    const list = [ranked("a", 2048), ranked("b", -1024), ranked("c", 0.5)];
    expect(ids(list.sort(compareQueue))).toEqual(["b", "c", "a"]);
  });

  it("goes by rank before age", () => {
    const list = [
      ranked("old", 10, "2020-01-01T00:00:00.000Z"),
      ranked("new", 5, "2026-09-01T00:00:00.000Z"),
    ];
    expect(ids(list.sort(compareQueue))).toEqual(["new", "old"]);
  });

  it("breaks a rank tie by the older report first", () => {
    const list = [
      ranked("a", 512, "2026-09-02T00:00:00.000Z"),
      ranked("b", 512, "2026-09-01T00:00:00.000Z"),
    ];
    expect(ids(list.sort(compareQueue))).toEqual(["b", "a"]);
  });

  it("breaks a rank and age tie by id, the same way every time", () => {
    const list = [ranked("b", 512), ranked("a", 512), ranked("c", 512)];
    expect(ids([...list].sort(compareQueue))).toEqual(["a", "b", "c"]);
    expect(ids([...list].reverse().sort(compareQueue))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts unranked reports after every ranked one", () => {
    const list = [
      report("u1", { createdAt: "2020-01-01T00:00:00.000Z" }),
      ranked("r1", 1e9),
      report("u2"),
      ranked("r2", -1e9),
    ];
    expect(ids(list.sort(compareQueue))).toEqual(["r2", "r1", "u1", "u2"]);
  });

  it("orders unranked reports among themselves by age, then id", () => {
    // Infinity - Infinity is NaN; it must fall through to the tie-break
    // rather than be taken as an answer.
    const list = [
      report("c", { createdAt: "2026-09-03T00:00:00.000Z" }),
      report("b", { createdAt: "2026-09-01T00:00:00.000Z" }),
      report("a", { createdAt: "2026-09-03T00:00:00.000Z" }),
    ];
    expect(ids(list.sort(compareQueue))).toEqual(["b", "a", "c"]);
  });

  it("is antisymmetric, so sort gets a consistent answer", () => {
    const list = [
      ranked("a", 0),
      ranked("b", 0),
      ranked("c", 1, "2020-01-01T00:00:00.000Z"),
      report("d"),
      report("e", { createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    for (const x of list) {
      expect(compareQueue(x, x)).toBe(0);
      for (const y of list) {
        if (x === y) continue;
        expect(Math.sign(compareQueue(x, y))).toBe(
          -Math.sign(compareQueue(y, x)),
        );
        expect(compareQueue(x, y)).not.toBe(0);
      }
    }
  });
});

describe("compareNewest", () => {
  it("puts the newest report first", () => {
    const list = [
      report("mid", { createdAt: "2026-09-02T00:00:00.000Z" }),
      report("old", { createdAt: "2026-09-01T00:00:00.000Z" }),
      report("new", { createdAt: "2026-09-03T00:00:00.000Z" }),
    ];
    expect(ids(list.sort(compareNewest))).toEqual(["new", "mid", "old"]);
  });

  it("ignores rank - outside the queue it means nothing", () => {
    const list = [
      report("old", { createdAt: "2026-09-01T00:00:00.000Z", queueRank: -5 }),
      report("new", { createdAt: "2026-09-03T00:00:00.000Z", queueRank: 99 }),
    ];
    expect(ids(list.sort(compareNewest))).toEqual(["new", "old"]);
  });

  it("breaks a tie by id, the same way every time", () => {
    const list = [report("b"), report("c"), report("a")];
    expect(ids([...list].sort(compareNewest))).toEqual(["a", "b", "c"]);
    expect(ids([...list].reverse().sort(compareNewest))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not trip over a report without an id", () => {
    const noId = { ...report("x"), id: undefined };
    expect(compareNewest(noId, report("a"))).toBeLessThan(0);
    expect(compareNewest(report("a"), noId)).toBeGreaterThan(0);
  });
});
