import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  type MyInteractions,
} from "../../../../server/api/interactions/mine.get";
import type { Proposal } from "~~/shared/proposals";
import {
  scanMyVotes,
  type ScannedVote,
} from "../../../../server/utils/myVotes";

const { mockGetUser, scan, headers } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  return {
    mockGetUser: vi.fn(),
    // What the two scans find, set by each test.
    scan: {
      proposals: [] as Proposal[],
      votes: [] as ScannedVote[],
      truncated: { proposals: false, votes: false },
      uids: [] as string[],
      named: [] as string[][],
    },
    headers: new Map<string, string>(),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
}));
vi.mock("../../../../server/utils/auth", () => ({ getUser: mockGetUser }));
vi.mock("firebase-functions/logger", () => ({ logger: { error: vi.fn() } }));

vi.mock("../../../../server/utils/myProposals", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/myProposals")
  >()),
  scanMyProposals: vi.fn(async (_db: unknown, uid: string) => {
    scan.uids.push(uid);
    return { proposals: scan.proposals, truncated: scan.truncated.proposals };
  }),
}));

vi.mock("../../../../server/utils/myVotes", () => ({
  scanMyVotes: vi.fn(async (_db: unknown, uid: string) => {
    scan.uids.push(uid);
    return { votes: scan.votes, truncated: scan.truncated.votes };
  }),
  nameVotes: vi.fn(async (_db: unknown, votes: ScannedVote[]) => {
    scan.named.push(votes.map((vote) => vote.nodeId));
    return votes.map((vote) => ({
      ...vote,
      name: `Osoba ${vote.nodeId}`,
      path: `/osoba/${vote.nodeId}`,
    }));
  }),
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query?: unknown },
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

const call = (query: Record<string, string> = {}) =>
  (handler as unknown as (event: unknown) => Promise<MyInteractions>)({
    query,
  });

/** A proposal in `status`, filed at `hour` o'clock on 2026-11-20. */
const proposal = (id: string, hour: number, status: Proposal["status"]) =>
  ({
    id,
    status,
    updateTime: `2026-11-20T${String(hour).padStart(2, "0")}:00:00.000Z`,
  }) as Proposal;

const vote = (nodeId: string, hour: number): ScannedVote => ({
  nodeId,
  value: 2,
  updatedAt: `2026-11-20T${String(hour).padStart(2, "0")}:00:00.000Z`,
});

/** The rows as `p:<id>` and `v:<node>`, which is what the order is about. */
const keys = (result: MyInteractions) =>
  result.items.map((item) =>
    item.kind === "vote" ? `v:${item.vote.nodeId}` : `p:${item.proposal.id}`,
  );

describe("/api/interactions/mine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headers.clear();
    mockGetUser.mockResolvedValue({ uid: "me" });
    scan.proposals = [
      proposal("r1", 11, "pending"),
      proposal("r2", 8, "approved"),
      proposal("r3", 5, "superseded"),
    ];
    scan.votes = [vote("a", 10), vote("b", 9), vote("c", 6)];
    scan.truncated = { proposals: false, votes: false };
    scan.uids = [];
    scan.named = [];
  });

  it("merges proposals and votes, newest first", async () => {
    const result = await call();

    expect(keys(result)).toEqual(["p:r1", "v:a", "v:b", "p:r2", "v:c", "p:r3"]);
    expect(result.total).toBe(6);
    expect(result.counts).toEqual({
      pending: 1,
      approved: 1,
      superseded: 1,
      rejected: 0,
      votes: 3,
    });
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reads the record of the uid on the token, and no other", async () => {
    await call({ uid: "other" } as Record<string, string>);

    expect(scan.uids).toEqual(["me", "me"]);
  });

  it("pages through the merged list", async () => {
    const second = await call({ limit: "2", page: "2" });

    expect(keys(second)).toEqual(["v:b", "p:r2"]);
    expect(second.total).toBe(6);
  });

  it("names the people of the page's votes only", async () => {
    const result = await call({ limit: "2" });

    expect(scan.named).toEqual([["a"]]);
    const [, first] = result.items;
    expect(first).toMatchObject({
      kind: "vote",
      vote: { nodeId: "a", name: "Osoba a", path: "/osoba/a" },
    });
  });

  it("narrows to the votes", async () => {
    const result = await call({ filter: "votes" });

    expect(keys(result)).toEqual(["v:a", "v:b", "v:c"]);
    expect(result.total).toBe(3);
    // The chips count everything whatever the filter.
    expect(result.counts.pending).toBe(1);
  });

  it("narrows to proposals in a stored state, superseded with approved", async () => {
    expect(keys(await call({ filter: "approved" }))).toEqual(["p:r2", "p:r3"]);
    expect(keys(await call({ filter: "pending" }))).toEqual(["p:r1"]);
  });

  it("says which scan stopped at its cap", async () => {
    scan.truncated = { proposals: false, votes: true };

    expect((await call()).truncated).toEqual({
      proposals: false,
      votes: true,
    });
  });

  it("puts a proposal with no time on it last", async () => {
    scan.proposals = [{ ...proposal("old", 1, "approved"), updateTime: null }];

    expect(keys(await call())).toEqual(["v:a", "v:b", "v:c", "p:old"]);
  });

  it("turns away a reader who is not signed in", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("no token"), { statusCode: 401 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("keeps the proposals when the votes cannot be read", async () => {
    // What a missing composite index looks like from here.
    vi.mocked(scanMyVotes).mockRejectedValueOnce(
      Object.assign(new Error("9 FAILED_PRECONDITION"), { code: 9 }),
    );

    const result = await call();

    expect(keys(result)).toEqual(["p:r1", "p:r2", "p:r3"]);
    expect(result.counts.votes).toBe(0);
    expect(result.votesFailed).toBe(true);
  });

  it("says nothing about the votes when they were read", async () => {
    expect((await call()).votesFailed).toBeUndefined();
  });
});
