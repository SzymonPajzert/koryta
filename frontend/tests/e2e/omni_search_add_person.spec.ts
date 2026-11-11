import { test, expect, type Locator, type Page } from "@playwright/test";
import { answerNewsletterQuestion } from "./helpers/login";
import { omniSearchFor } from "./helpers/omniSearch";

/** Everything a search that found nothing can be turned into, in the order the
 * menu offers them. A person comes first because it is what most searches are
 * for; a claim usually needs the institution and the source as well. */
const CREATE_OPTIONS = ["person", "place", "article"] as const;

const addOption = (type: string) => `[data-testid="omni-search-add-${type}"]`;
const ADD_PERSON = addOption("person");

/** Types into the omni search and waits for `expected` to show up.
 *
 * The typing is retried rather than waited on. `networkidle` never arrives on
 * a page that holds Firestore listeners open - which every page does once
 * somebody is signed in - and a fill that lands before Vue has hydrated the
 * field is wiped without ever reaching the component. See helpers/omniSearch.
 */
async function searchFor(
  page: Page,
  query: string,
  expected: Locator,
  timeout?: number,
) {
  await expect(page.locator(".v-main")).toBeVisible({ timeout: 15000 });
  await omniSearchFor(page, query, expected, timeout);
}

test.describe("OmniSearch add person", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("offers adding a person as the empty state when nothing matches", async ({
    page,
  }) => {
    const query = "Zbigniew Nieistniejacy Kompletnie";
    const addPerson = page.locator(ADD_PERSON);
    await searchFor(page, query, addPerson);

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
    const partyItem = page
      .locator(".v-list-item", { hasText: "PO" })
      .filter({ hasText: "Partia" })
      .first();
    // "PO" always matches the hardcoded party entry, independent of seed data
    await searchFor(page, "PO", partyItem);

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
    test.setTimeout(150000);

    const timestamp = Date.now();
    const personName = `Testowa Osoba ${timestamp}`;

    await searchFor(page, personName, page.locator(ADD_PERSON));

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

    await loginDialog.locator('button:has-text("Stwórz konto")').click();
    // The dialog asks a new account about the newsletter before the form
    // the reader came for opens.
    await answerNewsletterQuestion(page);

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
    await expect(page.locator("h1")).toContainText(personName);

    const createdUrl = page.url();
    const nodeUrl = createdUrl.split("?")[0]!;

    // 5. Searching the name again finds them. The one thing a picker that
    // offers to create a person must not do is lose them: /api/search orders by
    // `stats.nodeGroupSize`, Firestore returns no document that lacks the field
    // it is ordered on, and nothing writes that field until an admin runs
    // /api/stats/computeNodes - so a person created here could be added once and
    // never found again. The name index is written by a Firestore trigger and
    // lands a moment after the node does, and the menu only queries when the
    // query changes, so this retypes rather than waiting on a stale menu.
    await page.goto("/");
    await searchFor(
      page,
      personName,
      page
        .locator(
          '.v-overlay--active .v-list-item:not([data-testid^="omni-search-add-"])',
          { hasText: personName },
        )
        .first(),
      45000,
    );

    // 6. A logged out visitor must not see it
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
