import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authCachedEventHandler,
  bodyWantsLatest,
  editorFreshCachedEventHandler,
  readerAwareCachedEventHandler,
  wantsLatest,
} from "../../../server/utils/handlers";

/** Who asked the token check, and which requests the cache was asked to
 * answer. Hoisted, because the nitro globals below have to exist before
 * handlers.ts is imported. */
const seen = vi.hoisted(() => {
  const seen = { verified: 0, cached: [] as unknown[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // What nitro's cache does to a request on the way in: the handler runs on a
  // copy of the event whose headers are cut down to `varies` - none, here -
  // and which shares the original's context.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => async (event: any) => {
    seen.cached.push(event);
    return fn({ ...event, headers: {} });
  };
  globalThis.setResponseHeader = ((
    event: { responseHeaders: Record<string, string> },
    name: string,
    value: string,
  ) => {
    event.responseHeaders[name] = value;
  }) as never;
  return seen;
});

// The token check standing in for Firebase: only "good" verifies.
vi.mock("../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) => {
    seen.verified += 1;
    return event.headers?.authorization === "Bearer good"
      ? { uid: "reader" }
      : null;
  },
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
}));

type FakeEvent = {
  query: Record<string, string>;
  headers: Record<string, string>;
  context: Record<string, unknown>;
  responseHeaders: Record<string, string>;
};

function request(
  options: { query?: Record<string, string>; token?: string } = {},
): FakeEvent {
  return {
    query: options.query ?? {},
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    context: {},
    responseHeaders: {},
  };
}

/** What a draft-aware route does: ask, and report what it was told. */
const draftsHandler = async (event: FakeEvent) => ({
  drafts: await wantsLatest(event as never),
});

// The wrappers are typed for h3's handlers; these fakes are all they read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (handler: any, event: FakeEvent) => handler(event);

beforeEach(() => {
  seen.verified = 0;
  seen.cached.length = 0;
});

describe("wantsLatest", () => {
  it("is false for a url that does not ask, and verifies nothing", async () => {
    // The logged out traffic the caches exist for never pays for a token
    // check.
    expect(await wantsLatest(request({ token: "good" }) as never)).toBe(false);
    expect(seen.verified).toBe(0);
  });

  it("is false for `latest` with no token behind it", async () => {
    // The 2026-09-14 and 2026-10-14 probes: a curl with the flag and nothing
    // else was handed unpublished people by name.
    const event = request({ query: { latest: "true" } });
    expect(await wantsLatest(event as never)).toBe(false);
  });

  it("is false for `latest` with a token that does not verify", async () => {
    const event = request({ query: { latest: "true" }, token: "forged" });
    expect(await wantsLatest(event as never)).toBe(false);
  });

  it("is true for `latest` with a verified token", async () => {
    const event = request({ query: { latest: "true" }, token: "good" });
    expect(await wantsLatest(event as never)).toBe(true);
  });

  it("is false for `latest=false`, whoever asks", async () => {
    const event = request({ query: { latest: "false" }, token: "good" });
    expect(await wantsLatest(event as never)).toBe(false);
  });

  it("verifies the token once per request", async () => {
    const event = request({ query: { latest: "true" }, token: "good" });
    await wantsLatest(event as never);
    await wantsLatest(event as never);
    expect(seen.verified).toBe(1);
  });
});

describe("bodyWantsLatest", () => {
  it("wants the token as much as the url does", async () => {
    const asks = { latest: true };
    expect(await bodyWantsLatest(request() as never, asks)).toBe(false);
    expect(
      await bodyWantsLatest(request({ token: "good" }) as never, asks),
    ).toBe(true);
  });

  it("is false for a body that does not ask", async () => {
    const event = request({ token: "good" });
    expect(await bodyWantsLatest(event as never, { latest: false })).toBe(
      false,
    );
    expect(await bodyWantsLatest(event as never, {})).toBe(false);
    expect(await bodyWantsLatest(event as never, null)).toBe(false);
  });
});

describe("editorFreshCachedEventHandler", () => {
  const handler = editorFreshCachedEventHandler(draftsHandler as never);

  it("serves a logged out reader the public answer from the cache", async () => {
    const event = request();
    expect(await run(handler, event)).toEqual({ drafts: false });
    expect(seen.cached).toHaveLength(1);
  });

  it("serves a signed in reader who asks the drafts, uncached and unstored", async () => {
    const event = request({ query: { latest: "true" }, token: "good" });
    expect(await run(handler, event)).toEqual({ drafts: true });
    expect(seen.cached).toHaveLength(0);
    expect(event.responseHeaders["Cache-Control"]).toMatch(/no-store/);
  });

  it("serves `latest` with no token the public answer, and lets nothing keep it", async () => {
    // Not from the cache and not into one: Cloud CDN keys on the url, and the
    // next request for this url may be an editor's, with a token.
    const event = request({ query: { latest: "true" } });
    expect(await run(handler, event)).toEqual({ drafts: false });
    expect(seen.cached).toHaveLength(0);
    expect(event.responseHeaders["Cache-Control"]).toMatch(/no-store/);
  });

  it("keeps an editor cache to verified readers", async () => {
    const shared = editorFreshCachedEventHandler(draftsHandler as never, {
      editorMaxAge: 300,
    });

    const editor = request({ query: { latest: "true" }, token: "good" });
    // Served from the editor's entry, which only a verified reader reaches -
    // and the handler inside it still knows who that is, though the cache
    // stripped the token on the way in.
    expect(await run(shared, editor)).toEqual({ drafts: true });
    expect(seen.cached).toEqual([editor]);

    const stranger = request({ query: { latest: "true" } });
    expect(await run(shared, stranger)).toEqual({ drafts: false });
    expect(seen.cached).toEqual([editor]);
  });
});

describe("readerAwareCachedEventHandler", () => {
  const handler = readerAwareCachedEventHandler((async (event: FakeEvent) => ({
    hasUser: event.context.hasUser,
  })) as never);

  it("shares one cached answer between logged out readers", async () => {
    expect(await run(handler, request())).toEqual({ hasUser: false });
    expect(seen.cached).toHaveLength(1);
  });

  it("answers a signed in reader uncached", async () => {
    const event = request({ token: "good" });
    expect(await run(handler, event)).toEqual({ hasUser: true });
    expect(seen.cached).toHaveLength(0);
    expect(event.responseHeaders["Cache-Control"]).toMatch(/no-store/);
  });

  it("keeps the public answer to a `latest` url out of every cache", async () => {
    const event = request({ query: { latest: "true" } });
    expect(await run(handler, event)).toEqual({ hasUser: false });
    expect(seen.cached).toHaveLength(0);
    expect(event.responseHeaders["Cache-Control"]).toMatch(/no-store/);
  });
});

describe("a draft-aware handler behind the plain cache", () => {
  it("is never shown the drafts, token or not", async () => {
    // `authCachedEventHandler` resolves nobody, and inside the cache the token
    // is gone: asking from there fails closed rather than trusting the flag.
    const handler = authCachedEventHandler(draftsHandler as never);
    const event = request({ query: { latest: "true" }, token: "good" });
    expect(await run(handler, event)).toEqual({ drafts: false });
  });
});
