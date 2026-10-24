import { test, expect } from "@playwright/test";
import {
  answerNewsletterQuestion,
  waitForLoginFormHydrated,
} from "./helpers/login";

test.describe("Suggest node edits", () => {
  test("User can suggest an edit and admin can see it", async ({ page }) => {
    test.setTimeout(240_000); // Registers, proposes an edit, waits out a Cloud Function
    // 1. Go to login page
    await page.goto("/login");

    // Wait for Vue hydration to complete before interacting
    await waitForLoginFormHydrated(page);

    // 2. Switch to register mode
    await page.locator("text=Nie masz konta? Zarejestruj się").click();
    await expect(page.locator('button:has-text("Stwórz konto")')).toBeVisible();

    // 3. Fill credentials
    const timestamp = Date.now();
    await page.locator("input#email").fill(`edituser${timestamp}@example.com`);
    await page.locator("input#password").fill("password123");

    // 4. Submit registration, and answer the newsletter question a new
    // account is asked before it goes back.
    await page.locator('button:has-text("Stwórz konto")').click();
    await answerNewsletterQuestion(page);

    // Wait for the redirect from login page to home
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15000,
    });

    // Wait for the user avatar to appear
    await page.waitForSelector(
      'a[href="/profil"], button[to="/profil"], .v-avatar',
      { timeout: 15000 },
    );

    // 5. Open a person's page. This used to pick the first card off /lista;
    // that page is gone, and no list left renders a person as a link - the
    // table opens a drawer instead. Naming the seeded node is what the rest of
    // the suite does anyway, and /admin/rewizje/:id in step 9 is keyed on it.
    const nodeId = "1"; // Jan Kowalski, seeded as node 1
    await page.goto(`/entity/person/${nodeId}`);

    // Wait to navigate to the person page (which might redirect to /osoba/...)
    // - the name is the page's one h1.
    await page.waitForSelector("h1", { timeout: 15000 });

    // 6. Wait for the propose edit button
    const proposeEditButton = page.locator(
      'button:has-text("Zaproponuj zmianę")',
    );
    await expect(proposeEditButton).toBeVisible();

    // The page may still be mid-hydration - the button is in the markup but
    // Vue hasn't attached its listener yet, so the click is silently dropped
    // (`force` skips the actionability wait that would otherwise hide this).
    // Retry until the dialog actually opens.
    const dialog = page.locator(".v-dialog");
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await proposeEditButton.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    // Fill the new content
    const newContent = `Testowa edycja contentu ${timestamp}`;
    await page.getByLabel("Treść (opcjonalnie)").fill(newContent);

    // Submit edit
    await page.locator('.v-dialog button:has-text("Zaproponuj")').click();

    // Wait for dialog to close
    await page.waitForSelector(".v-dialog", { state: "hidden" });

    // 7. Read the edit back on the node's revisions page.
    //
    // Addressed by node rather than by walking /admin/rewizje and clicking the
    // first row: that list is not ordered by recency, so "first row" was the
    // seeded revision as often as not. The retry is for onRevisionWritten -
    // the revision only joins the node's map once that Cloud Function has run,
    // and there is no event to wait for from here.
    await expect(async () => {
      await page.goto(`/admin/rewizje/${nodeId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.locator(`.comparison-table:has-text("${newContent}")`),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 120_000 });
  });
});
