import { test, expect } from "@playwright/test";

test.describe("Tabela side panel suggest changes", () => {
  test("User can suggest an edit from the side panel and see preview link", async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Go to the tabela page — allow extra time for cold-start/Vite pre-bundling
    await page.goto("/eksploruj/tabela", { waitUntil: "load", timeout: 30000 });
    await expect(page.locator(".v-main")).toBeVisible({ timeout: 15000 });

    // Wait for any Vite-triggered page reloads to settle
    await page.waitForLoadState("domcontentloaded");

    // Wait for the data table progress indicator to disappear
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 30000,
    });

    // 2. Click the first person row to open the side panel
    const firstRowName = page
      .locator("tbody tr:first-child .text-primary.cursor-pointer")
      .first();
    await expect(firstRowName).toBeVisible({ timeout: 30000 });
    const _personName = await firstRowName.innerText();
    await firstRowName.click();

    // 3. Verify the side panel (navigation drawer) is open
    const drawer = page.locator(".v-navigation-drawer--active");
    await expect(drawer).toBeVisible();

    // 4. Click "Zaproponuj zmianę" — since user is not logged in, login dialog appears
    const proposeButton = drawer.locator(
      'button:has-text("Zaproponuj zmianę")',
    );
    await expect(proposeButton).toBeVisible();
    await proposeButton.click();

    // 5. Login dialog — register a new user
    const loginDialog = page.locator(".v-dialog");
    await expect(loginDialog).toBeVisible({ timeout: 5000 });

    const timestamp = Date.now();
    const switchToRegister = loginDialog.locator(
      'a:has-text("Nie masz konta? Zarejestruj się")',
    );
    if (await switchToRegister.isVisible()) {
      await switchToRegister.click();
    }

    await loginDialog
      .locator("input#email")
      .fill(`tabela-test${timestamp}@example.com`);
    await loginDialog.locator("input#password").fill("password123");

    // Handle alert window for email verification
    page.on("dialog", (dialog) => dialog.accept());

    await loginDialog.locator('button:has-text("Stwórz konto")').click();

    // Wait for the edit dialog to open
    const editDialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
    await expect(editDialog).toBeVisible({ timeout: 15000 });

    // 6. Add a party: click the select, wait for the menu, then pick an item
    const partySelect = editDialog.locator(
      '.v-select:has-text("Przynależność partyjna")',
    );
    await partySelect.click();

    // Wait for the dropdown menu to be fully rendered
    const menuList = page.locator(".v-overlay--active .v-list");
    await expect(menuList).toBeVisible({ timeout: 5000 });

    // Click the first party option using force to bypass Vuetify animation instability
    const firstItem = menuList.locator(".v-list-item").first();
    await expect(firstItem).toBeVisible();
    await firstItem.click({ force: true });

    // Close the dropdown by clicking the card title area
    await editDialog.locator(".v-card-title").click();

    // 7. Submit the edit
    await editDialog.locator('button:has-text("Zaproponuj")').click();

    // 8. Wait for the dialog to close
    await expect(editDialog).not.toBeVisible({ timeout: 10000 });

    // 9. Verify the side panel is STILL open
    await expect(drawer).toBeVisible();

    // 10. Verify the revision notice is shown
    const revisionAlert = drawer.locator(
      '.v-alert:has-text("Zaproponowano zmianę")',
    );
    await expect(revisionAlert).toBeVisible({ timeout: 5000 });

    // 11. Verify the preview link exists and contains the revisionId
    const previewLink = revisionAlert.locator('a:has-text("Podgląd zmiany")');
    await expect(previewLink).toBeVisible();

    const href = await previewLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toContain("revisionId=");

    // 12. Navigate to the preview link to verify it loads the revision
    const previewPage = await page.context().newPage();
    await previewPage.goto(href!);

    // The preview page should show the revision info alert
    await expect(
      previewPage.locator(
        '.v-alert:has-text("Wyświetlasz podgląd zaproponowanej zmiany")',
      ),
    ).toBeVisible({ timeout: 15000 });

    await previewPage.close();
  });
});
