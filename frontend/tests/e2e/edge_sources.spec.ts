import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Citing a relation that is already in the base, from both ends of the job.
 *
 * The node ids are the ones scripts/seed-emulator.ts writes. Jan Kowalski (1)
 * works at a company (2) and knows Anna Nowak (3); article 8 is seeded with no
 * relations at all, so anything the article page lists afterwards can only have
 * come from the form.
 */

/** Pick an entry in one of the dialog's autocompletes.
 *
 * Retried as a whole because the suite runs against the dev server: until the
 * dialog has hydrated a `fill` writes the DOM value without it reaching the
 * component, so no search is ever issued and no option appears. */
async function choose(page: Page, field: string, name: string) {
  const input = page.getByTestId(field).locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(name);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

test.describe("Sources on a relation", () => {
  test("a reader cites an article for a relation from a person's page", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.normal, "/entity/person/1");

    // Every seeded relation rests on nothing, so the button says "add" rather
    // than counting - and there is one on each row of the list.
    const open = page.getByTitle("Dodaj źródło powiązania").first();
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    const dialog = page.getByTestId("edge-sources-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId("edge-sources-empty")).toBeVisible();

    await choose(page, "edge-sources-picker", "Sample Article");
    await dialog.getByTestId("edge-sources-add").click();

    await expect(dialog.getByText("Sample Article")).toBeVisible({
      timeout: 30_000,
    });
    await expect(dialog.getByTestId("edge-sources-empty")).toBeHidden();

    // Really stored: the count on the row is read back from the graph.
    await page.reload();
    await expect(
      page.getByTitle("Pokaż źródła powiązania").first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a reader cites the article they are reading for an existing relation", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // "Artykuł bez krawędzi" - nothing rests on it in the seed.
    await logIn(page, USERS.normal, "/entity/article/8");

    await expect(
      page.getByText("Żadne powiązanie nie powołuje się jeszcze"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("article-cite-existing-edge").click();
    const dialog = page.getByTestId("cite-existing-edge-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    await choose(page, "cite-existing-entity", "Jan Kowalski");
    const relations = dialog.getByTestId("cite-existing-list");
    await expect(relations).toBeVisible({ timeout: 30_000 });
    await relations.locator(".v-list-item").first().click();
    await dialog.getByTestId("cite-existing-submit").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The list the article page keeps of what rests on it now has the relation.
    // Read off that list rather than off the page: the embedded graph draws the
    // same names, and a bare text match would find them there too. The `:not`
    // drops each row's own detach button, which shares the prefix.
    const sourced = page
      .locator('[data-testid^="sourced-edge-"]:not([data-testid*="detach"])')
      .filter({ hasText: "Jan Kowalski" });
    await expect(sourced.first()).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(sourced.first()).toBeVisible({ timeout: 30_000 });
  });
});
