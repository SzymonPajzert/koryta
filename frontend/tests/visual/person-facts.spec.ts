import { test, expect } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** „Fakty z artykułów" on a person's page - the whole section, which nothing
 * in this suite drew.
 *
 * It is behind the auth gate (a signed out reader gets a blurred placeholder
 * and a count), so every logged out capture in pages.spec.ts omits it, and
 * pages.spec.ts photographs no person page in any case. That left the section
 * with no visual cover at all through a rework that gave every card three
 * verdict buttons, a vote chip, a filter row and a greyed-out second half.
 *
 * One element rather than the page: a person's page ends in a force-directed
 * canvas that settles differently every run, which is the same reason
 * notes.spec.ts and relation-sources.spec.ts scope to theirs.
 *
 * Both viewports. The cards are two-to-a-row on a desktop and stacked on a
 * phone, and the actions row is the part most at risk of overflowing the
 * narrow one.
 */

/** Anna Nowak, the only seeded person with facts of more than one kind - an
 * employment and a party membership. Two kinds is what puts the filter row on
 * the screen at all: it hides itself when everything is the same type, so a
 * person with one kind of fact would photograph the section without the
 * feature this shot is largely here for. */
const PERSON = "/entity/person/3";

test.describe("Fakty osoby", () => {
  test("fakty-osoby", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, PERSON);

    const facts = page.getByTestId("person-extractions");
    await expect(facts).toBeVisible({ timeout: 30_000 });

    // Both cards, by their own text. The count in the lead arrives with the
    // node and the cards arrive with /api/extractions, so waiting on the
    // second card is what separates "the section rendered" from "the facts
    // did" - the difference between a real baseline and a shot of a heading.
    // `exact`, because the seed words one fact as the other with "Drugi " in
    // front of it, and getByText matches a substring by default.
    await expect(
      facts.getByText("Fakt czekajacy na ocene recenzenta.", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      facts.getByText("Drugi fakt czekajacy na ocene recenzenta.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });

    // The filter row, which only exists because this person has two kinds.
    await expect(facts.getByTestId("person-extractions-filter")).toBeVisible({
      timeout: 10_000,
    });

    await page.evaluate(() => document.fonts.ready);
    await expect(facts).toHaveScreenshot("fakty-osoby.png");
  });
});
