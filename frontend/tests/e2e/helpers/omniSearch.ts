import { expect, type Locator, type Page } from "@playwright/test";

/** Type `query` into the header search and wait for `expected` to show up.
 *
 * The suite runs against the dev server, where hydration takes a few seconds.
 * Until it finishes the input is in the markup but carries no listeners, so a
 * `fill()` writes the DOM value without it ever reaching the component - Vue
 * then wipes the value on hydration and no search is ever issued. Retrying the
 * whole interaction rides that out: once the field is live the first keystroke
 * triggers the request and the result appears. */
export async function omniSearchFor(
  page: Page,
  query: string,
  expected: Locator,
) {
  const input = page.locator("input#omni-search");

  await expect(async () => {
    // Clear first - re-filling the value the DOM already holds emits no input
    // event, so a lost pre-hydration fill would never be retried.
    await input.click();
    await input.fill("");
    await input.fill(query);
    await expect(expected).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/** Open the header search with no query and wait for its menu to appear.
 *
 * Same hydration race as `omniSearchFor`: before Vue takes over, the click
 * lands on an inert input and opens nothing, so the click is what has to be
 * retried. Waiting for `networkidle` instead does not work - the page keeps
 * Firestore listeners open for as long as it is on screen, so the network
 * never goes quiet. Clicking a live autocomplete toggles its menu, so a retry
 * only clicks again while the menu is still shut. */
export async function openOmniSearch(page: Page, menu: Locator) {
  const input = page.locator("input#omni-search");

  await expect(async () => {
    if (!(await menu.isVisible())) await input.click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}
