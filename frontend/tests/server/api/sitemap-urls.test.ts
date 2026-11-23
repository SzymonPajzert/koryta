import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../server/api/_sitemap-urls/[source]";
import { SITEMAP_NODE_TYPES } from "../../../shared/lastmod";

type Event = { context: { params: { source?: string } }; path?: string };
type Entry = { loc: string; lastmod?: string };

const { mockFetchNodes, cacheOptions, posts } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  const cacheOptions: { getKey?: (event: unknown) => string } = {};
  // The handler is wrapped in nitro's cache; here it runs straight through,
  // and the options it was cached with are kept to look at.
  globals.defineCachedEventHandler = (fn: unknown, options: object) => {
    Object.assign(cacheOptions, options);
    return fn;
  };
  globals.getRouterParam = (event: Event, name: "source") =>
    event.context.params[name];
  globals.createError = (error: object) => Object.assign(new Error(), error);

  const mockFetchNodes = vi.fn();
  globals.fetchNodes = mockFetchNodes;
  const posts: {
    path: string;
    date: string;
    title: string;
    draft?: boolean;
  }[] = [];
  return { mockFetchNodes, cacheOptions, posts };
});

vi.mock("~~/server/utils/fetch", () => ({ fetchNodes: mockFetchNodes }));

/** `stats` documents, where a list is stored for a six-hour window. */
const { stats } = vi.hoisted(() => ({
  stats: new Map<string, Record<string, unknown>>(),
}));

vi.mock("firebase-admin/firestore", () => {
  const ref = (id: string) => ({
    id,
    get: async () => ({
      exists: stats.has(id),
      data: () => stats.get(id),
    }),
  });
  const db = {
    collection: (name: string) => {
      if (name !== "stats") throw new Error(`read of ${name}`);
      return { doc: ref };
    },
    getAll: async (...refs: { id: string }[]) =>
      Promise.all(refs.map((r) => ref(r.id).get())),
    batch: () => {
      const writes: [string, Record<string, unknown>][] = [];
      return {
        set: (r: { id: string }, data: Record<string, unknown>) =>
          writes.push([r.id, data]),
        commit: async () => {
          for (const [id, data] of writes) stats.set(id, data);
        },
      };
    },
  };
  return { getFirestore: () => db };
});

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Blog posts reach the sitemap through Nuxt Content, which has no database
// here; the tests hand it the posts.
vi.mock("~~/server/utils/blog", () => ({
  blogPosts: () => ({ all: async () => posts }),
}));

const event = (source: string, path = `/api/_sitemap-urls/${source}`) =>
  ({ context: { params: { source } }, path }) as Event;

const call = (source: string) =>
  (handler as unknown as (event: Event) => Promise<Entry[]>)(event(source));

const revisions = (latest_time: string, has_unapproved = false) => ({
  latest_id: "r1",
  latest_time,
  total: 1,
  has_unapproved,
});

/** Answers `fetchNodes(type)` from one flat map of nodes. */
const nodesByType = (nodes: Record<string, Record<string, unknown>>) => {
  mockFetchNodes.mockImplementation(async (type: string) =>
    Object.fromEntries(
      Object.entries(nodes).filter(([, node]) => node.type === type),
    ),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchNodes.mockResolvedValue({});
  posts.length = 0;
  stats.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/api/_sitemap-urls/[source]", () => {
  it("dates every url it emits", async () => {
    nodesByType({
      p1: {
        type: "person",
        name: "Jan Kowalski",
        published: true,
        revisions: revisions("2026-03-26T08:30:00.000Z"),
      },
      c1: {
        type: "place",
        name: "Koleje Dolnośląskie",
        published: true,
        // A relation was published on this company yesterday; nothing wrote the
        // company's own document, which is the case the field exists for.
        content_changed_at: "2026-09-17T09:00:00.000Z",
        revisions: revisions("2026-08-29T02:10:00.000Z"),
      },
    });

    expect(await call("person")).toEqual([
      {
        loc: expect.stringContaining("/osoba/"),
        lastmod: "2026-03-26T08:30:00.000Z",
      },
    ]);
    expect(await call("place")).toEqual([
      {
        loc: expect.stringContaining("/instytucja/"),
        lastmod: "2026-09-17T09:00:00.000Z",
      },
    ]);
  });

  it("keeps the url when there is no date to put on it", async () => {
    nodesByType({
      p1: {
        type: "person",
        name: "Jan Kowalski",
        published: true,
        // Newest revision unapproved and never published through this app: the
        // 7 pages in that state go out without a `lastmod` rather than with a
        // date for a change no reader can see.
        revisions: revisions("2026-09-17T09:00:00.000Z", true),
      },
    });

    const urls = await call("person");

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toHaveProperty("lastmod");
    expect(urls[0]!.loc).toContain("/osoba/");
  });

  it("still lists only published, named, page-bearing nodes", async () => {
    nodesByType({
      draft: {
        type: "person",
        name: "Szkic",
        published: false,
        revisions: revisions("2026-09-17T09:00:00.000Z"),
      },
      unnamed: {
        type: "person",
        published: true,
        revisions: revisions("2026-09-17T09:00:00.000Z"),
      },
      gone: {
        type: "person",
        name: "Usunięty",
        published: true,
        deleted: true,
        revisions: revisions("2026-09-17T09:00:00.000Z"),
      },
      live: {
        type: "article",
        name: "Artykuł",
        published: true,
        revisions: revisions("2026-08-22T00:00:00.000Z"),
      },
    });

    expect(await call("person")).toEqual([]);
    const articles = await call("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!.loc).toContain("/artykul/");
  });

  it("reads only the type it was asked for", async () => {
    // The point of a source per type: the people's sitemap no longer waits on,
    // or pays for, the sweep of every company. And none of them reads more
    // than the nodes - a sweep of `edges` here would be ~50,000 documents per
    // cache miss, and a source that misses the module's 5 s timeout yields an
    // empty sitemap served 200.
    for (const type of SITEMAP_NODE_TYPES) {
      mockFetchNodes.mockClear();
      await call(type);
      expect(mockFetchNodes.mock.calls).toEqual([[type]]);
    }

    mockFetchNodes.mockClear();
    await call("blog");
    expect(mockFetchNodes).not.toHaveBeenCalled();
  });

  it("lists every page once across the page types", async () => {
    nodesByType({
      p1: { type: "person", name: "Jan Kowalski", published: true },
      p2: { type: "person", name: "Anna Nowak", published: true },
      c1: { type: "place", name: "Orlen", published: true },
      a1: { type: "article", name: "Artykuł", published: true },
      // In no sitemap: a region has no page of its own.
      r1: { type: "region", name: "Łódź", published: true },
    });

    const lists = await Promise.all(SITEMAP_NODE_TYPES.map(call));
    const locs = lists.flat().map(({ loc }) => loc);

    expect(locs).toHaveLength(4);
    expect(new Set(locs).size).toBe(4);
    expect(locs.some((loc) => loc.includes("lodz"))).toBe(false);
  });

  it("lists the blog's published posts, dated, and never a draft", async () => {
    posts.push(
      { path: "/blog/stary", date: "2026-09-01", title: "Stary" },
      { path: "/blog/szkic", date: "2026-11-01", title: "Szkic", draft: true },
      { path: "/blog/nowy", date: "2026-10-01", title: "Nowy" },
    );

    expect(await call("blog")).toEqual([
      { loc: "/blog/nowy", lastmod: "2026-10-01" },
      { loc: "/blog/stary", lastmod: "2026-09-01" },
    ]);
  });

  it("answers 404 for a source that is not a page type", async () => {
    for (const source of ["region", "edges", ""]) {
      await expect(call(source)).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(mockFetchNodes).not.toHaveBeenCalled();
  });

  it("caches one answer per source, whatever the query string", () => {
    // Keyed on the path, a `?x=1` would be a fresh sweep of the type per
    // distinct query.
    const key = cacheOptions.getKey!;
    expect(key(event("person", "/api/_sitemap-urls/person?x=1"))).toBe(
      "person",
    );
    expect(key(event("person", "/api/_sitemap-urls/person?x=2"))).toBe(
      "person",
    );
    expect(key(event("place"))).toBe("place");
  });

  describe("stored once per backend and six-hour window", () => {
    function onCloudRun(build = "prod-build-001") {
      vi.stubEnv("K_SERVICE", "prod");
      vi.stubEnv("K_REVISION", build);
    }

    beforeEach(() => {
      vi.useFakeTimers();
      // 12:30 in Warsaw.
      vi.setSystemTime(new Date("2026-11-23T11:30:00Z"));
      nodesByType({
        p1: { type: "person", name: "Jan Kowalski", published: true },
        c1: { type: "place", name: "Orlen", published: true },
      });
    });

    it("reads the nodes once, and every later instance the stored list", async () => {
      onCloudRun();

      const first = await call("person");
      expect(stats.get("sitemapUrls_person_prod")).toMatchObject({
        key: "prod-build-001|2026-11-23T12",
        parts: 1,
      });

      mockFetchNodes.mockClear();
      expect(await call("person")).toEqual(first);
      expect(mockFetchNodes).not.toHaveBeenCalled();
    });

    it("keeps one list per page type", async () => {
      onCloudRun();

      for (const type of SITEMAP_NODE_TYPES) await call(type);

      expect([...stats.keys()].sort()).toEqual([
        "sitemapUrls_article_prod",
        "sitemapUrls_person_prod",
        "sitemapUrls_place_prod",
      ]);
    });

    it("builds the list again in the next window", async () => {
      onCloudRun();
      await call("person");

      vi.setSystemTime(new Date("2026-11-23T17:00:00Z"));
      mockFetchNodes.mockClear();
      await call("person");

      expect(mockFetchNodes.mock.calls).toEqual([["person"]]);
      expect(stats.get("sitemapUrls_person_prod")!.key).toBe(
        "prod-build-001|2026-11-23T18",
      );
    });

    it("stores nothing for the blog, which reads no database", async () => {
      onCloudRun();
      posts.push({ path: "/blog/nowy", date: "2026-10-01", title: "Nowy" });

      await call("blog");

      expect(stats.size).toBe(0);
    });

    it("builds the list on every call off Cloud Run", async () => {
      vi.stubEnv("K_SERVICE", "");
      vi.stubEnv("K_REVISION", "");

      await call("person");
      await call("person");

      expect(mockFetchNodes).toHaveBeenCalledTimes(2);
      expect(stats.size).toBe(0);
    });
  });
});
