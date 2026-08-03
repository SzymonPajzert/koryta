import { test, expect, type Page } from "@playwright/test";

/** Everything a search that found nothing can be turned into, in the order the
 * menu offers them. A person comes first because it is what most searches are
 * for; a claim usually needs the institution and the source as well. */
const CREATE_OPTIONS = ["person", "place", "article"] as const;

const addOption = (type: string) => `[data-testid="omni-search-add-${type}"]`;
const ADD_PERSON = addOption("person");

/** Types into the omni search and waits for the menu to react. */
async function searchFor(page: Page, query: string) {
  await expect(page.locator(".v-main")).toBeVisible({ timeout: 15000 });
  await page.waitForLoadState("networkidle");

  await page.locator("input#omni-search").click();
  await page.locator("input#omni-search").fill(query);
}

test.describe("OmniSearch add person", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("offers adding a person as the empty state when nothing matches", async ({
    page,
  }) => {
    const query = "Zbigniew Nieistniejacy Kompletnie";
    await searchFor(page, query);

    const addPerson = page.locator(ADD_PERSON);
    await expect(addPerson).toBeVisible({ timeout: 10000 });
    await expect(addPerson).toContainText("Dodaj nową osobę");
    await expect(addPerson).toContainText(query);

    // The create options are the only things offered, since nothing matched -
    // and all three are on offer, each carrying the query it would be named by
    await expect(page.locator(".v-overlay--active .v-list-item")).toHaveCount(
      CREATE_OPTIONS.length,
    );
    for (const type of CREATE_OPTIONS) {
      await expect(page.locator(addOption(type))).toContainText(query);
    }
  });

  test("offers adding a person below existing results", async ({ page }) => {
    // "PO" always matches the hardcoded party entry, independent of seed data
    await searchFor(page, "PO");

    const partyItem = page
      .locator(".v-list-item", { hasText: "PO" })
      .filter({ hasText: "Partia" })
      .first();
    await expect(partyItem).toBeVisible({ timeout: 10000 });

    const addPerson = page.locator(ADD_PERSON);
    await expect(addPerson).toBeVisible();
    await expect(addPerson).toContainText("Dodaj nową osobę");

    // Appended after the results rather than mixed into them: the create
    // options are the tail of the menu, whatever matched above them
    const items = page.locator(".v-overlay--active .v-list-item");
    const tail = (await items.count()) - CREATE_OPTIONS.length;
    for (const [offset, type] of CREATE_OPTIONS.entries()) {
      await expect(items.nth(tail + offset)).toHaveAttribute(
        "data-testid",
        `omni-search-add-${type}`,
      );
    }
  });

  test("creates a person that only logged in users can see", async ({
    page,
  }) => {
    test.setTimeout(90000);

    const timestamp = Date.now();
    const personName = `Testowa Osoba ${timestamp}`;

    await searchFor(page, personName);

    // 1. Logged out, so the activator asks to log in first
    await page.locator(ADD_PERSON).click();

    const loginDialog = page.locator('.v-dialog:has-text("Zaloguj się")');
    await expect(loginDialog).toBeVisible({ timeout: 10000 });

    const switchToRegister = loginDialog.locator(
      'a:has-text("Nie masz konta? Zarejestruj się")',
    );
    if (await switchToRegister.isVisible()) {
      await switchToRegister.click();
    }

    await loginDialog
      .locator("input#email")
      .fill(`omni-add${timestamp}@example.com`);
    await loginDialog.locator("input#password").fill("password123");

    // Dismiss the "verification email sent" alert
    page.on("dialog", (dialog) => dialog.accept());
    await loginDialog.locator('button:has-text("Stwórz konto")').click();

    // 2. After logging in the create dialog opens, prefilled with the query.
    // Logging in blurs the search box, so this also covers that the name
    // survives the round trip.
    const createDialog = page.locator(
      '.v-dialog:has-text("Zaproponuj dodanie osoby")',
    );
    await expect(createDialog).toBeVisible({ timeout: 20000 });
    await expect(
      createDialog.getByLabel("Nazwa / Imię i nazwisko"),
    ).toHaveValue(personName);

    // 3. The optional person fields are editable here too
    const wikipedia = `https://pl.wikipedia.org/wiki/Test_${timestamp}`;
    const rejestrIo = `https://rejestr.io/osoby/test-${timestamp}`;
    await createDialog.getByLabel("Link do Wikipedii").fill(wikipedia);
    await createDialog.getByLabel("Link do Rejestr.io").fill(rejestrIo);
    await createDialog
      .getByLabel("Treść (opcjonalnie)")
      .fill("Notatka testowa");

    await createDialog.locator('button:has-text("Zaproponuj")').click();
    await expect(createDialog).not.toBeVisible({ timeout: 20000 });

    // 4. The new node has an id of its own and is shown as a pending revision
    await expect(page).toHaveURL(/\/osoba\/.+\?revisionId=.+/, {
      timeout: 20000,
    });
    await expect(
      page.locator('.v-alert:has-text("Wyświetlasz podgląd")'),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator("h2")).toContainText(personName);

    const createdUrl = page.url();
    const nodeUrl = createdUrl.split("?")[0]!;

    // 5. A logged out visitor must not see it
    const anonContext = await page.context().browser()!.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(nodeUrl);

    await expect(
      anonPage.locator('.v-card:has-text("Dostęp zastrzeżony")'),
    ).toBeVisible({ timeout: 20000 });
    await expect(anonPage.locator("body")).not.toContainText(personName);

    await anonContext.close();
  });
});
