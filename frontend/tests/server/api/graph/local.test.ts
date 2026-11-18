import { describe, it, expect, vi, beforeEach } from "vitest";
import getHandler from "../../../../server/api/graph/local/[id].get";
import postHandler from "../../../../server/api/graph/local/[id].post";

/** What each request asked `getLocalGraph` for. Hoisted with the nitro
 * globals, which have to exist before the routes are imported. */
const asked = vi.hoisted(() => {
  const asked = {
    showUnapproved: [] as boolean[],
    skip: [] as (string | undefined)[],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  globalThis.setResponseHeader = (() => {}) as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  return asked;
});

vi.mock("../../../../server/utils/localGraph", () => ({
  getLocalGraph: async (
    _focus: string,
    showUnapproved: boolean,
    _distance: number,
    _expansions: string[],
    _peers: string[],
    skip?: string,
  ) => {
    asked.showUnapproved.push(showUnapproved);
    asked.skip.push(skip);
    return { nodes: {}, edges: [], nodeGroups: [] };
  },
}));
// A bearer header is a signed in reader; Firebase is not what is under test.
vi.mock("../../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization ? { uid: "reader" } : null,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
  getRouterParam: () => "person-1",
  readBody: async (event: { body?: unknown }) => event.body,
}));

function request(
  options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    signedIn?: boolean;
  } = {},
) {
  return {
    query: options.query ?? {},
    body: options.body,
    headers: options.signedIn ? { authorization: "Bearer token" } : {},
    context: {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (handler: any, event: ReturnType<typeof request>) =>
  handler(event);

describe("/api/graph/local/[id]", () => {
  beforeEach(() => {
    asked.showUnapproved.length = 0;
    asked.skip.length = 0;
  });

  it("leaves out the one relation type a page asks it to, and nothing it does not know", async () => {
    // A region page draws none of its candidacies from the graph.
    await call(getHandler, request({ query: { skip: "election" } }));
    await call(getHandler, request({ query: { skip: "nonsense" } }));
    await call(getHandler, request());
    expect(asked.skip).toEqual(["election", undefined, undefined]);
  });

  it("draws a logged out reader who types `latest` the published graph", async () => {
    // Verified against production on 2026-09-14 with no Authorization header:
    // the same url drew 13 unpublished people by name once `&latest=true` was
    // on it.
    await call(getHandler, request({ query: { latest: "true" } }));
    expect(asked.showUnapproved).toEqual([false]);
  });

  it("draws a signed in reader the drafts", async () => {
    await call(
      getHandler,
      request({ query: { latest: "true" }, signedIn: true }),
    );
    expect(asked.showUnapproved).toEqual([true]);
  });

  it("gives a POST's `latest` to a token only", async () => {
    // The table's request, which sent `latest: true` for every reader.
    const body = { subjects: "person-2", distance: 1, latest: true };
    await call(postHandler, request({ body }));
    await call(postHandler, request({ body, signedIn: true }));
    expect(asked.showUnapproved).toEqual([false, true]);
  });

  it("draws a signed in reader who does not ask the published graph", async () => {
    await call(
      postHandler,
      request({ body: { latest: false }, signedIn: true }),
    );
    expect(asked.showUnapproved).toEqual([false]);
  });
});
