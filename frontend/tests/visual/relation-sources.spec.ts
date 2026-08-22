import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** Citing a relation, captured at each place a reader meets it.
 *
 * Kept out of pages.spec.ts because none of it is a url: every shot needs a
 * signed in reader, and three of them need a click. Each capture is of one
 * element rather than the whole page - both pages draw a force-directed graph,
 * which settles somewhere slightly different on every run and would fail a
 * full-page comparison for reasons that have nothing to do with this.
 *
 * The seed does the rest: the relation Piotr Wiśniewski (4) has with the
 * company (2) carries "Sample Article" (6) as its source, so the count on the
 * row, the list inside the dialog and the article's own list of what rests on
 * it all have something to draw without a spec writing first.
 */

/** Everything that has to have arrived before a shot is worth taking. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

/** Pick an entry in one of the dialog's autocompletes.
 *
 * Retried as a whole because the suite runs against a server it has just
 * started: until the dialog has hydrated a `fill` writes the DOM value without
 * it reaching the component, so no search is ever issued. */
async function choose(page: Page, field: string, name: string) {
  const input = page.getByTestId(field).locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(name);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

test.describe("Citing a relation", () => {
  test("powiazania-zrodla-lista", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/entity/person/4");

    const relations = page.getByTestId("relations-history");
    await expect(relations).toBeVisible({ timeout: 30_000 });
    // The count only appears once the graph the row is built from has landed.
    await expect(relations.getByTitle("Pokaż źródła powiązania")).toBeVisible({
      timeout: 30_000,
    });
    await settled(page);

    await expect(relations).toHaveScreenshot("powiazania-zrodla-lista.png");
  });

  test("powiazania-zrodla-dialog", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/entity/person/4");

    await page.getByTitle("Pokaż źródła powiązania").first().click({
      timeout: 30_000,
    });
    const dialog = page.getByTestId("edge-sources-dialog");
    await expect(dialog.getByText("Sample Article")).toBeVisible({
      timeout: 30_000,
    });
    await settled(page);

    await expect(dialog).toHaveScreenshot("powiazania-zrodla-dialog.png");
  });

  test("artykul-zrodla-sekcja", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/entity/article/6");

    const section = page.getByTestId("article-sources-section");
    await expect(section.getByText("Piotr Wiśniewski")).toBeVisible({
      timeout: 30_000,
    });
    await settled(page);

    await expect(section).toHaveScreenshot("artykul-zrodla-sekcja.png");
  });

  test("artykul-powolaj-dialog", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/entity/article/6");

    await page.getByTestId("article-cite-existing-edge").click({
      timeout: 30_000,
    });
    const dialog = page.getByTestId("cite-existing-edge-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // Jan Kowalski rather than Piotr: his relations rest on nothing yet, so
    // the list is the ordinary case - rows to choose between, one of them
    // picked - rather than the single already-cited row Piotr would give.
    await choose(page, "cite-existing-entity", "Jan Kowalski");
    const relations = dialog.getByTestId("cite-existing-list");
    await expect(relations).toBeVisible({ timeout: 30_000 });
    await relations.locator(".v-list-item").first().click();
    await settled(page);

    await expect(dialog).toHaveScreenshot("artykul-powolaj-dialog.png");
  });
});
