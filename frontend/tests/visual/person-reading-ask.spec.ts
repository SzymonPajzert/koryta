import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import type { NodeMentions } from "../../server/api/nodes/[id]/mentions.get";
import type { PersonDeclarations } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  PLAIN_FAVICON,
  declarationPerson,
  personDeclarations,
  personMentions,
} from "./fixtures/declarationsAdmin";
import { logIn, USERS } from "../e2e/helpers/auth";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** The ask under a person's history to read a few declaration scans, as a
 * reader who is not signed in finds it: led by the people the readers'
 * readings published in 30 days, and on a page they published, saying so.
 * Look c of board round osoba-skany-r1, picked by Szymon on 2026-11-14.
 *
 * The seeded Jan Kowalski, with the declarations of
 * person-declarations.spec.ts; the figure is production's of 2026-11-14,
 * answered by a route handler. The page is reached by a client-side
 * navigation, so its fetches are the browser's own and the handlers answer
 * them. One element a test: the page ends in a graph that settles differently
 * every run. */

const SLUG = { tag: pageTag("[seoType]/[slug]") };

/** /api/stats/activity's `automatic` on 2026-11-14. */
const READERS_PUBLISHED = 741;

/** No declarations: a page the readings did not publish. */
const NONE: PersonDeclarations = { autoPublished: null, declarations: [] };

/** Jan Kowalski's page with these declarations and articles. */
async function openPerson(
  page: Page,
  declarations: PersonDeclarations,
  mentions: NodeMentions,
) {
  const { id, path } = declarationPerson;
  await freezeClock(page);
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/declarations`,
    (route) => route.fulfill({ json: declarations }),
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/mentions`,
    (route) => route.fulfill({ json: mentions }),
  );
  await page.route(
    (url) => url.pathname === "/api/stats/activity",
    (route) => route.fulfill({ json: { automatic: READERS_PUBLISHED } }),
  );
  await page.route("**/s2/favicons**", (route) =>
    route.fulfill({ contentType: "image/png", body: PLAIN_FAVICON }),
  );
  await openInApp(page, path);
}

test("osoba-prosba-o-skany", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, NONE, personMentions);

  const ask = page.getByTestId("person-reading-ask");
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByTestId("person-reading-ask-figure")).toContainText(
    "741",
  );
  await expect(ask.locator("h3")).toHaveText("Masz minutę?");

  await readyForElementShot(page);
  await expect(ask).toHaveScreenshot("osoba-prosba-o-skany.png");

  await expectFitsThePhone(page, testInfo);
});

test("osoba-prosba-o-skany-po-odczytach", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, personMentions);

  // The title waits on the declarations, which the browser asks for after
  // the page is up.
  const ask = page.getByTestId("person-reading-ask");
  await expect(ask.locator("h3")).toHaveText(
    "Strony jak ta powstały dzięki czytelnikom",
    { timeout: 30_000 },
  );

  await readyForElementShot(page);
  await expect(ask).toHaveScreenshot("osoba-prosba-o-skany-po-odczytach.png");

  await expectFitsThePhone(page, testInfo);
});

/** A signed-in contributor knows the way to /oswiadczenia, and has the app
 * bar's „Działaj z nami”: the ask is for readers who are not signed in. No
 * picture, so no `@page:` tag - the coverage check wants a baseline for every
 * tagged test, and there is nothing here to photograph. */
test("osoba-prosba-o-skany-zalogowany", async ({ page }) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, declarationPerson.path);

  await expect(
    page.locator("h3", { hasText: "Historia powiązań" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("person-reading-ask")).toHaveCount(0);
});
