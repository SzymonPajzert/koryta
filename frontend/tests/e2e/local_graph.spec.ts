import { test, expect } from "@playwright/test";

/** v-network-graph draws the labels as SVG text, which `getByText` will not
 * find - it reads innerText, and SVG elements have none. */
const label = (page: import("@playwright/test").Page, name: string) =>
  page.locator("svg text").filter({ hasText: name });

test.describe("Local graph", () => {
  test("an entity page shows the node and its neighbours", async ({ page }) => {
    test.setTimeout(60_000); // The force directed layout takes a while to settle

    await page.goto("/osoba/jan-kowalski-1", { waitUntil: "domcontentloaded" });

    await expect(label(page, "Jan Kowalski").first()).toBeVisible({
      timeout: 30_000,
    });
    // Both seeded neighbours: the employer and the person he is linked to
    await expect(label(page, "Orlen").first()).toBeVisible({ timeout: 30_000 });
    await expect(label(page, "Anna Nowak").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("/graf draws the graph around the node it is given", async ({
    page,
  }) => {
    test.setTimeout(60_000); // The force directed layout takes a while to settle

    // Orlen, seeded as node 2, in the shape everything linking here uses: the
    // "Graf powiązań" button on a place and the omni search both name the node
    // in `?miejsce=`. The page used to ignore the query and centre on a
    // hardcoded id of "0", which nothing in the data carries, so it drew an
    // empty canvas whatever you clicked.
    await page.goto("/graf?miejsce=2", { waitUntil: "domcontentloaded" });

    await expect(label(page, "Orlen").first()).toBeVisible({ timeout: 30_000 });
    await expect(label(page, "Jan Kowalski").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
