import { test, expect } from "@playwright/test";

/** Search over the real index.
 *
 * The query needs `nameChunksLower`, which the compute function writes - so
 * this covers a path that spans the functions deploy and the App Hosting
 * deploy at once, the two things that ship on separate cadences.
 *
 * The term is taken from the deployment itself rather than hardcoded: a smoke
 * test that names a person breaks when that person is edited, and a check
 * nobody trusts is worse than no check.
 */
test.describe("search", () => {
  test("finds a person the table lists", async ({ page, request }) => {
    await page.goto("/eksploruj/tabela", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 45_000,
    });

    const name = (
      await page
        .locator("tbody tr:first-child .text-primary.cursor-pointer")
        .first()
        .innerText()
    ).trim();
    expect(name.length).toBeGreaterThan(0);

    // The index holds whole name chunks, so search for one word, not the
    // whole name.
    const term = name.split(/\s+/)[0] ?? name;

    const response = await request.get(
      `/api/search?q=${encodeURIComponent(term)}&limit=5`,
    );
    expect(response.status()).toBe(200);

    const results = await response.json();
    expect(Array.isArray(results)).toBe(true);
    expect(
      results.length,
      `no search results for "${term}", taken from the table`,
    ).toBeGreaterThan(0);
  });
});
