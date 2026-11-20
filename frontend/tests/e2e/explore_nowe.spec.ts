import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

test.describe("Eksploruj Nowe", () => {
  test("displays data when logged in as admin on dev:prod-data", async ({
    page,
  }) => {
    // 1. Go to login page with redirect to target page
    await page.goto("/login?redirect=/eksploruj/nowe");

    // Wait for Vue hydration to complete before filling inputs
    await waitForLoginFormHydrated(page);

    // 2. Fill credentials for seeded admin
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");

    // 3. Submit login
    await page.locator('button[type="submit"]').click({ force: true });

    // Wait for the client-side redirect to /eksploruj/nowe. Not the whole
    // url: once the queue answers, it names the person on screen.
    await page.waitForURL(/\/eksploruj\/nowe(\?|$)/, { timeout: 15000 });

    // Wait for hydration
    await expect(page.locator(".v-main")).toBeVisible();

    // The table shows a progress bar while loading
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 15000,
    });

    // Wait for table body rows to appear
    const firstRowName = page
      .locator(".table-card tbody tr:first-child .text-primary")
      .first();

    // Assert that we see at least one person in the list
    await expect(firstRowName).toBeVisible({ timeout: 15000 });

    // Assert that it actually contains text
    const nameText = await firstRowName.innerText();
    expect(nameText.length).toBeGreaterThan(0);

    // The queue opens on the most recent hires above the default threshold,
    // which is the state no filter writes into the url. What the url holds is
    // the person on screen.
    await expect(page.getByLabel("Min. suma głosów")).toHaveValue("3");
    await expect
      .poll(() => [...new URL(page.url()).searchParams.keys()])
      .toEqual(["osoba"]);

    // The other order is still reachable, and says so in the url so the choice
    // survives a reload.
    await page
      .getByRole("button", { name: "Najwyżej oceniane" })
      .click({ force: true });
    await page.waitForURL(/order=votes/);
    await expect(page.getByLabel("Min. suma głosów")).toHaveCount(0);
    await expect(firstRowName).toBeVisible({ timeout: 15000 });
  });
});
