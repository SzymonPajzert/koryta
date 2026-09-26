// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { pageTag, taggedPages } from "./visual/pageTags";

/** Every page a reader can land on has a picture in tests/visual.
 *
 * Nothing used to connect the two. The visual suite photographed the pages
 * somebody had thought to list, a new page had no test to fail, and a reviewer
 * looking for the new view in the diff found no image, because no baseline had
 * been taken of it. This runs with the unit tests, so it fails in quick-check
 * and in the Vitest job, well before anybody runs the visual suite.
 *
 * A test counts for a page when it carries the page's `@page:` tag (see
 * tests/visual/pageTags.ts) and its baseline is committed. */

const root = fileURLToPath(new URL("..", import.meta.url));

/** Pages that draw nothing of their own: each sends the reader on before it
 * renders, so its screenshot would be of wherever it sends them. */
const redirectOnly: Record<string, string> = {
  "entity/[destination]/[id]":
    "app/middleware/entity-slug.ts sends every node it can read on to its " +
    "readable url, and what it draws for one it cannot is the same detail " +
    "view [seoType]/[slug] is photographed with",
  "eksploruj/autograf/index":
    "replaces itself with /eksploruj/autograf/spolki-partie",
  "admin/rewizje/kolejka": "a route redirect to /admin/rewizje#kolejka",
  "admin/rewizje-krawedzi": "a route redirect to /admin/rewizje#powiazania",
};

/** Pages that should have a picture and have none yet: what was missing when
 * this check came in, with what a capture of each needs.
 *
 * DO NOT ADD TO THIS LIST. A new page gets its picture in the commit that
 * adds it. The list only gets shorter, and the check below insists on it: a
 * page photographed since has to come off. */
const notYetPhotographed: Record<string, string> = {
  "admin/index": "admin; client rendered, so /api/admin/summary can be stubbed",
  "admin/krawedzie": "admin; the seed has edges to list",
  "admin/notatki/index": "admin; the seed has notes on Jan Kowalski",
  "admin/notatki/kategoryzacja": "admin",
  aktywnosc:
    "signed in; the last 30 days against today's date, so it needs the " +
    "client-side navigation and a stubbed feed (szpitale.spec.ts)",
  "cli-login": "signed in, with a `callback` for the CLI",
  "edit/node/[[id]]": "signed in",
  "eksploruj/autograf/[type]": "charts; needs a check that they draw stably",
  "eksploruj/staz":
    "tenure is counted to today, so the figures move daily unless stubbed",
  "ekstrakcje/index": "signed in; the seed has extractions",
  "ekstrakcje/kategoryzacja": "signed in; the seed has extractions",
  graf: "a force-directed canvas that settles differently every run",
  leads: "signed in",
  profil: "signed in",
  rozszerzenie: "signed in",
  "temat/[slug]": "the seed has no topic",
  tematy: "the seed has no topic",
};

/** Every page under app/pages, as the path without the extension. */
const pages = readdirSync(`${root}app/pages`, {
  recursive: true,
  encoding: "utf8",
})
  .filter((file) => file.endsWith(".vue"))
  .map((file) => file.replace(/\.vue$/, ""))
  .sort();

type ListedTest = { file: string; title: string; tags: string[] };

/** The visual tests, as Playwright lists them. `--list` loads the specs and
 * starts no server, so this is about a second, not a build. */
function listVisualTests(): ListedTest[] {
  const report = JSON.parse(
    execFileSync(
      `${root}node_modules/.bin/playwright`,
      [
        "test",
        "--list",
        "--reporter=json",
        "--project=visual-desktop",
        "--project=visual-mobile",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  expect(report.errors, "playwright could not load the specs").toEqual([]);

  type Suite = { suites?: Suite[]; specs?: ListedTest[] };
  const flatten = (suite: Suite): ListedTest[] => [
    ...(suite.specs ?? []),
    ...(suite.suites ?? []).flatMap(flatten),
  ];
  return (report.suites as Suite[])
    .flatMap(flatten)
    .map(({ file, title, tags }) => ({ file, title, tags }));
}

/** Screenshots are named after their test - `test("opinie")` compares
 * `opinie.png` - and a test may run in one of the two viewports only. */
const hasBaseline = (title: string) =>
  ["visual-desktop", "visual-mobile"].some((project) =>
    existsSync(
      `${root}tests/visual/__screenshots__/linux/${project}/${title}.png`,
    ),
  );

describe("visual coverage", () => {
  let tests: ListedTest[] = [];
  let photographed = new Set<string>();

  beforeAll(() => {
    tests = listVisualTests();
    photographed = new Set(tests.flatMap((t) => taggedPages(t.tags)));
  });

  it("photographs every page, or says why it cannot", () => {
    const missing = pages.filter(
      (page) =>
        !photographed.has(page) &&
        !(page in redirectOnly) &&
        !(page in notYetPhotographed),
    );
    expect(
      missing.map((page) => `app/pages/${page}.vue`),
      "these pages have no visual test. Photograph each in tests/visual - " +
        "pages.spec.ts takes one line per page a signed out reader can open, " +
        "and a page behind a login gets a spec of its own, as " +
        "admin-opinie.spec.ts does - tag the test " +
        `${pageTag("<page>")}, and commit the baseline ` +
        "`npm run test:visual:update` writes. A page that only redirects goes " +
        "in `redirectOnly` in tests/visualCoverage.test.ts instead, with where " +
        "it sends the reader",
    ).toEqual([]);
  });

  it("names only pages that exist", () => {
    const named = [
      ...photographed,
      ...Object.keys(redirectOnly),
      ...Object.keys(notYetPhotographed),
    ];
    expect(
      named.filter((page) => !pages.includes(page)),
      "no such file under app/pages - renamed or removed?",
    ).toEqual([]);
  });

  it("takes a page off the lists once it is photographed", () => {
    expect(
      [...Object.keys(redirectOnly), ...Object.keys(notYetPhotographed)].filter(
        (page) => photographed.has(page),
      ),
      "these have a visual test now - take them off the list in " +
        "tests/visualCoverage.test.ts",
    ).toEqual([]);
  });

  it("has a committed baseline for every tagged test", () => {
    // Listed once per viewport, so a test running in both comes up twice.
    const unshot = tests
      .filter((t) => taggedPages(t.tags).length > 0 && !hasBaseline(t.title))
      .map((t) => `${t.file} › ${t.title}`);
    expect(
      [...new Set(unshot)],
      "no __screenshots__/linux/*/<title>.png for these. Run " +
        "`npm run test:visual:update` and commit what it writes - and name " +
        "each screenshot after its test, which is how this finds it",
    ).toEqual([]);
  });
});
