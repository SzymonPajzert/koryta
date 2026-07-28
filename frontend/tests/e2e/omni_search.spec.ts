import { test, expect } from "@playwright/test";
import { omniSearchFor } from "./helpers/omniSearch";

test.describe("OmniSearch", () => {
  test.beforeEach(async ({ page }) => {
    // The dev server keeps live listeners open, so "load" never settles here
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();
  });

  test("allows searching for parties", async ({ page }) => {
    // We expect "PO" as a title and "Partia" as a subtitle.
    const poItem = page
      .locator(".v-list-item", { hasText: "PO" })
      .filter({ hasText: "Partia" })
      .first();
    await omniSearchFor(page, "PO", poItem);

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

  test("allows searching for regions", async ({ page }) => {
    // Click Opole entry
    const opoleItem = page
      .locator(".v-list-item", { hasText: "Opole" })
      .first();
    await omniSearchFor(page, "Opole", opoleItem);

    // Click the item
    await opoleItem.click();
    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*teryt=1661/);

    await expect(
      page.locator(".v-input", { hasText: "Region osoby" }),
    ).toContainText("Opole");
  });

  test("should dedup companies", async ({ page }) => {
    // We expect "Orlen" to appear
    const orlenItem = page
      .locator(".v-list-item", { hasText: "Orlen" })
      .first();
    await omniSearchFor(page, "Orlen", orlenItem);

    await orlenItem.click();

    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*krs=.+/);
    // Prod data carries the uppercase KRS registry name ("ORLEN"), the local
    // seed uses "Orlen" - accept both.
    await expect(
      page
        .locator(".v-autocomplete", { hasText: "Spółki" })
        .locator(".v-chip__content"),
    ).toContainText("ORLEN", { ignoreCase: true });
  });
});
