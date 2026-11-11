import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { logIn, USERS } from "../e2e/helpers/auth";
import { expectFitsThePhone } from "./phoneWidth";
import { founderGraph, foundationGraph } from "./fixtures/founders";

/** A public founder on both ends: the foundation's „Właściciele” and the
 * founder's „Spółki zależne”.
 *
 * A foundation holds no shares, so the body that set it up is who stands
 * behind it - an `owns` edge marked `founder`, which the page lists among the
 * owners and labels on a line of its own. Szymon's picks of 2026-11-11 (board
 * rounds public-founders-label-r1 and r2): the label as a second line, the
 * founded bodies among the subsidiaries, and no row icons on a phone, where
 * they took a sixth of the width from the name.
 *
 * WHY THE GRAPH AND THE NODE ARE INTERCEPTED: see ./fixtures/founders.ts. The
 * node of the foundation is given `legalForm: FUNDACJA`, which is what makes its
 * page call the founder „Fundator” rather than „Założyciel”.
 *
 * Signed in, for the reason company-wikipedia.spec.ts gives: `logIn`'s redirect
 * is a client-side navigation, so the graph and the node are fetched in the
 * browser, where the handlers can answer them.
 */

const FOUNDATION_ID = "sukspolka";
const FOUNDATION_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";
const FOUNDER_ID = "2";
const FOUNDER_URL = "/instytucja/orlen-2";

/** The list under the heading `title`, as `CardConnectionList` draws it. */
function list(page: Page, title: string) {
  return page
    .locator("div.mb-4")
    .filter({ has: page.locator("h3", { hasText: new RegExp(`^${title}$`) }) })
    .first();
}

async function shoot(page: Page, card: ReturnType<typeof list>, name: string) {
  // Off the card: the mouse is left where the login button was.
  await page.mouse.move(0, 0);
  // On a phone a tall card is shot by scrolling, and the fixed app bar and the
  // feedback launcher land across it. Hidden, as in komisja-rewizyjna.spec.ts.
  await page.addStyleTag({
    content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(card).toHaveScreenshot(name);
}

test.describe("Fundator", { tag: pageTag("[seoType]/[slug]") }, () => {
  test("instytucja-fundator", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.route(
      (url) => url.pathname === `/api/graph/local/${FOUNDATION_ID}`,
      (route) => route.fulfill({ json: foundationGraph(FOUNDATION_ID) }),
    );
    // By path: a glob would also catch the node's `/revisions`.
    await page.route(
      (url) => url.pathname === `/api/nodes/${FOUNDATION_ID}`,
      async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.node.legalForm = "FUNDACJA";
        await route.fulfill({ response, json: body });
      },
    );

    await logIn(page, USERS.normal, FOUNDATION_URL);

    const owners = list(page, "Właściciele");
    await expect(owners).toBeVisible({ timeout: 30_000 });
    // Only the fixture draws this founder, so a run on the seeded graph fails
    // here rather than banking a list with no label in it.
    const label = owners.getByTestId("founder-label");
    await expect(label).toHaveText("Fundator", { timeout: 30_000 });
    await expect(owners.getByText("Miasto Warszawa")).toBeVisible();

    await shoot(page, owners, "instytucja-fundator.png");
    await expectFitsThePhone(page, testInfo);
  });

  test("instytucja-zalozona", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.route(
      (url) => url.pathname === `/api/graph/local/${FOUNDER_ID}`,
      (route) => route.fulfill({ json: founderGraph(FOUNDER_ID) }),
    );

    await logIn(page, USERS.normal, FOUNDER_URL);

    const subsidiaries = list(page, "Spółki zależne");
    await expect(subsidiaries).toBeVisible({ timeout: 30_000 });
    const labels = subsidiaries.getByTestId("founder-label");
    // A foundation is „założona”, a sports association „założone”, and the
    // company it merely owns says nothing.
    await expect(labels).toHaveText(["założona", "założone"], {
      timeout: 30_000,
    });

    await shoot(page, subsidiaries, "instytucja-zalozona.png");
    await expectFitsThePhone(page, testInfo);
  });
});
