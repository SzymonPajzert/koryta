import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/stats/partyStack.get";
import type { PartyStackResponse } from "../../../server/utils/postTimelines";

const { wrappedWith, postTimelines } = vi.hoisted(() => ({
  wrappedWith: [] as string[],
  postTimelines: vi.fn(),
}));

vi.mock("~~/server/utils/handlers", () => ({
  editorFreshCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("editorFreshCachedEventHandler");
    return fn;
  },
}));

vi.mock("h3", () => ({
  getValidatedQuery: async (
    event: { query: unknown },
    parse: (query: unknown) => unknown,
  ) => parse(event.query),
}));

vi.mock("~~/server/utils/postTimelines", () => ({ postTimelines }));

/** A stack told apart from the others by its post count. */
const stack = (posts: number): PartyStackResponse => ({
  months: ["2026-10", "2026-11"],
  series: [{ key: "PO", label: "PO", counts: [1, 1] }],
  coverage: { posts, people: 1 },
  posts,
  today: "2026-11",
});

const call = (query: Record<string, string>) =>
  (handler as unknown as (event: unknown) => Promise<PartyStackResponse>)({
    query,
  });

beforeEach(() => {
  postTimelines.mockReset();
  postTimelines.mockResolvedValue({
    home: {},
    stacks: {
      all: stack(100),
      byCategory: { szpitale: stack(20), "skarb-panstwa": stack(13) },
    },
  });
});

describe("/api/stats/partyStack", () => {
  it("is cached like the home chart, an editor reading through it", () => {
    expect(wrappedWith).toEqual(["editorFreshCachedEventHandler"]);
  });

  it("answers for every institution when no category is asked", async () => {
    expect((await call({})).posts).toBe(100);
  });

  it("answers for the category asked", async () => {
    expect((await call({ category: "szpitale" })).posts).toBe(20);
    expect((await call({ category: "skarb-panstwa" })).posts).toBe(13);
  });

  it("refuses a category the site does not offer", async () => {
    // Every distinct url is its own cache entry; a closed list keeps a junk
    // value from making one.
    await expect(call({ category: "kasyna" })).rejects.toThrow();
    expect(postTimelines).not.toHaveBeenCalled();
  });
});
