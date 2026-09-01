import { test, expect, type Page } from "@playwright/test";
import { hospitalStatsFixture } from "./fixtures/hospitalStats";
import { expectFitsThePhone } from "./phoneWidth";

/** /eksploruj/szpitale, with hospitals in it.
 *
 * Kept out of pages.spec.ts because it is not just a url: the seed carries no
 * hospital, so a plain `goto` draws the page's empty state and photographs the
 * copy around a chart that is not there. `tests/visual/fixtures/hospitalStats`
 * says why that is not worth fixing in the seed.
 *
 * WHY IT NAVIGATES FROM THE HOME PAGE. A route handler installed here can only
 * answer requests the browser makes, and this page is server rendered - a
 * direct `goto` fetches inside nitro, where the fixture cannot reach. Arriving
 * through a client-side navigation puts the fetch in the browser instead. The
 * wait afterwards is on a number only the fixture produces, so a run where the
 * click fell through to a full page load fails here rather than quietly banking
 * an empty baseline.
 *
 * Two shots, because the phone width is fought over in two different places.
 * The party split is what a reader lands on and the only one with no backlog to
 * draw; the hospital split has the long names, the grey tails and, above `sm`,
 * the queue button - all of which the narrow layout drops or shrinks.
 */

/** Arrive at the page client-side, with the fixture answering for the API. */
async function openWithFixture(page: Page) {
  await page.route("**/api/stats/hospitals**", (route) =>
    route.fulfill({ json: hospitalStatsFixture() }),
  );

  await page.goto("/");
  // The footer is the only link to this page at both widths - the app bar
  // drops its navigation below 960px.
  const link = page.getByRole("link", { name: "Rady szpitali" });
  await link.scrollIntoViewIfNeeded();
  // Retried as a whole: until the home page has hydrated, the click is an
  // ordinary anchor and takes the server-rendered route instead.
  await expect(async () => {
    await link.click();
    await expect(page).toHaveURL(/\/eksploruj\/szpitale$/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // 591 is the fixture's published seat count and nothing else produces it, so
  // reaching this proves the chart is drawn from the fixture.
  await expect(page.getByText(/591/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Podziel według")).toBeVisible();
}

/** Lazy images below the fold keep growing the page mid-capture otherwise. */
async function settled(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);
}

test("szpitale", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openWithFixture(page);
  await settled(page);
  await expect(page).toHaveScreenshot("szpitale.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});

test("szpitale-podzial-na-szpitale", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openWithFixture(page);
  await page.getByRole("button", { name: "Szpitala" }).click();
  // The longest label in the app, and the row it names is the one the narrow
  // layout has to fit.
  await expect(
    page.getByText("WIELOSPECJALISTYCZNY SZPITAL WOJEWÓDZKI W GORZOWIE WLKP."),
  ).toBeVisible({ timeout: 15_000 });
  await settled(page);
  await expect(page).toHaveScreenshot("szpitale-podzial-na-szpitale.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});
