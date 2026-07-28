import { test, expect } from "@playwright/test";

/** Seeded region, so this runs on the emulator's own data. */
const TERYT = "22";
const FILTERED = `/eksploruj/tabela?teryt=${TERYT}`;

test.describe("Explore query parameters", () => {
  test("leaves a clean url alone", async ({ page }) => {
    await page.goto("/eksploruj/tabela", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    // Defaults belong in the code, not in the url - writing them back used to
    // add a history entry that the back button had to walk through first.
    expect(new URL(page.url()).search).toBe("");

    await page.goBack();
    await expect(page).not.toHaveURL(/\/eksploruj\/tabela/, { timeout: 15000 });
  });

  test("does not carry filters onto the next page", async ({ page }) => {
    await page.goto(FILTERED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });

    await page.locator("header").getByText("koryta.pl").click();
    await page.waitForTimeout(3000);

    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("");
  });

  test("keeps the filter in the url and drops it when cleared", async ({
    page,
  }) => {
    await page.goto(FILTERED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    expect(new URL(page.url()).searchParams.get("teryt")).toBe(TERYT);

    await page
      .getByRole("button", { name: "Clear Region osoby" })
      .click({ timeout: 15000 });

    await expect
      .poll(() => new URL(page.url()).searchParams.get("teryt"), {
        timeout: 15000,
      })
      .toBeNull();
  });
});
