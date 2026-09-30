// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** No colour is written down outside the modules that exist to hold them.
 *
 * The site used to paint its hero band, its footer and its legal pages'
 * links with a `#a8c79f` typed into each component, and the theme's own
 * primary into nuxt.config.ts beside a second copy in shared/colors.ts - so
 * trying a different palette meant finding every copy first, and a copy that
 * was missed stayed the old colour. Components now ask for a token, and this
 * fails on a hex or an rgb() anywhere else, naming the file and the line.
 *
 * Translucent black and white - `rgba(0, 0, 0, 0.12)` for a hairline or a
 * shadow - are not colours in this sense: they darken or lighten whatever is
 * under them, and no palette repaints them. */

const root = fileURLToPath(new URL("../..", import.meta.url));

/** The modules whose job is to hold colours. */
const palettes = new Set([
  // The site: brand, roles, ink and surface ramps, and what Vuetify is given.
  "shared/colors.ts",
  // Data: chart series, the map, the older party charts' greys.
  "app/utils/chartTheme.ts",
  // Party colours.
  "shared/misc.ts",
  // The relation graph's nodes, edges and inks.
  "shared/graph/nodes.ts",
  "shared/graph/edges.ts",
]);

/** A hex colour, but not the anchor in a url (`/pomoc#add`) or an id. */
const HEX = /(?<![\w/&#-])#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![\w-])/gi;
/** An rgb()/rgba() with literal channels, black and white excepted. */
const RGB = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;

/** Comments are where a colour is explained, so they may quote one. */
function stripComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, before: string) =>
      before.concat(blank(match.slice(before.length))),
    );
}

function sources(dir: string): string[] {
  return readdirSync(join(root, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.(vue|ts)$/.test(entry.name))
    .filter((entry) => !/\.(spec|test)\.ts$|\.d\.ts$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

function literalsIn(file: string): string[] {
  const lines = stripComments(readFileSync(join(root, file), "utf8")).split(
    "\n",
  );
  return lines.flatMap((line, index) => {
    const found = [
      ...[...line.matchAll(HEX)].map((match) => match[0]),
      ...[...line.matchAll(RGB)]
        .filter((match) => {
          const channels = match.slice(1, 4).join(",");
          return channels !== "0,0,0" && channels !== "255,255,255";
        })
        .map((match) => `${match[0]})`),
    ];
    return found.map((literal) => `${file}:${index + 1} ${literal}`);
  });
}

describe("colour literals", () => {
  const files = [
    ...sources("app"),
    ...sources("shared"),
    ...sources("server"),
    "nuxt.config.ts",
  ];

  it("finds the files it is meant to look at", () => {
    // A glob that silently matched nothing would pass everything below.
    expect(files).toContain("app/components/card/CallToAction.vue");
    expect(files).toContain("nuxt.config.ts");
    expect(files.length).toBeGreaterThan(300);
  });

  it("finds none outside the palette modules", () => {
    const stray = files
      .filter((file) => !palettes.has(file))
      .flatMap(literalsIn);
    expect(stray).toEqual([]);
  });

  it("would catch one", () => {
    // Guards the patterns themselves: each of these is a colour a component
    // could have written, and each has to be seen.
    const probe = [
      `:style="{ background: '#a8c79f' }"`,
      "color: #fff;",
      'color="#E64164"',
      "background: rgba(4, 22, 52, 0.42);",
    ].join("\n");
    const found = probe.split("\n").filter((line) => {
      HEX.lastIndex = 0;
      RGB.lastIndex = 0;
      return HEX.test(line) || RGB.test(line);
    });
    expect(found).toHaveLength(4);
  });

  it("does not mistake an anchor or a comment for a colour", () => {
    expect(
      stripComments(
        [
          '<NuxtLink to="/pomoc#add">',
          "// the band was #a8c79f",
          "/* #fad3d0 */",
          '<a href="https://koryta.pl/admin/zadania#t-abc">',
        ].join("\n"),
      ).match(HEX),
    ).toBeNull();
  });
});
