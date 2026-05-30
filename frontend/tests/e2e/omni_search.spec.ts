import { test, expect } from "@playwright/test";

test.describe("OmniSearch", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("allows searching for parties", async ({ page }) => {
    // Wait for the main page content to ensure app is hydrated
    await expect(page.locator(".v-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Fill the search input
    await page.locator("input#omni-search").click();
    await page.locator("input#omni-search").fill("PO");

    // We expect "PO" as a title and "Partia" as a subtitle.
    const poItem = page
      .locator(".v-list-item", { hasText: "PO" })
      .filter({ hasText: "Partia" })
      .first();
    await expect(poItem).toBeVisible();

    // Click the item
    await poItem.click();
    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*party=PO/);

    // Verify filter is set
    await expect(
      page
        .locator(".v-autocomplete", { hasText: "Partia" })
        .locator(".v-chip__content"),
    ).toHaveText("PO");
  });

  test("should dedup companies", async ({ page }) => {
    await expect(page.locator(".v-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.locator("input#omni-search").click();
    await page.locator("input#omni-search").fill("Orlen");

    // We expect "Orlen" to appear
    const orlenItem = page
      .locator(".v-list-item", { hasText: "Orlen" })
      .first();
    await expect(orlenItem).toBeVisible();

    await orlenItem.click();

    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*krs=.+/);
    await expect(
      page
        .locator(".v-autocomplete", { hasText: "Spółki" })
        .locator(".v-chip__content"),
    ).toContainText("ORLEN");
  });
});
