import { test, expect } from "@playwright/test";

test.describe("Suggest node edits", () => {
  test("User can suggest an edit and admin can see it", async ({ page }) => {
    test.setTimeout(60000); // This test goes through a long flow
    // 1. Go to login page
    await page.goto("/login");

    // Wait for Vue hydration to complete before interacting
    await page.waitForTimeout(1500);

    // 2. Switch to register mode
    await page.locator("text=Nie masz konta? Zarejestruj się").click();
    await expect(page.locator('button:has-text("Stwórz konto")')).toBeVisible();

    // 3. Fill credentials
    const timestamp = Date.now();
    await page.locator("input#email").fill(`edituser${timestamp}@example.com`);
    await page.locator("input#password").fill("password123");

    // Handle the alert window that says "Wysłano email weryfikacyjny"
    page.on("dialog", (dialog) => dialog.accept());

    // 4. Submit registration
    await page.locator('button:has-text("Stwórz konto")').click();

    // Wait for the redirect from login page to home
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15000,
    });

    // Wait for the user avatar to appear
    await page.waitForSelector(
      'a[href="/profil"], button[to="/profil"], .v-avatar',
      { timeout: 15000 },
    );

    // 5. Navigate to a page with people
    await page.goto("/lista");

    // Wait for the list of people to load
    await page.waitForSelector(".v-card");

    // Find the first person link and click it
    const firstPersonCard = page
      .locator(".v-card[href^='/entity/person/']")
      .first();
    await firstPersonCard.click();

    // Wait to navigate to the person page (which might redirect to /osoba/...)
    await page.waitForSelector("h2.text-h5", { timeout: 15000 });

    // 6. Wait for the propose edit button
    const proposeEditButton = page.locator(
      'button:has-text("Zaproponuj zmianę")',
    );
    await expect(proposeEditButton).toBeVisible();
    await proposeEditButton.click({ force: true });

    // Wait for dialog
    await page.waitForSelector(".v-dialog");

    // Fill the new content
    const newContent = `Testowa edycja contentu ${timestamp}`;
    await page.getByLabel("Treść (opcjonalnie)").fill(newContent);

    // Submit edit
    await page.locator('.v-dialog button:has-text("Zaproponuj")').click();

    // Wait for dialog to close
    await page.waitForSelector(".v-dialog", { state: "hidden" });

    // Wait a bit for the Cloud Function to update the node's `revisions` map
    await page.waitForTimeout(3000);

    // 7. Go to admin revisions page
    await page.goto("/admin/rewizje");

    // Wait for the table to load
    await page.waitForSelector(".v-data-table");
    await page.waitForSelector("tbody tr:first-child");

    // Check that the edited node is in the list (most recent)
    const firstRow = page.locator("tbody tr").first();

    // Get the link to the revision
    const totalCell = firstRow.locator("td").nth(2);
    await totalCell.locator("a").click();

    // 8. Verify the suggested changes on the revisions page
    await page.waitForURL(/\/admin\/rewizje\/[a-zA-Z0-9_-]+(?:\?.*)?$/);
    await page.waitForSelector(".comparison-table");

    // Check if the new content is visible
    await expect(
      page.locator(`.comparison-table:has-text("${newContent}")`),
    ).toBeVisible();
  });
});
