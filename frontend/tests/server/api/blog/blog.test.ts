import { describe, it, expect, vi, beforeEach } from "vitest";
import listHandler from "../../../../server/api/blog/index.get";
import postHandler from "../../../../server/api/blog/[slug].get";

const { stored, runtime, queried } = vi.hoisted(() => {
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.createError = (err: any) => Object.assign(new Error(), err);
  globalThis.getRouterParam = (event: any, name: string) =>
    event.context.params[name];
  const runtime = { isLocal: false };
  return {
    stored: [] as any[],
    runtime,
    queried: [] as string[],
  };
});

// What decides whether drafts are served. The test environment is a local
// build, so the real config would always say yes.
vi.mock("../../../../server/utils/blog", async (original) => ({
  ...(await original<typeof import("../../../../server/utils/blog")>()),
  blogShowsDrafts: () => runtime.isLocal,
}));

// The collection as Nuxt Content would answer it, without its database.
vi.mock("@nuxt/content/server", () => ({
  queryCollection: () => ({
    all: async () => stored,
    path: (path: string) => {
      queried.push(path);
      return { first: async () => stored.find((p) => p.path === path) ?? null };
    },
  }),
}));

const post = (slug: string, extra: Record<string, unknown> = {}) => ({
  path: `/blog/${slug}`,
  title: `Wpis ${slug}`,
  description: "Opis.",
  date: "2026-10-11",
  authors: ["Autor"],
  draft: false,
  body: { type: "minimark", value: [["p", {}, "Tekst wpisu."]] },
  ...extra,
});

const request = (slug: string) => ({ context: { params: { slug } } }) as any;

beforeEach(() => {
  stored.length = 0;
  queried.length = 0;
  runtime.isLocal = false;
});

describe("GET /api/blog", () => {
  it("lists posts newest first, without their bodies", async () => {
    stored.push(
      post("starszy", { date: "2026-09-01" }),
      post("nowszy", { date: "2026-10-01" }),
    );
    const listed = await listHandler({} as any);
    expect(listed.map((p) => p.slug)).toEqual(["nowszy", "starszy"]);
    expect(listed[0]).not.toHaveProperty("body");
    expect(listed[0]).toMatchObject({ readingMinutes: 1, draft: false });
  });

  it("keeps drafts to local builds", async () => {
    stored.push(post("gotowy"), post("szkic", { draft: true }));
    expect((await listHandler({} as any)).map((p) => p.slug)).toEqual([
      "gotowy",
    ]);
    runtime.isLocal = true;
    expect((await listHandler({} as any)).map((p) => p.slug)).toContain(
      "szkic",
    );
  });
});

describe("GET /api/blog/[slug]", () => {
  it("serves a post with its body", async () => {
    stored.push(post("radni"));
    const served = await postHandler(request("radni"));
    expect(served).toMatchObject({ slug: "radni", title: "Wpis radni" });
    expect(served.body.value).toEqual([["p", {}, "Tekst wpisu."]]);
  });

  it("answers a draft in production as it answers a missing post", async () => {
    stored.push(post("szkic", { draft: true }));
    await expect(postHandler(request("szkic"))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(postHandler(request("nie-ma"))).rejects.toMatchObject({
      statusCode: 404,
    });
    runtime.isLocal = true;
    await expect(postHandler(request("szkic"))).resolves.toMatchObject({
      draft: true,
    });
  });

  it("does not query for a slug no file could be named", async () => {
    await expect(postHandler(request("../content"))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(queried).toEqual([]);
  });
});
