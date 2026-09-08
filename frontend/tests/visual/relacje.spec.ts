import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { missingReverseFixture } from "./fixtures/missingReverse";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/relacje, the queue of personal relations that name only one side.
 *
 * Kept out of pages.spec.ts because it is not just a url: it needs an admin,
 * and it needs rows the seed cannot supply - see
 * `tests/visual/fixtures/missingReverse.ts`.
 *
 * Unlike /eksploruj/szpitale this does not have to be reached by a client-side
 * navigation. The page fetches its queue from `onMounted` and `useScannedQueue`
 * returns early on the server, because the endpoint only answers a caller
 * carrying an admin token and the server render has none - so the request the
 * route handler answers is always the browser's, whichever way the page was
 * opened.
 *
 * Two shots. The row is a wide thing - two names, the word, a field and a
 * handful of chips - and the phone is where that has to give way rather than
 * scroll sideways, which is what `expectFitsThePhone` checks after the shot.
 */

/** Arrive at the queue as an admin, with the fixture answering for the API. */
async function openQueue(page: Page) {
  await page.route("**/api/edges/missingReverse**", (route) =>
    route.fulfill({ json: missingReverseFixture() }),
  );

  await logIn(page, USERS.admin, "/admin/relacje");

  const table = page.getByTestId("reverse-queue-table");
  await expect(table).toBeVisible({ timeout: 30_000 });
  // 1287 is the fixture's scan count and nothing else produces it, so reaching
  // this proves the rows on screen came from the fixture rather than from an
  // empty queue that would have banked a baseline of the "nothing to do" state.
  await expect(page.getByText(/Przejrzano 1287/).first()).toBeVisible({
    timeout: 30_000,
  });
  // Two of the five rows reverse into exactly one word, and the count is what
  // says the vocabulary ran at all.
  await expect(page.getByTestId("reverse-fill-obvious")).toContainText(
    "Wypełnij oczywiste (2)",
  );
}

/** Everything that has to have arrived before a shot is worth taking. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test("relacje-kolejka", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openQueue(page);
  await settled(page);

  await expect(page).toHaveScreenshot("relacje-kolejka.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});

test("relacje-kolejka-wypelniona", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openQueue(page);

  // What the reviewer's one click does: the unambiguous rows filled in, their
  // chips gone because the field now says what they offered, and the save
  // button counting them. The ambiguous rows are untouched, which is the whole
  // reason the button is called „oczywiste”.
  await page.getByTestId("reverse-fill-obvious").click();
  await expect(page.getByTestId("reverse-save")).toContainText(
    "Zapisz wypełnione (2)",
  );
  await settled(page);

  await expect(page).toHaveScreenshot("relacje-kolejka-wypelniona.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});
