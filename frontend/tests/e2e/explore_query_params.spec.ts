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
   * document without the field - so renaming the merged column's key would
   * answer this url with an empty table rather than with an error. Its title
   * has been through "Historia" and is now "Firmy"; the key under it has not
   * moved and must not.
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
    await expect(sorted).toContainText("Firmy");
    expect(new URL(page.url()).searchParams.get("sortBy")).toBe(
      "latestEmploymentStart",
    );
  });

  /** The same hazard for the facts sort, which is the newest key in
   * `tableSortOptions`: the api maps it onto `stats.factsCount`, and a key it
   * failed to map would go into `orderBy` verbatim and drop every document -
   * an empty table rather than an error. The order itself is asserted, not
   * just that rows came back, because ordering by the wrong field would also
   * return a full table.
   *
   * Signed in for the same reason the sort exists: the facts themselves are
   * behind the login, and the seeded person the extraction fixture names is
   * the only one with any. */
  test("sorts on the linked factsCount key", async ({ page }) => {
    test.setTimeout(120000);
    await logIn(
      page,
      USERS.normal,
      "/eksploruj/tabela?sortBy=factsCount&sortDesc=true",
    );

    const firstRow = page.locator("tbody tr").first();
    await expect(
      firstRow.locator(".text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });
    // Two facts in scripts/extractions.json name her and nobody else has one.
    await expect(firstRow).toContainText("Anna Nowak");
    await expect(firstRow).toContainText("2 fakty");
    // „Fakty” has no column of its own, so the „Oceny” header is where the
    // reader is told what the table is ordered by.
    await expect(
      page.getByRole("columnheader", { name: /Oceny/ }),
    ).toContainText("liczba faktów");
    expect(new URL(page.url()).searchParams.get("sortBy")).toBe("factsCount");
  });

  test("keeps the filter in the url and drops it when cleared", async ({
    page,
  }) => {
    await page.goto(FILTERED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-data-table")).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    expect(new URL(page.url()).searchParams.get("teryt")).toBe(TERYT);

    // The clear used to be the „Region osoby” autocomplete's own x. That
    // control now lives behind the „Filtry” button and is not in the dom until
    // the panel is opened; the chip on the query bar is what stands in for it,
    // and its x is the one affordance that has to work without opening
    // anything. `Usuń filtr:` is the `close-label` the bar sets on every chip -
    // the region's own name is whatever the seeded teryt resolves to, so this
    // matches on the prefix.
    await page
      .getByRole("button", { name: /^Usuń filtr: Region:/ })
      .click({ timeout: 15000 });

    await expect
      .poll(() => new URL(page.url()).searchParams.get("teryt"), {
        timeout: 15000,
      })
      .toBeNull();
  });
});
