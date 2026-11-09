import { describe, it, expect } from "vitest";
import type { NitroConfig } from "nitropack";
import {
  SITEMAP_FILES,
  serveSitemapIndexAtSitemapXml,
  sitemapOptions,
  sitemapSourceUrl,
} from "../../build/sitemap";
import { SITEMAP_NODE_TYPES } from "../../shared/lastmod";

describe("the child sitemaps", () => {
  const sources = Object.values(SITEMAP_FILES) as string[];

  it("give every page type in the sitemap exactly one file", () => {
    // A type in no file would drop out of every sitemap; a type in two would
    // list each of its pages twice.
    for (const type of SITEMAP_NODE_TYPES) {
      expect(sources.filter((source) => source === type)).toHaveLength(1);
    }
    expect(sources.filter((source) => source === "blog")).toHaveLength(1);
    expect(sources).toHaveLength(SITEMAP_NODE_TYPES.length + 1);
  });

  it("read each file from its own source", () => {
    const { sitemaps } = sitemapOptions();
    expect(Object.keys(sitemaps)).toEqual(Object.keys(SITEMAP_FILES));
    for (const [name, source] of Object.entries(SITEMAP_FILES)) {
      expect(sitemaps[name]!.sources).toEqual([sitemapSourceUrl(source)]);
    }
  });

  it("put the static pages in the blog's file and in no other", () => {
    const { sitemaps } = sitemapOptions();
    const withAppSources = Object.entries(sitemaps)
      .filter(([, sitemap]) => "includeAppSources" in sitemap)
      .map(([name]) => name);
    expect(withAppSources).toEqual(["sitemap-strony"]);
    expect(sitemaps["sitemap-strony"]).toMatchObject({
      includeAppSources: true,
    });
  });

  it("are served from the site root", () => {
    // A sitemap covers only the urls below its own directory unless it was
    // submitted in Search Console.
    expect(sitemapOptions().sitemapsPathPrefix).toBe("/");
  });

  it("have names the module will not read as a chunk", () => {
    for (const name of Object.keys(SITEMAP_FILES)) {
      expect(name).toMatch(/^sitemap-[a-z]+$/);
    }
  });
});

/** The shape @nuxtjs/sitemap 8 leaves the nitro config in with `sitemaps` set:
 * a handler at /sitemap.xml that redirects, the index at /sitemap_index.xml, a
 * route rule redirecting the one to the other, and the index's path added to
 * robots.txt. */
function moduleConfig(): NitroConfig {
  const robots = {
    groups: [],
    sitemap: ["/sitemap_index.xml"],
  };
  return {
    handlers: [
      {
        route: "/sitemap_index.xml",
        handler: "/sitemap/dist/runtime/server/routes/sitemap_index.xml",
        lazy: true,
        middleware: false,
      },
      {
        route: "/sitemap-osoby.xml",
        handler: "/sitemap/dist/runtime/server/routes/sitemap/[sitemap].xml",
        lazy: true,
        middleware: false,
      },
      {
        route: "/sitemap.xml",
        handler: "/sitemap/dist/runtime/server/routes/sitemap.xml",
      },
    ],
    routeRules: {
      "/": { swr: 3600 },
      "/sitemap.xml": { redirect: "/sitemap_index.xml" },
    },
    runtimeConfig: {
      "nuxt-robots": robots,
      public: { "nuxt-robots": robots },
    },
  } as unknown as NitroConfig;
}

describe("serveSitemapIndexAtSitemapXml", () => {
  it("serves the index at /sitemap.xml instead of redirecting there", () => {
    const config = moduleConfig();

    serveSitemapIndexAtSitemapXml(config);

    const route = (path: string) =>
      config.handlers!.find((handler) => handler?.route === path);
    expect(route("/sitemap.xml")!.handler).toBe(
      route("/sitemap_index.xml")!.handler,
    );
    expect(config.routeRules!["/sitemap.xml"]).not.toHaveProperty("redirect");
    // Nothing else moves.
    expect(route("/sitemap-osoby.xml")!.handler).toContain("[sitemap].xml");
    expect(config.routeRules!["/"]).toEqual({ swr: 3600 });
  });

  it("names /sitemap.xml in robots.txt, once", () => {
    const config = moduleConfig();
    const robots = (config.runtimeConfig as Record<string, unknown>)[
      "nuxt-robots"
    ] as { sitemap: string[] };
    robots.sitemap.push("/sitemap.xml");

    serveSitemapIndexAtSitemapXml(config);

    expect(robots.sitemap).toEqual(["/sitemap.xml"]);
  });

  it("fails the build when the module no longer registers the routes", () => {
    const config = moduleConfig();
    config.handlers = config.handlers!.filter(
      (handler) => handler?.route !== "/sitemap_index.xml",
    );

    expect(() => serveSitemapIndexAtSitemapXml(config)).toThrow(
      /sitemap_index\.xml/,
    );
  });
});
