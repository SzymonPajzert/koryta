import { test, expect } from "@playwright/test";

/** The pages a visitor lands on, served by the deployment under test.
 *
 * The assertions stay structural on purpose - a smoke run must not go red
 * because an editor changed a heading, only because the page stopped working.
 */
test.describe("pages", () => {
  test("home renders", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(response?.status()).toBe(200);
    await expect(page.locator(".v-main")).toBeVisible();
    await expect(page.getByAltText("Koryta.pl logo")).toBeVisible();
  });

  test("home is server-rendered", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Nitro falling back to shipping an empty shell looks fine in a browser,
    // which then fills it in - and looks like an empty site to a crawler. The
    // heading is rendered by the page component, so it only reaches the wire
    // when SSR actually ran.
    expect(html).toContain("Koryta.pl logo");
    expect(html.length).toBeGreaterThan(5_000);
  });

  test("the table lists rows from the real database", async ({ page }) => {
    const response = await page.goto("/eksploruj/tabela", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    await expect(page.locator(".v-main")).toBeVisible();
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 45_000,
    });

    // The query behind this table is compound and index-backed. A missing
    // composite index fails here and nowhere in the emulator suites, because
    // the emulator answers queries the real Firestore refuses.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
  });

  test("a row opens its entity panel", async ({ page }) => {
    await page.goto("/eksploruj/tabela", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 45_000,
    });

    const firstRowName = page
      .locator("tbody tr:first-child .text-primary.cursor-pointer")
      .first();
    await expect(firstRowName).toBeVisible();
    await firstRowName.click();

    await expect(page.locator(".v-navigation-drawer--active")).toBeVisible();
  });
});
