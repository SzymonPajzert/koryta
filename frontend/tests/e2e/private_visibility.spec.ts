import { test, expect } from "@playwright/test";

test.describe("Private Entity Visibility", () => {
  test("user logs in and sees private entity in tabela", async ({ page }) => {
    test.setTimeout(120000);
    // 1. Navigate to login page
    await page.goto("/login");

    const email = "testuser@koryta.pl";
    const password = "password123";

    // 2. Wait for either the logout button or the email input to be visible
    const emailInput = page.locator('input[type="email"]').first();
    const logoutBtn = page.locator('text="Wyloguj się teraz"').first();
    const authStateLocator = emailInput.or(logoutBtn);
    await authStateLocator.waitFor({ state: "visible", timeout: 30000 });

    const logoutButtonVisible = await logoutBtn.isVisible();

    if (!logoutButtonVisible) {
      // Not logged in, fill login form
      await page.locator('input[type="email"]').first().fill(email);
      await page.locator('input[type="password"]').first().fill(password);
      await page.locator('button[type="submit"]').first().click();

      // Wait a bit to see if we're still on login
      await page.waitForTimeout(2000);

      const isLoginUrl = page.url().includes("/login");
      if (isLoginUrl) {
        // Might need to register
        const registerBtn = page
          .locator(
            'a:has-text("Zarejestruj"), button:has-text("Zarejestruj"), a:has-text("Stwórz konto")'
          )
          .first();
        if (await registerBtn.isVisible()) {
          await registerBtn.click();
          await page.locator('input[type="email"]').first().fill(email);
          await page.locator('input[type="password"]').first().fill(password);
          await page
            .locator(
              'button:has-text("Stwórz konto"), button:has-text("Zarejestruj")'
            )
            .first()
            .click();
        }
      }
    }

    // Wait for the user to be logged in (avatar or profile button visible)
    await expect(
      page.locator('a[href="/profil"], button[to="/profil"], .v-avatar').first()
    ).toBeVisible({ timeout: 30000 });

    // 3. Visit the target URL
    await page.goto(
      "/eksploruj/tabela?page=1&itemsPerPage=50&teryt=1261&visibility=private"
    );

    // 4. Wait for table to load
    await expect(page.locator(".v-main")).toBeVisible();
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible();

    // 5. Verify the person is among the people in the table
    const row = page.locator("tbody tr", {
      hasText: "Wojciech Robert Szczepanik",
    });
    await expect(row).toBeVisible({ timeout: 15000 });
  });
});
