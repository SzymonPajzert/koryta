import { test, expect } from "@playwright/test";

test("check highlighted items", async ({ page }) => {
  await page.goto("/eksploruj/tabela?krs=0000357114&page=1&itemsPerPage=10");

  await page.locator("input#omni-search").click();

  // wait for the list to appear
  await expect(page.locator(".v-list")).toBeVisible();

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
