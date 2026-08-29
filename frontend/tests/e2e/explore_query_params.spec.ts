import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Seeded region, so this runs on the emulator's own data. */
const TERYT = "22";
const FILTERED = `/eksploruj/tabela?teryt=${TERYT}`;

test.describe("Explore query parameters", () => {
  test("leaves a clean url alone", async ({ page }) => {
    await page.goto("/eksploruj/tabela", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    // Defaults belong in the code, not in the url - writing them back used to
    // add a history entry that the back button had to walk through first.
    expect(new URL(page.url()).search).toBe("");

    await page.goBack();
    await expect(page).not.toHaveURL(/\/eksploruj\/tabela/, { timeout: 15000 });
  });

  test("does not carry filters onto the next page", async ({ page }) => {
    await page.goto(FILTERED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });

    await page.locator("header").getByText("koryta.pl").click();
    await page.waitForTimeout(3000);

    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).search).toBe("");
  });

  /** The linked sort, end to end. `server/api/nodes/index.get.ts` maps this key
   * onto `stats.edges.*.latestEmploymentStart` and hands everything else it is
   * given straight to a Firestore `orderBy`, which silently drops every
   * document without the field - so renaming the merged "Historia" column's key
   * would answer this url with an empty table rather than with an error.
   *
   * Signed in on purpose: the one seeded person carrying a
   * `latestEmploymentStart` is an unapproved draft, so the signed-out query
   * legitimately has nothing to sort. */
  test("sorts on the linked latestEmploymentStart key", async ({ page }) => {
    test.setTimeout(120000);
    await logIn(
      page,
      USERS.normal,
      "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
    );

    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });

    // The arrow sits on the merged column, and the url the reader arrived with
    // is still the url they are on.
    const sorted = page.locator("th.v-data-table__th--sorted");
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toContainText("Historia");
    expect(new URL(page.url()).searchParams.get("sortBy")).toBe(
      "latestEmploymentStart",
    );
  });

  test("keeps the filter in the url and drops it when cleared", async ({
    page,
  }) => {
    await page.goto(FILTERED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    expect(new URL(page.url()).searchParams.get("teryt")).toBe(TERYT);

    await page
      .getByRole("button", { name: "Clear Region osoby" })
      .click({ timeout: 15000 });

    await expect
      .poll(() => new URL(page.url()).searchParams.get("teryt"), {
        timeout: 15000,
      })
      .toBeNull();
  });
});
