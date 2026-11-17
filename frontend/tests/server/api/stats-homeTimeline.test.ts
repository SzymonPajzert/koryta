import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  storedTimeline,
  type HomeTimelineResponse,
} from "../../../server/api/stats/homeTimeline.get";
import { HOME_TIMELINE_DOC } from "../../../server/utils/homeTimelineSnapshot";
import { warsawDate } from "../../../shared/dates";

const { mockFetchNodes, state } = vi.hoisted(() => ({
  mockFetchNodes: vi.fn(),
  state: { db: null as unknown },
}));

vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => state.db,
  FieldPath: { documentId: () => "__name__" },
}));
vi.mock("~~/server/utils/edgeNodes", () => ({
  fetchEdgeEndpointNodes: mockFetchNodes,
}));
// The handler is wrapped in nitro's response cache; here it runs straight
// through.
vi.mock("~~/server/utils/handlers", () => ({
  editorFreshCachedEventHandler: (fn: unknown) => fn,
}));

const TODAY = "2026-11-17";
const YESTERDAY = "2026-11-16";

/** A count as it was stored, small enough to tell from a fresh one: the fresh
 * one below has a post, this one has none. */
const STORED: HomeTimelineResponse = {
  months: ["2026-11"],
  groupings: { party: [], region: [], category: [] },
  coverage: {
    party: { posts: 0, people: 0 },
    region: { posts: 0, people: 0 },
    category: { posts: 0, people: 0 },
  },
  posts: 0,
  today: "2026-11",
};

type Doc = { id: string; data: () => Record<string, unknown> };

/** One published post, PO's, which a count turns into one line. */
const EDGE: Doc = {
  id: "e1",
  data: () => ({
    type: "employed",
    published: true,
    source: "p1",
    target: "c1",
    start_date: "2025-01-15",
    end_date: null,
  }),
};

/** A database holding `stored` under stats/home_timeline, and one post. */
function fakeDb(stored: Record<string, unknown> | null) {
  const writes: Record<string, unknown>[] = [];
  const edgeScans = vi.fn();
  let held = stored;

  const query = (docs: Doc[], onGet?: () => void) => {
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      startAfter: () => q,
      select: () => q,
      get: async () => {
        onGet?.();
        return { size: docs.length, empty: docs.length === 0, docs };
      },
    };
    return q;
  };

  const db = {
    collection: (name: string) => {
      if (name === "stats") {
        return {
          doc: (id: string) => {
            expect(id).toBe(HOME_TIMELINE_DOC);
            return {
              get: async () => ({
                exists: held !== null,
                data: () => held ?? undefined,
              }),
              set: async (doc: Record<string, unknown>) => {
                writes.push(doc);
                held = doc;
              },
            };
          },
        };
      }
      if (name === "edges") return query([EDGE], edgeScans);
      if (name === "nodes") return query([]);
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as FirebaseFirestore.Firestore;

  return { db, writes, edgeScans };
}

function storedOn(countedOn: string) {
  return {
    type: "home_timeline",
    countedOn,
    timeline: STORED,
    computedAt: `${countedOn}T03:00:00.000Z`,
  };
}

/** An event that hands back what was left to run after the answer. */
function fakeEvent() {
  const behind: Promise<unknown>[] = [];
  return {
    event: { waitUntil: (promise: Promise<unknown>) => behind.push(promise) },
    behind,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchNodes.mockResolvedValue(
    new Map<string, Record<string, unknown>>([
      ["p1", { type: "person", published: true, parties: ["PO"] }],
      ["c1", { type: "company", published: true }],
    ]),
  );
});

describe("/api/stats/homeTimeline", () => {
  it("serves today's count without counting again", async () => {
    const { db, writes, edgeScans } = fakeDb(storedOn(TODAY));
    const { event, behind } = fakeEvent();

    expect(await storedTimeline(db, TODAY, event)).toEqual(STORED);
    // The whole point: no scan of the edges on the way to a reader.
    expect(edgeScans).not.toHaveBeenCalled();
    expect(behind).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("serves yesterday's count at once, and counts again behind it", async () => {
    const { db, writes } = fakeDb(storedOn(YESTERDAY));
    const { event, behind } = fakeEvent();

    expect(await storedTimeline(db, TODAY, event)).toEqual(STORED);
    expect(behind).toHaveLength(1);

    await Promise.all(behind);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      type: "home_timeline",
      countedOn: TODAY,
    });
    expect((writes[0]!.timeline as HomeTimelineResponse).posts).toBe(1);
  });

  it("makes the first reader wait for the first count, and stores it", async () => {
    const { db, writes } = fakeDb(null);
    const { event, behind } = fakeEvent();

    const timeline = await storedTimeline(db, TODAY, event);

    expect(timeline.posts).toBe(1);
    expect(timeline.groupings.party.map((line) => line.key)).toEqual(["PO"]);
    expect(behind).toHaveLength(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ countedOn: TODAY, timeline });
  });

  it("counts again when the stored document does not read as a count", async () => {
    const { db, writes } = fakeDb({ type: "home_timeline", countedOn: TODAY });

    const timeline = await storedTimeline(db, TODAY, fakeEvent().event);

    expect(timeline.posts).toBe(1);
    expect(writes).toHaveLength(1);
  });

  it("starts one count for readers who arrive together", async () => {
    const { db, writes, edgeScans } = fakeDb(null);

    const [first, second] = await Promise.all([
      storedTimeline(db, TODAY, fakeEvent().event),
      storedTimeline(db, TODAY, fakeEvent().event),
    ]);

    expect(first).toEqual(second);
    expect(edgeScans).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
  });

  it("keeps serving yesterday's count when counting again fails", async () => {
    const { db, writes } = fakeDb(storedOn(YESTERDAY));
    const { event, behind } = fakeEvent();
    mockFetchNodes.mockRejectedValue(new Error("deadline exceeded"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await storedTimeline(db, TODAY, event)).toEqual(STORED);
    // Left behind the answer, the failure is logged rather than thrown at
    // nobody.
    await expect(Promise.all(behind)).resolves.toBeDefined();
    expect(spy).toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    spy.mockRestore();
  });

  it("reads the count stored for the Warsaw day", async () => {
    const { db, edgeScans } = fakeDb(storedOn(warsawDate()));
    state.db = db;

    const call = handler as unknown as (
      event: unknown,
    ) => Promise<HomeTimelineResponse>;

    expect(await call(fakeEvent().event)).toEqual(STORED);
    expect(edgeScans).not.toHaveBeenCalled();
  });
});
