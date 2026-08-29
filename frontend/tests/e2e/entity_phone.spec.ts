import { test, expect, type Page } from "@playwright/test";

/** What „na telefonie powiązania są cały czas bardzo wysokie" means as
 * something a test can hold: the height of one row of „Historia powiązań".
 *
 * Measured rather than screenshotted, because the number is the complaint. On
 * koryta.pl at 375x667 a row of Maciej Sulgan's five relations ran 121-229px -
 * a 253px content box, of which 56px went to the icon column and up to 98px to
 * the buttons, leaving the institution's name 99-197px to wrap across four
 * lines, plus a 42px block underneath holding a 200px duration bar clipped at
 * both ends by the row's own overflow. One or two relations were on screen when
 * the page opened.
 */
const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

/** Jan Kowalski, seeded as node 1: one dated employment at Orlen and one
 * undated connection to Anna Nowak, which is the two shapes a row comes in. */
const PERSON = "/osoba/jan-kowalski-1";
/** Danuta Obejmująca, whose one relation is an open-ended seat on the board of
 * the only seeded institution flagged `isPublic` - so her row is the one that
 * carries the „Instytucja publiczna" badge as well as a period. */
const BOARD_MEMBER = "/osoba/danuta-obejmujaca-sukdanuta";

/** The budget one row has to fit in.
 *
 * Between the two states of the seeded Orlen row: ~98px before this change
 * (22px of title, 20px of role, 42px of dates block, 8px of padding, 2px of
 * border, 4px of margin) and ~74px after, once the dates join the role on one
 * line and the second duration bar goes. Both numbers are computed from the
 * stylesheets rather than measured in a browser, so the midpoint is the honest
 * place to draw the line; if a first run comes in just over, measure before
 * moving it - the failure is as likely to be a row that grew as a budget that
 * was too tight.
 */
const MAX_ROW_HEIGHT = 86;

async function rowHeights(page: Page) {
  return await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="relations-history"] .history-row',
      ),
    ].map((row) => Math.round(row.getBoundingClientRect().height)),
  );
}

test.describe("a person's relations on a phone", () => {
  test.use({ viewport: PHONE });

  test("fits a relation into one screenful's worth of rows", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(PERSON, { waitUntil: "load" });

    const relations = page.getByTestId("relations-history");
    await expect(relations).toBeVisible({ timeout: 60_000 });
    await expect(relations).toContainText("Orlen", { timeout: 60_000 });

    const heights = await rowHeights(page);
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeLessThanOrEqual(MAX_ROW_HEIGHT);
    }

    // Nothing may hang off the side either - the row reclaims its width by
    // collapsing chrome, not by pushing the page out from under the viewport.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("keeps the dates, and drops only the bar that drew them", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(PERSON, { waitUntil: "load" });

    const relations = page.getByTestId("relations-history");
    await expect(relations).toBeVisible({ timeout: 60_000 });

    // The period is still on the row, as text beside the role.
    await expect(relations).toContainText("2023-04-01 - 2024-09-30", {
      timeout: 60_000,
    });
    await expect(
      relations.locator('[data-testid^="edge-period-"]'),
    ).toBeVisible();

    // Hidden by the stylesheet rather than dropped from the markup, so this
    // asks whether it is on screen, not whether it is in the document - the
    // same page above md still draws it.
    const bar = relations.locator(".relative-duration-wrapper");
    await expect(bar).toHaveCount(1);
    await expect(bar).toBeHidden();
  });

  test("shrinks the public-institution badge to its icon", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(BOARD_MEMBER, { waitUntil: "load" });

    const relations = page.getByTestId("relations-history");
    await expect(relations).toContainText("Wojewódzki Zakład Testowy", {
      timeout: 60_000,
    });

    const badge = relations.locator(".chip--compact");
    await expect(badge).toBeVisible();
    // The label is what costs ~100px of a ~160px text column; the icon and the
    // title attribute still say what it is.
    await expect(badge.getByText("Instytucja publiczna")).toBeHidden();
    await expect(badge).toHaveAttribute("title", /skarbu państwa/);
  });
});

/** The other half of the change: none of it may leak above md. */
test.describe("a person's relations on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("keeps the duration bar and the full badge", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(BOARD_MEMBER, { waitUntil: "load" });

    const relations = page.getByTestId("relations-history");
    await expect(relations).toContainText("Wojewódzki Zakład Testowy", {
      timeout: 60_000,
    });

    await expect(relations.locator(".relative-duration-wrapper")).toBeVisible();
    await expect(relations.getByText("Instytucja publiczna")).toBeVisible();
    // ...and the dates are stated once, under the bar. The copy that sits
    // beside the role on a phone is in the markup here too, switched off by
    // the same breakpoint the bar switches on at.
    await expect(relations).toContainText("2024-04-12 - obecnie");
    await expect(
      relations.locator('[data-testid^="edge-period-"]'),
    ).toBeHidden();
  });
});
