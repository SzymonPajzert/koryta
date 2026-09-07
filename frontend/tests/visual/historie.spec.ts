import { test, expect } from "@playwright/test";
import { storyClustersFixture } from "./fixtures/storyClusters";
import { expectFitsThePhone } from "./phoneWidth";

/** /eksploruj/historie, with stories in it.
 *
 * Kept out of pages.spec.ts for the reason /eksploruj/szpitale is: the seed
 * cannot produce a cluster - a cluster is a claim about how a group differs
 * from the rest of the country, and the seeded world is four dozen nodes - so a
 * plain `goto` photographs the empty alert and guards the copy around a list
 * that is not there. `tests/visual/fixtures/storyClusters` says what the
 * fixture is shaped for.
 *
 * WHY IT NAVIGATES FROM THE HOME PAGE. A route handler installed here can only
 * answer requests the browser makes, and this page is server rendered - a
 * direct `goto` fetches inside nitro, where the fixture cannot reach. Arriving
 * through a client-side navigation puts the fetch in the browser instead. The
 * wait afterwards is on a phrase only the fixture produces, so a run where the
 * click fell through to a full page load fails here rather than quietly banking
 * an empty baseline.
 */
test("historie", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await page.route("**/api/stats/clusters**", (route) =>
    route.fulfill({ json: storyClustersFixture() }),
  );

  await page.goto("/");
  // The footer is the only link to this page at both widths - the app bar drops
  // its navigation below 960px.
  const link = page.getByRole("link", { name: "Historie w spółkach" }).first();
  await link.scrollIntoViewIfNeeded();
  // Retried as a whole: until the home page has hydrated, the click is an
  // ordinary anchor and takes the server-rendered route instead.
  await expect(async () => {
    await link.click();
    await expect(page).toHaveURL(/\/eksploruj\/historie$/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // Nothing but the fixture produces this line, so reaching it proves the list
  // is drawn from the fixture rather than from the seed's empty state. Matched
  // on the owner rather than on the title: „POLSKIE RADIO” is also the head of
  // three of the fixture's company names, and a bare text match is ambiguous.
  await expect(page.getByText("właściciel: Skarb Państwa")).toBeVisible({
    timeout: 30_000,
  });

  // Lazy images below the fold keep growing the page mid-capture otherwise.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);

  await expect(page).toHaveScreenshot("historie.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});
