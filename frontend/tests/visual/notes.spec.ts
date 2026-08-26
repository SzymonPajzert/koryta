import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** The notes section, which nothing else in this suite draws.
 *
 * `note/Editor.vue` renders under `v-if="user || otherSources.length > 0"`,
 * and the seed creates no notes at all - so every logged out capture in
 * pages.spec.ts omits it entirely, and restyling it from a raised card to a
 * plain section changed no baseline in the suite. Signing in is what puts it
 * on the page.
 *
 * One element rather than a full page: a person's page ends in a
 * force-directed graph that settles somewhere slightly different every run,
 * and a company's page carries one too.
 *
 * Both viewports get a shot from the same spec. The phone one is the point of
 * having it - the report that prompted the restyle was about how the section
 * sits among the cards on a phone.
 */

/** Everything that has to have arrived before a shot is worth taking. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test.describe("Notatki", () => {
  test("notatki-sekcja", async ({ page }) => {
    test.setTimeout(120_000);
    // Jan Kowalski, who the seed gives one note of each kind - a source with a
    // url, a correction and a gap - written by somebody other than the reader.
    // This is the section doing its job: other people's entries above the
    // prompt inviting one of your own, which is the arrangement the restyle
    // from a card to a plain section was judged against, and the state an
    // empty shot cannot show.
    await logIn(page, USERS.normal, "/entity/person/1");

    const notes = page.getByTestId("note-editor");
    await expect(notes).toBeVisible({ timeout: 30_000 });
    // By value, not by text: NoteSourceCard puts the entry in a v-textarea, so
    // what it says is the control's value and `getByText` - which reads text
    // content - matches nothing however well the note has rendered.
    //
    // The entries arrive with the note collection and the prompt is behind
    // `userNote`; waiting for the last of the three cards and then the prompt
    // covers both, so nothing is captured half filled.
    await expect(
      notes.getByRole("textbox", { name: "Czego tu brakuje?" }),
    ).toHaveValue("Brakuje kadencji w radzie miasta sprzed 2019 roku.", {
      timeout: 30_000,
    });
    await expect(
      notes.getByText("Wiesz więcej na temat tej osoby?"),
    ).toBeVisible({ timeout: 30_000 });
    await settled(page);

    await expect(notes).toHaveScreenshot("notatki-sekcja.png");
  });

  test("notatki-sekcja-pusta", async ({ page }) => {
    test.setTimeout(120_000);
    // Orlen, left without notes in the seed on purpose: the empty section is
    // what most entities show and it is a different shape - a heading, the
    // prompt and the three buttons, with no cards between them. The subject
    // line changes with the kind of entity too ("tej spółki", not "tej
    // osoby"), so this covers that as well.
    await logIn(page, USERS.normal, "/entity/place/2");

    const notes = page.getByTestId("note-editor");
    await expect(notes).toBeVisible({ timeout: 30_000 });
    await expect(
      notes.getByText("Wiesz więcej na temat tej spółki?"),
    ).toBeVisible({ timeout: 30_000 });
    await settled(page);

    await expect(notes).toHaveScreenshot("notatki-sekcja-pusta.png");
  });
});
