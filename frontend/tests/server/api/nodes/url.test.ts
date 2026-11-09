import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/url.get";

/** What the sitemap's sources list together: the public pages, at their
 * addresses. Each `/api/_sitemap-urls/<type>` answers with its own type's. */
let sitemap: { loc: string }[] = [];
let id: string | undefined;

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

const pathOfType: Record<string, string> = {
  person: "/osoba/",
  place: "/instytucja/",
  article: "/artykul/",
};

/** The internal fetch Nitro hangs on every event, which is how the handler
 * reaches the sitemap's cached lists. */
const $fetch = vi.fn(async (url: string) => {
  const type = url.replace("/api/_sitemap-urls/", "");
  expect(Object.keys(pathOfType)).toContain(type);
  return sitemap.filter(({ loc }) => loc.startsWith(pathOfType[type]!));
});

const call = () =>
  handler({ $fetch } as never) as unknown as Promise<{ url: string }>;

describe("GET /api/nodes/[id]/url", () => {
  beforeEach(() => {
    $fetch.mockClear();
    sitemap = [
      { loc: "/osoba/adam-niedzialek-SVb31mmNOMmlOy1BsPhH" },
      { loc: "/instytucja/amw-invest-warszawa-aRhVbgfIke5i6PqDBZY5" },
      { loc: "/artykul/1-7-mln-dla-mlodego-lekarza-DRf5LYAdf5TwXKDZYMcP" },
    ];
    globalThis.getRouterParam = vi.fn(() => id) as never;
  });

  it("finds the page an id names once its capitals are gone", async () => {
    // How the canonical read until 2026-08-08, and so how Google still asks.
    id = "svb31mmnommloy1bsphh";
    expect(await call()).toEqual({
      url: "/osoba/adam-niedzialek-SVb31mmNOMmlOy1BsPhH",
    });
  });

  it("finds it with the full stop of a pasted sentence on the end", async () => {
    id = "aRhVbgfIke5i6PqDBZY5.";
    expect(await call()).toEqual({
      url: "/instytucja/amw-invest-warszawa-aRhVbgfIke5i6PqDBZY5",
    });
  });

  it("answers 404 for an id no public page has", async () => {
    // An unpublished page is not in the sitemap, so a mangled link to one
    // stays a dead end rather than revealing where it is.
    id = "xxxxxxxxxxxxxxxxxxxx";
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("will not guess between two pages whose ids differ only in case", async () => {
    sitemap.push({ loc: "/osoba/adam-niedzialek-svb31mmNOMmlOy1BsPhH" });
    id = "svb31mmnommloy1bsphh";
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("searches the list of every page type, and only those", async () => {
    id = "DRf5LYAdf5TwXKDZYMcP";
    expect(await call()).toEqual({
      url: "/artykul/1-7-mln-dla-mlodego-lekarza-DRf5LYAdf5TwXKDZYMcP",
    });
    expect($fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      "/api/_sitemap-urls/article",
      "/api/_sitemap-urls/person",
      "/api/_sitemap-urls/place",
    ]);
  });

  it("refuses an id that is nothing but punctuation", async () => {
    id = "...";
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
  });
});
