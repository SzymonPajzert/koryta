import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/badges.get";

/** Node documents, keyed by id, as `resolveMergedNode` hands them over. */
let nodes: Record<string, Record<string, unknown>> = {};

const { mockGetUser, mockResolve } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));
vi.mock("~~/server/utils/merge", () => ({ resolveMergedNode: mockResolve }));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (opts: any) =>
    Object.assign(new Error(opts.message), opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "person-1");

const call = () =>
  handler({} as never) as unknown as Promise<{
    badges: Record<string, { up: number; down: number }>;
    moderation: Record<string, string>;
  }>;

describe("GET /api/nodes/[id]/badges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.getRouterParam = vi.fn(() => "person-1");
    mockGetUser.mockResolvedValue({ uid: "reader-1" });
    // The real one follows `merged_into`; this double does the same in one hop,
    // which is what the merged-duplicate case below needs.
    mockResolve.mockImplementation(async (_db: unknown, id: string) => {
      const merged = nodes[id]?.merged_into;
      const resolved = typeof merged === "string" ? merged : id;
      const data = nodes[resolved];
      return {
        id: resolved,
        snapshot: {
          id: resolved,
          exists: data !== undefined,
          data: () => data,
        },
      };
    });
    nodes = {
      "person-1": {
        type: "person",
        name: "Anna Nowak",
        published: true,
        stats: {
          votes: { interesting: 4 },
          badges: {
            omnibus: { up: 4, down: 1 },
            spolecznik: { up: 3, down: 0 },
          },
        },
        badgeModeration: { omnibus: "approved", spolecznik: "hidden" },
      },
    };
  });

  it("answers a signed-in reader with the tallies and the verdicts", async () => {
    // Both halves, because `visibleBadges` needs both to decide anything: a
    // tally with no verdict cannot tell „awaiting” from „public”, and a verdict
    // with no tally cannot tell a proposal from a badge nobody has touched.
    expect(await call()).toEqual({
      badges: { omnibus: { up: 4, down: 1 }, spolecznik: { up: 3, down: 0 } },
      moderation: { omnibus: "approved", spolecznik: "hidden" },
    });
  });

  it("refuses a caller with no token, without reading anything", async () => {
    // The 401 is the whole cost argument for the endpoint (see its header): it
    // is uncached, so it pays a document read per call, and the person pages
    // are the most crawled part of the site. `getUser` has to come before the
    // first Firestore call or an anonymous loop still spends the reads.
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("Błąd uwierzytelniania: brak tokenu."), {
        statusCode: 401,
      }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("answers with empty maps for a person nobody has voted on", async () => {
    // The normal case by a wide margin: `computeBadgeStats` writes
    // `stats.badges` only once there is a vote to count, and `badgeModeration`
    // only once an editor has ruled. Empty maps rather than `undefined`, so the
    // client can adopt the answer without asking which of the two it got.
    nodes["person-1"] = { type: "person", name: "Anna Nowak", published: true };

    expect(await call()).toEqual({ badges: {}, moderation: {} });
  });

  it("returns nothing else off the node document", async () => {
    // The endpoint is narrow on purpose - two maps against a whole node - and
    // the narrowness is what justifies it existing next to `/api/nodes/[id]`.
    // A `...stored` that crept in here would ship the node's own fields, the
    // five-axis `stats.votes` among them, to a route nobody reviews for that.
    nodes["person-1"] = {
      ...nodes["person-1"],
      content: "Notatka redakcyjna",
      needs_split: { reason: "dwie osoby" },
    };

    const result = await call();
    expect(Object.keys(result).sort()).toEqual(["badges", "moderation"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Anna Nowak");
    expect(serialized).not.toContain("Notatka");
    expect(serialized).not.toContain("interesting");
  });

  it("drops keys that are not badges, and numbers that are not numbers", async () => {
    // `stats.badges` is recounted from `categoryVotes`, a map a signed-in
    // reader writes directly, so the only thing standing between a typed key
    // and the client is `isKnownBadge`. A tally that arrived as a string is the
    // same class of problem one layer down.
    nodes["person-1"] = {
      type: "person",
      stats: {
        badges: {
          omnibus: { up: "2", down: null },
          "nie-ma-takiej": { up: 9, down: 0 },
        },
      },
      badgeModeration: { omnibus: null, "nie-ma-takiej": "approved" },
    };

    expect(await call()).toEqual({
      badges: { omnibus: { up: 2, down: 0 } },
      // A cleared verdict is a deleted key (`FieldValue.delete()` in
      // badges.post.ts), so a stored `null` is not „no verdict” written down -
      // it is residue, and forwarding it would make an absent key and a null
      // one look different to the client's overlay.
      moderation: {},
    });
  });

  it("answers a merged duplicate with the survivor's badges", async () => {
    // The same `resolveMergedNode` the person page itself is served through,
    // so the section and the chips in the page header cannot disagree about
    // which human's tallies they are showing.
    nodes["person-1"] = { type: "person", merged_into: "person-2" };
    nodes["person-2"] = {
      type: "person",
      stats: { badges: { spolecznik: { up: 5, down: 2 } } },
    };

    expect((await call()).badges).toEqual({ spolecznik: { up: 5, down: 2 } });
  });

  it("404s on a page that does not exist", async () => {
    nodes = {};

    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });
});
