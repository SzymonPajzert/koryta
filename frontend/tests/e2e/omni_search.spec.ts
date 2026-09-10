import { test, expect } from "@playwright/test";
import { omniSearchFor } from "./helpers/omniSearch";

test.describe("OmniSearch", () => {
  test.beforeEach(async ({ page }) => {
    // The dev server keeps live listeners open, so "load" never settles here
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();
  });

  test("allows searching for parties", async ({ page }) => {
    // We expect "PO" as a title and "Partia" as a subtitle.
    const poItem = page
      .locator(".v-list-item", { hasText: "PO" })
      .filter({ hasText: "Partia" })
      .first();
    await omniSearchFor(page, "PO", poItem);

    // Click the item
    await poItem.click();
    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*party=PO/);

    // Verify the filter is set, and says so. The „Partia” autocomplete that
    // used to carry this chip is behind the „Filtry” button now and is not in
    // the dom until the panel is opened; the query bar's rail is what names a
    // filter the reader can no longer see, and its count is the second half of
    // the same statement.
    await expect(
      page.locator(".tabela-query-bar__rail .v-chip", { hasText: "PO" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filtry/ })).toHaveText(
      /Filtry \(1\)/,
    );
  });

  test("allows searching for regions", async ({ page }) => {
    // Click Opole entry
    const opoleItem = page
      .locator(".v-list-item", { hasText: "Opole" })
      .first();
    await omniSearchFor(page, "Opole", opoleItem);

    // Click the item
    await opoleItem.click();

    // Straight to the table, and not to the region's own page even though
    // regions have one now: `/api/search` answers a region with a `query`, so
    // OmniSearch routes on that rather than on `generateNodeUrl`. Filtering
    // the table is what somebody typing a region name is asking for.
    await expect(page).toHaveURL(/.*\/eksploruj\/tabela\?.*teryt=1661/);

    // Same as above: the region is named by its chip on the query bar, not by
    // the „Region osoby” control, which is one click in. `shared/queryUrl`
    // spells this chip „Region: <nazwa>”.
    await expect(
      page.locator(".tabela-query-bar__rail .v-chip", {
        hasText: "Region: Opole",
      }),
    ).toBeVisible();
  });

  test("should dedup companies", async ({ page }) => {
    // We expect "Orlen" to appear
    const orlenItem = page
      .locator(".v-list-item", { hasText: "Orlen" })
      .first();
    await omniSearchFor(page, "Orlen", orlenItem);

    await orlenItem.click();

    // A company opens its own page. It used to open the table filtered to it,
    // which listed the company's people and nothing about the company.
    await expect(page).toHaveURL(/.*\/instytucja\/.+/);
    // Prod data carries the uppercase KRS registry name ("ORLEN"), the local
    // seed uses "Orlen" - accept both.
    await expect(page.locator(".v-main")).toContainText("ORLEN", {
      ignoreCase: true,
    });
  });

  test("finds a name with a word typed over", async ({ page }) => {
    // „Wojewódzki Zakład Testowy” has a word in the middle that nobody
    // searching for it would type, the way two of every five people in the
    // database have a middle name. No chunk of the index spans it, so this
    // found nothing at all until the endpoint learned to match the typed words
    // against the name one at a time - and Vuetify's own filter, which wants
    // the query as one substring of the title, threw the hit away again.
    const item = page
      .locator(".v-list-item", { hasText: "Wojewódzki Zakład Testowy" })
      .first();
    await omniSearchFor(page, "Wojewódzki Testowy", item);

    await item.click();
    await expect(page).toHaveURL(/.*\/instytucja\/.+/);
  });
});
