import { expect, type Page, type TestInfo } from "@playwright/test";
import type { EntityPageFixture } from "./fixtures/entityGraph";
import { readyForFullPage } from "./fullPage";

/** A person's or a company's page drawn from a fixture, for
 * person-page.spec.ts and company-page.spec.ts.
 *
 * The page is the real one, its components and its own requests; what is
 * answered from ./fixtures is what the page asks about its subject - the node,
 * its local graph and its handovers. Everything else it asks - the notes, the
 * comments, the facts, the press, the reader's own votes and proposals - goes
 * to the emulator, which has none of them for a node it has never heard of,
 * so those parts draw the empty states they draw for most pages.
 *
 * A route handler only reaches what the browser fetches, and a page the
 * server renders fetches its data inside nitro. So the page has to be reached
 * by a client-side navigation: `logIn`'s redirect for a signed in reader, and
 * `openInApp` below for one who is not. */
export async function answerEntityPage(page: Page, fixture: EntityPageFixture) {
  const { id } = fixture;
  // By path rather than by glob: `**/api/nodes/<id>**` would also answer the
  // node's `/mentions` with the node.
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}`,
    (route) => route.fulfill({ json: { node: fixture.node } }),
  );
  // The history and the graph under it ask this route for different reaches;
  // the one layout answers both.
  await page.route(
    (url) => url.pathname === `/api/graph/local/${id}`,
    (route) => route.fulfill({ json: fixture.graph }),
  );
  await page.route(
    (url) =>
      url.pathname === "/api/edges/successions" &&
      (url.searchParams.get("companyId") === id ||
        url.searchParams.get("personId") === id),
    (route) => {
      // `authFetch` adds `latest=true` to whatever a signed in reader asks,
      // and the endpoint names drafts for nobody else.
      const latest = new URL(route.request().url()).searchParams.get("latest");
      return route.fulfill({
        json:
          latest === "true"
            ? fixture.successions.editor
            : fixture.successions.reader,
      });
    },
  );
}

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: {
        $router: { push: (to: string) => Promise<unknown> };
      };
    };
  };
};

/** Open `path` the way a link inside the site would, signed out: land on
 * /o-nas, then hand the path to the router - as pages.spec.ts and
 * person-teaser.spec.ts do, and for their reasons as well as the one above:
 * drawn in the browser, the page counts its dates from ./clock.ts. */
export async function openInApp(page: Page, path: string) {
  await page.goto("/o-nas");
  await page.waitForFunction(
    () =>
      !!(document.querySelector("#__nuxt") as MountPoint | null)?.__vue_app__,
  );
  await page.evaluate(async (to) => {
    const root = document.querySelector("#__nuxt") as MountPoint;
    await root.__vue_app__!.config.globalProperties.$router.push(to);
  }, path);
  await page.waitForURL(`**${path}`);
}

/** The graph at the end of the page, settled.
 *
 * A computer draws it in place, and the bar over it is the last thing on the
 * page to fill in: the canvas fetches its layout on its own, after the rest
 * has drawn. The edge legend is the part of the bar that only exists once the
 * layout has come - the node legend starts with three entries it always has.
 * A phone keeps the graph behind a button, so there is nothing to wait for but
 * the button. */
export async function graphSettled(page: Page, testInfo: TestInfo) {
  const section = page.getByTestId("entity-graph");
  if (testInfo.project.name === "visual-mobile") {
    await expect(
      section.getByRole("button", { name: "Pokaż graf powiązań" }),
    ).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(section.getByTestId("graph-edge-legend")).toContainText(
    "Zatrudnienie",
    { timeout: 30_000 },
  );
}

/** The whole page, as a reader scrolls it.
 *
 * Less the canvas inside the graph: a force-directed layout settles somewhere
 * slightly different every run, so it is hidden - the box keeps its height,
 * and the bar over it, its legends and the line under it stay in the shot.
 * graph-panel.spec.ts photographs the bar on its own. */
export async function shootWholePage(page: Page, name: string) {
  await page.addStyleTag({
    content: ".graph-panel__canvas { visibility: hidden !important; }",
  });
  // Off the page: logIn leaves the pointer where the form's button was, and a
  // row or a button under it would be photographed in its hover state.
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  await readyForFullPage(page);
  // A phone's page runs to several screens, and toHaveScreenshot takes it
  // until two captures in a row agree.
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    timeout: 20_000,
  });
}
