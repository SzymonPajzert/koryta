import { test, expect } from "@playwright/test";

/** That the two legal pages are still two pages once the reader is inside the
 * app.
 *
 * Loading either url directly always worked; what did not was clicking from one
 * to the other in the footer. Every /plik/* route shared a single async-data
 * entry, and under Suspense the outgoing page is still mounted while the
 * incoming one runs setup - so the entry was already there marked "success",
 * the handler never ran, and the url changed under text that did not. A reader
 * asking for the privacy policy got the terms of service.
 *
 * Needs no login and no seed data: the documents are markdown in
 * frontend/content, so this is one of the cheapest specs in the suite.
 */
const PAGES = [
  {
    from: "/plik/regulamin",
    to: "/plik/polityka_prywatnosci",
    heading: /Polityka prywatności/i,
  },
  {
    from: "/plik/polityka_prywatnosci",
    to: "/plik/regulamin",
    heading: /Regulamin Serwisu/i,
  },
];

for (const { from, to, heading } of PAGES) {
  test(`navigating from ${from} to ${to} swaps the document`, async ({
    page,
  }) => {
    await page.goto(from);
    await page.locator("h1").waitFor();

    // The footer link, which is how a reader gets between the two, and the
    // path that was broken - a fresh `goto` would pass either way.
    await page.locator(`footer a[href="${to}"]`).first().click();

    await expect(page).toHaveURL(new RegExp(`${to}$`));
    await expect(page.locator("h1")).toHaveText(heading);
    // The tab title was captured by value and went stale with the body.
    await expect(page).toHaveTitle(heading);
  });
}
