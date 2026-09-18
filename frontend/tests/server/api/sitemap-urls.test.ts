import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/_sitemap-urls";

const { mockFetchNodes } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  // The handler is wrapped in nitro's cache; here it runs straight through.
  globals.defineCachedEventHandler = (fn: unknown) => fn;

  const mockFetchNodes = vi.fn();
  globals.fetchNodes = mockFetchNodes;
  return { mockFetchNodes };
});

vi.mock("~~/server/utils/fetch", () => ({ fetchNodes: mockFetchNodes }));

const call = () =>
  (handler as unknown as () => Promise<{ loc: string; lastmod?: string }[]>)();

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
});

describe("/api/_sitemap-urls", () => {
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

    const urls = await call();

    expect(urls).toHaveLength(2);
    expect(urls).toContainEqual({
      loc: expect.stringContaining("/osoba/"),
      lastmod: "2026-03-26T08:30:00.000Z",
    });
    expect(urls).toContainEqual({
      loc: expect.stringContaining("/instytucja/"),
      lastmod: "2026-09-17T09:00:00.000Z",
    });
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

    const urls = await call();

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

    const urls = await call();

    expect(urls).toHaveLength(1);
    expect(urls[0]!.loc).toContain("/artykul/");
  });

  it("asks for no collection beyond the three it already read", async () => {
    // The point of storing the date on the node: a sweep of `edges` here would
    // be ~50,000 documents per cache miss, and a source that misses the
    // module's 5 s timeout yields an empty sitemap served 200.
    nodesByType({});

    await call();

    expect(mockFetchNodes).toHaveBeenCalledTimes(3);
    expect(mockFetchNodes.mock.calls.map(([type]) => type)).toEqual([
      "person",
      "article",
      "place",
    ]);
  });
});
