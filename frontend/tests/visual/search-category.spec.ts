import { test, expect } from "./test";
import { readyForElementShot } from "./elementShot";
import { pageTag } from "./pageTags";

/** The search box's menu with a category typed the way Polish says it:
 * „skarbu państwa” finds „Skarb Państwa”, under it „Kategoria” (decision on
 * 2026-11-28). The server finds nothing for it, as on production, so the
 * add rows follow. The box sits in the app bar, which every visual test hides,
 * so the shot is of the menu alone. */

test("wyszukiwarka-kategoria", { tag: pageTag("o-nas") }, async ({ page }) => {
  await page.route("**/api/search/log", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/search?**", (route) => route.fulfill({ json: [] }));
  await page.goto("/o-nas", { waitUntil: "networkidle" });

  const field = page.locator("input#omni-search");
  await field.click();
  await field.fill("skarbu państwa");

  const menu = page.locator(".v-overlay--active .v-overlay__content");
  // The add rows come once the answer is in and the box is idle, so the
  // menu is whole by then.
  await expect(
    menu.locator('[data-testid="omni-search-add-person"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(menu.locator(".v-list-item-title").first()).toHaveText(
    "Skarb Państwa",
  );

  await readyForElementShot(page);
  // Vuetify fades the menu in by an inline transition the class check in
  // `readyForElementShot` does not see.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  await expect(menu).toHaveScreenshot("wyszukiwarka-kategoria.png");
});
