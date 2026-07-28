import { test, expect } from "@playwright/test";
import { openOmniSearch } from "./helpers/omniSearch";

test("check highlighted items", async ({ page }) => {
  // The dev server keeps live listeners open, so "load" never settles here
  await page.goto("/eksploruj/tabela?krs=0000357114&page=1&itemsPerPage=10", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.locator(".v-main")).toBeVisible();

  await openOmniSearch(page, page.locator(".v-list"));

  // wait a bit for reactivity
  await page.waitForTimeout(1000);

  // find all active list items
  const activeItems = page.locator(".v-list-item--active");
  const count = await activeItems.count();
  console.log("Active items count:", count);

  for (let i = 0; i < count; i++) {
    const text = await activeItems.nth(i).textContent();
    console.log("Active item:", text?.trim());
  }
});
