import { test, expect } from "./test";
import { searchLineHits } from "./fixtures/searchLine";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";

/** The search box's menu with the line under each person
 * (shared/searchLine.ts): the town, the party of a published person, then
 * the office or the company - one line, cut at its end. Picked on board
 * rounds search-same-name-r1 and -r2.
 *
 * Answered by the route handler with what /api/search sends once the lines
 * are stored (./fixtures/searchLine.ts). The box sits in the app bar, which
 * every visual test hides, so the shot is of the menu alone; it opens from
 * the hidden field all the same. */

test(
  "wyszukiwarka-linia-pod-osoba",
  { tag: pageTag("o-nas") },
  async ({ page }) => {
    await page.route("**/api/search/log", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );
    await page.route("**/api/search?**", (route) =>
      route.fulfill({ json: searchLineHits }),
    );
    await page.goto("/o-nas", { waitUntil: "networkidle" });

    const field = page.locator("input#omni-search");
    await field.click();
    await field.fill("jan kow");

    const menu = page.locator(".v-overlay--active .v-overlay__content");
    // The add rows come once the answer is in and the box is idle, so the
    // menu is whole by then.
    await expect(
      menu.locator('[data-testid="omni-search-add-person"]'),
    ).toBeVisible({ timeout: 30_000 });
    const lines = menu.locator('[data-testid="omni-search-person-line"]');
    await expect(lines.first()).toHaveText("Mielec · PiS · Rada miasta 2024");
    // One line each, however long: never a second row of text.
    for (const line of await lines.all()) {
      const box = await line.boundingBox();
      if (box) expect(box.height).toBeLessThanOrEqual(21);
    }

    await readyForElementShot(page);
    // Vuetify fades the menu in by an inline transition the class check in
    // `readyForElementShot` does not see.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    await expect(menu).toHaveScreenshot("wyszukiwarka-linia-pod-osoba.png");
  },
);
