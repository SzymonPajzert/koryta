import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { logIn, USERS } from "../e2e/helpers/auth";
import { expectFitsThePhone } from "./phoneWidth";

/** A company's Wikipedia article: the link on its page, and the field in
 * „Zaproponuj zmianę” that adds or corrects it.
 *
 * WHY NEITHER WAS IN ANY BASELINE. No seeded company has `wikipedia`, so the
 * card draws nothing for it on every page this suite photographs, and nothing
 * here opened the proposal dialog on a company at all - the new field shipped
 * without moving a pixel.
 *
 * WHY THE NODE IS INTERCEPTED. Giving a seeded company a link would redraw the
 * card in `instytucja-strona` and `propozycja-potwierdzenie` too, for a change
 * neither of them is about. The route handler adds the link to the one company
 * here, on the one response, and leaves the rest of the node as the seed has
 * it - the shot is of real components drawing a real page.
 *
 * Signed in as the ordinary user, because that is the only way to get the
 * company fetched in the browser, where the handler can answer it: `logIn`'s
 * `?redirect=` is a client-side navigation, and a plain `goto` would fetch the
 * node inside nitro. The card is a signed out reader's plus „Notatki”, which
 * any signed in reader gets; „Rewizje” and the jobs button are behind claims
 * this account does not hold.
 */

/** The seeded institution with a KRS number and a public-ownership chip, so the
 * row the link joins is as full as a real one. */
const COMPANY_ID = "sukspolka";
const COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

/** Shaped the way the pipelines write it - `extract_from_article` in
 * data/pipelines/src/scrapers/wiki/process_articles.py swaps spaces for
 * underscores and escapes nothing else. */
const WIKIPEDIA = "https://pl.wikipedia.org/wiki/Wojewódzki_Zakład_Testowy";

async function openWithWikipedia(page: Page) {
  // By path, not by glob: `**/api/nodes/sukspolka**` would also catch the
  // node's `/revisions`, which has no `node` to add the link to. The query
  // is left out of the match because a signed in fetch carries `?latest=`.
  await page.route(
    (url) => url.pathname === `/api/nodes/${COMPANY_ID}`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.node.wikipedia = WIKIPEDIA;
      await route.fulfill({ response, json: body });
    },
  );

  await logIn(page, USERS.normal, COMPANY_URL);

  const card = page.getByTestId("company-summary");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // Only the handler puts it there, so a run that drew the seeded node fails
  // here rather than banking a card without the link - which is exactly what
  // every other company looks like.
  await expect(card.getByTestId("company-wikipedia")).toBeVisible({
    timeout: 30_000,
  });
  return card;
}

test.describe("Wikipedia firmy", { tag: pageTag("[seoType]/[slug]") }, () => {
  test("instytucja-wikipedia", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const card = await openWithWikipedia(page);

    const link = card.getByTestId("company-wikipedia").getByRole("link");
    await expect(link).toHaveAttribute("href", WIKIPEDIA);
    await expect(link).toHaveText("Artykuł z Wikipedii");

    // Off the card: the mouse is left where the login button was, and a link
    // or button under it would be photographed in its hover state.
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(card).toHaveScreenshot("instytucja-wikipedia.png");

    await expectFitsThePhone(page, testInfo);
  });

  test("instytucja-zmiana-dialog", async ({ page }) => {
    test.setTimeout(120_000);
    // Tall enough for the whole form. At the projects' own heights the dialog
    // scrolls inside itself and the shot would stop somewhere around the
    // ownership select; the width, which is what the layout answers to, is
    // left as the project has it.
    const { width } = page.viewportSize()!;
    await page.setViewportSize({ width, height: 2000 });
    await openWithWikipedia(page);

    const button = page.getByRole("button", { name: "Zaproponuj zmianę" });
    const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
    // Retried as a whole: the button is in the markup before Vue has attached
    // its listener, and a click in that window is silently dropped - the race
    // propose-confirmation.spec.ts handles the same way.
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await button.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    // Filled from the node, which is the field's other half: a link already
    // on the page is what a reader comes here to correct.
    await expect(dialog.getByLabel("Link do Wikipedii")).toHaveValue(WIKIPEDIA);

    const content = dialog.locator(".v-overlay__content");
    // The dialog scales in, and a shot taken mid-transition catches it at
    // whatever size the frame landed on.
    await expect(
      page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
    ).toHaveCount(0);
    // All of the form in the frame, not the top of a scrolling box: if the
    // dialog outgrows the window above, this says so instead of the baseline
    // quietly losing its bottom half. Hidden elements are skipped for
    // „Treść”'s auto-grow sizer, an invisible copy of the textarea that is
    // always taller than its zero-height box.
    const scrollers = await content.evaluate((root) =>
      [root, ...Array.from(root.querySelectorAll("*"))]
        .filter((el) => {
          const { overflowY, visibility } = getComputedStyle(el);
          return (
            visibility !== "hidden" &&
            (overflowY === "auto" || overflowY === "scroll") &&
            el.scrollHeight > el.clientHeight + 1
          );
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}` +
            ` (${el.scrollHeight}px in ${el.clientHeight}px)`,
        ),
    );
    expect(scrollers, "the dialog scrolls inside itself").toEqual([]);

    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(content).toHaveScreenshot("instytucja-zmiana-dialog.png");
  });
});
