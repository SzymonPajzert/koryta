import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  STATEMENTS_PERSON,
  statementsGraph,
  statementsNode,
} from "./fixtures/pkwStatements";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** What PKW says of a candidacy beyond its list, on a person's page: the
 * party that backed a run as the backing chip before the committee's name, an
 * association that backed one by its name, a party declared beside another
 * party's list, and the header's chip for a party only a backing names
 * (board rounds popierana-r1..r3, approved 2026-11-17).
 *
 * The seed has no candidacy carrying any of it, so the page is answered by
 * route handlers from ./fixtures/pkwStatements.ts, reached by the client-side
 * navigation `logIn` ends in. */

const PERSON = { tag: pageTag("[seoType]/[slug]") };

async function openPage(page: Page) {
  // The rows' bars are scaled to today: frozen, so the shot is the same
  // tomorrow.
  await freezeClock(page);
  // By path: the page asks with a query string.
  await page.route(
    (url) => url.pathname === `/api/nodes/${STATEMENTS_PERSON}`,
    (route) => route.fulfill({ json: statementsNode }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/graph/local/"),
    (route) => route.fulfill({ json: statementsGraph() }),
  );
  await logIn(page, USERS.normal, `/entity/person/${STATEMENTS_PERSON}`);
  await expect(page.getByTestId("edge-statements-visrunopole2018")).toBeVisible(
    { timeout: 30_000 },
  );
  // The pointer is left where the login form's button was, over a row.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
}

test("poparcie-pkw-powiazania", PERSON, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPage(page);

  const relations = page.getByTestId("relations-history");
  await expect(
    relations.getByTestId("edge-statements-visrunmarki2024"),
  ).toContainText("poparcie Mareckie Stowarzyszenie Gospodarcze");
  await expect(
    relations.getByTestId("edge-statements-visrunsejm2019"),
  ).toContainText("członek");
  await expect(relations).toHaveScreenshot("poparcie-pkw-powiazania.png");

  await expectFitsThePhone(page, testInfo);
});

test("poparcie-pkw-naglowek", PERSON, async ({ page }) => {
  test.setTimeout(120_000);
  await openPage(page);

  const head = page.locator(".v-card-title", { has: page.locator("h1") });
  await expect(head.locator(".chip--backing")).toHaveText("PSL");
  await expect(head).toHaveScreenshot("poparcie-pkw-naglowek.png");
});
