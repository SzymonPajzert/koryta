import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  extractionArticles,
  extractionTotal,
  unreviewedFacts,
  unreviewedTotal,
} from "./fixtures/extractions";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /ekstrakcje, the facts the pipeline pulled out of articles, one line per
 * article; and /ekstrakcje/kategoryzacja, where they are judged one card at a
 * time.
 *
 * Both fetch the facts in the browser only (`server: false`: the server render
 * has no token), which is what lets a route handler answer them, and they are
 * reached by the client-side navigation `logIn` ends in. The facts come from
 * ./fixtures/extractions.ts; the queue still reads the reader's own votes
 * from Firestore, where none is on a fixture's id. The rows on /ekstrakcje
 * stay closed: an open one mounts a vote listener per fact. */

const EKSTRAKCJE = { tag: pageTag("ekstrakcje/index") };
const KATEGORYZACJA = { tag: pageTag("ekstrakcje/kategoryzacja") };

/** The list asks for the facts grouped by article, the queue for the
 * unreviewed ones; only a GET is answered, as by the real route. */
async function answerExtractions(page: Page) {
  await freezeClock(page);
  await page.route("**/api/extractions**", (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({
        status: 404,
        json: { message: "Page not found" },
      });
    }
    const grouped =
      new URL(route.request().url()).searchParams.get("groupBy") === "article";
    return route.fulfill({
      json: grouped
        ? { articles: extractionArticles, total: extractionTotal }
        : { facts: unreviewedFacts, total: unreviewedTotal },
    });
  });
}

test("ekstrakcje", EKSTRAKCJE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerExtractions(page);
  await logIn(page, USERS.admin, "/ekstrakcje");

  // The lead counts what only the fixture has, so a run that drew the seed
  // fails here.
  await expect(page.getByText(/4\s?812 faktów wyciągniętych/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-row-toggle]")).toHaveCount(
    Object.keys(extractionArticles).length,
  );
  await expect(page.getByText("tygodnik.example.pl")).toBeVisible();

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("ekstrakcje.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("ekstrakcje-kategoryzacja", KATEGORYZACJA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerExtractions(page);
  await logIn(page, USERS.admin, "/ekstrakcje/kategoryzacja");

  // Drawn once the reader's own votes are in as well as the facts.
  await expect(page.getByText(/Pozostało do oceny: 3\s?127/)).toBeVisible({
    timeout: 30_000,
  });
  // The newest fact on the card - the url follows it - and the two others
  // from its article listed under it.
  await expect(page).toHaveURL(/fact=wizexk1/);
  await expect(page.locator(".related-facts .extraction-card")).toHaveCount(2);

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("ekstrakcje-kategoryzacja.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
