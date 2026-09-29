import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { logIn, USERS } from "../e2e/helpers/auth";

/** „Fakty z artykułów" on a person's page - the whole section, which nothing
 * in this suite drew.
 *
 * It is behind the auth gate (a signed out reader gets a blurred placeholder
 * and a count), so every logged out capture in pages.spec.ts omits it, and
 * pages.spec.ts photographs no person page in any case. That left the section
 * with no visual cover at all through a rework that gave every fact three
 * verdict buttons, a vote chip, a filter row and a greyed-out second half, and
 * through the next one, which folded each fact into a line that opens.
 *
 * One element rather than the page: a person's page ends in a force-directed
 * canvas that settles differently every run, which is the same reason
 * notes.spec.ts and relation-sources.spec.ts scope to theirs.
 *
 * Both viewports, and both states of a line: closed, which is what a reader
 * meets, and open, where the quote, the verdicts and the note and relation
 * buttons share one row that is most at risk of overflowing a phone.
 */

/** Anna Nowak, the only seeded person with facts of more than one kind - an
 * employment and a party membership. Two kinds is what puts the filter row on
 * the screen at all: it hides itself when everything is the same type, so a
 * person with one kind of fact would photograph the section without the
 * feature this shot is largely here for. */
const PERSON = "/entity/person/3";

test.describe("Fakty osoby", { tag: pageTag("[seoType]/[slug]") }, () => {
  test("fakty-osoby", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, PERSON);

    const facts = page.getByTestId("person-extractions");
    await expect(facts).toBeVisible({ timeout: 30_000 });

    // Both lines, by their own text. The count in the lead arrives with the
    // node and the lines arrive with /api/extractions, so waiting on the
    // second one is what separates "the section rendered" from "the facts
    // did" - the difference between a real baseline and a shot of a heading.
    const lines = facts.getByTestId("person-fact");
    await expect(lines.filter({ hasText: "Spolka Nieoceniona" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(lines.filter({ hasText: "Partia Testowa" })).toBeVisible({
      timeout: 30_000,
    });

    // The filter row, which only exists because this person has two kinds.
    await expect(facts.getByTestId("person-extractions-filter")).toBeVisible({
      timeout: 10_000,
    });

    // Off the lines: the mouse is left where the login button was, and a line
    // under it would be photographed in its hover tint.
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(facts).toHaveScreenshot("fakty-osoby.png");
  });

  test("fakty-osoby-rozwiniete", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, PERSON);

    const facts = page.getByTestId("person-extractions");
    const job = facts
      .getByTestId("person-fact")
      .filter({ hasText: "Spolka Nieoceniona" });
    await expect(job).toBeVisible({ timeout: 30_000 });

    await job.locator("[data-row-toggle]").click();
    await expect(
      job.getByText("Fakt czekajacy na ocene recenzenta.", { exact: true }),
    ).toBeVisible();
    await expect(job.getByTestId("verdict-buttons")).toBeVisible();
    // The row opens under `v-expand-transition`, which holds the panel at a
    // whole number of pixels until Vue takes the transition's classes off -
    // see `readyForFullPage`, which waits for the same thing.
    await expect(
      page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
    ).toHaveCount(0);

    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(facts).toHaveScreenshot("fakty-osoby-rozwiniete.png");
  });
});
