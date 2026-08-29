import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** What "trzeba przescrollować 3 razy, żeby coś można było zobaczyć" means as
 * something a test can hold: on a phone the first row of the table has to be
 * within reach of the top of the page, and the page must not scroll sideways.
 *
 * Measured rather than screenshotted, because the number is the complaint. On
 * koryta.pl at 375x667 the first row sat 1316px down - two screens of heading,
 * login banner and six stacked filter selects - and the document was 5px wider
 * than the viewport.
 */
const PHONE = { width: 375, height: 667 };

/** One screen of chrome above the table is fair: the heading and the filter
 * button have to go somewhere. Two is what the report was about. */
const MAX_ROW_OFFSET = PHONE.height + 250;

test.describe("the table on a phone", () => {
  test.use({ viewport: PHONE });

  test("opens near the table and does not scroll sideways", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela", { waitUntil: "load" });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });

    const { firstRowOffset, scrollWidth, clientWidth } = await page.evaluate(
      () => {
        const row = document.querySelector("tbody tr");
        return {
          firstRowOffset: row
            ? Math.round(row.getBoundingClientRect().top + window.scrollY)
            : Number.POSITIVE_INFINITY,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      },
    );

    expect(firstRowOffset).toBeLessThan(MAX_ROW_OFFSET);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  /** The other half of the same report: four columns fit a 375px phone only by
   * being four truncated ones - a party ellipsised after six letters, a
   * company after eight. Name+partie and firmy+wybory are one cell apiece now,
   * so the phone gets two columns with 120px and 185px to spend rather than
   * four with 100/60/72/72. The no-sideways-scroll assertion above is the
   * guard on that arithmetic. */
  test("shows one column for the person and one for their history", async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Filtered to a company, so every row is somebody it employs and the
    // merged history cell is guaranteed a chip to draw. The seed has no
    // election edges and only one person with a `latestEmploymentStart`, so
    // the rest of that cell is covered by tests/components/explore/Table.test.ts
    // instead of here.
    await page.goto("/eksploruj/tabela?place=chain-company", {
      waitUntil: "load",
    });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });

    const headers = page.locator("thead th:visible");
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toHaveText(/Osoba/);
    await expect(headers.nth(1)).toHaveText(/Historia/);

    await expect(
      page
        .locator("tbody tr:first-child td:nth-child(2) .company-chip")
        .first(),
    ).toBeVisible();
  });

  test("keeps the filters one tap away, and says when they are on", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela?party=PiS", { waitUntil: "load" });

    // The count is the point: a folded panel that is quietly narrowing the
    // table would leave the reader with a short list and no reason for it.
    const toggle = page.getByRole("button", { name: /^Filtry/ });
    await expect(toggle).toBeVisible({ timeout: 60000 });
    await expect(toggle).toHaveText(/Filtry \(1\)/);

    // Folded to begin with, and the filters are there once it is tapped.
    // Exact: the autocomplete also renders a "Clear Partia" icon button, and
    // a loose match picks up both.
    const party = page.getByLabel("Partia", { exact: true });
    await expect(party).toBeHidden();
    await toggle.click();
    await expect(party).toBeVisible();
  });

  // Absence, which is what the reports asked for and what a screenshot states
  // only by omission. The bar counts how much of the base has been checked and
  // links to the screen where checking happens; a reader who is not signed in
  // can act on neither, and on a phone it took most of the space above the
  // first row. The signed-in half is here too, so that "hidden" cannot be
  // passed by a bar that stopped rendering for everybody.
  test("shows the progress bar only once signed in", async ({ page }) => {
    test.setTimeout(120000);
    const bar = page.getByTestId("explore-progress");

    await page.goto("/eksploruj/tabela", { waitUntil: "load" });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(bar).toHaveCount(0);

    await logIn(page, USERS.normal, "/eksploruj/tabela");
    await expect(bar).toBeVisible({ timeout: 60000 });
  });
});
