import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** The institution card in the state nothing else photographs: right after
 * "Zaproponuj zmianę" has been sent, with the confirmation on it.
 *
 * WHY IT NEEDED ITS OWN SHOT. The confirmation is behind
 * `v-if="submittedRevisionId"`, which is only ever set by the dialog's
 * `@submitted` in the same page session - so every baseline in the suite loads
 * a page where the alert is not in the DOM at all, and the alert shipped broken
 * for as long as it did without moving a single pixel of any of them. It sat on
 * the buttons' row and grew into the ~100px left of it, breaking "Zaproponowano
 * zmianę" a few characters at a time and stretching the card around a column of
 * text.
 *
 * WHY THE ENDPOINT IS STUBBED. `/api/revisions/create` writes, and the emulator
 * keeps what it writes: a real send would leave a proposal behind, which the
 * "Twoje propozycje zmian do tej strony" card below then renders differently on
 * the next run. The card under test only needs the response, so the response is
 * all this fakes - the shot is of real components, in the real page, with a
 * fixed revision id. What happens on the server when a proposal is really filed
 * is `e2e/company_proposal_feedback.spec.ts`, and it belongs there.
 *
 * As admin, because that is the crowded version of the row - "Notatki",
 * "Rewizje" and "Zaproponuj zmianę" - and how little room is left over is the
 * whole of what went wrong.
 *
 * THE DESKTOP SHOT IS THE GUARD; THE PHONE ONE IS DOCUMENTATION. Measured by
 * putting `w-100` back and running both: desktop fails, phone passes. At 375px
 * the three buttons already use up the row, so there is no leftover for a
 * zero-basis alert to be squeezed into and it wraps on its own - the bug never
 * reached a phone. The phone baseline is kept anyway, because the alert is two
 * lines there and that is a layout worth having a picture of, but do not read a
 * green phone run as this bug being covered.
 */

/** The seeded institution with a KRS number and a public-ownership chip, so the
 * row above the buttons is as full as a real one. */
const COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

/** Fixed, so the preview link in the shot is the same string every run. */
const REVISION_ID = "wizualna-rewizja";

/** Send a proposal without filing one, and wait for the card to say so. */
async function proposeWithStubbedServer(page: Page) {
  await page.route("**/api/revisions/create", (route) =>
    route.fulfill({
      json: { id: REVISION_ID, node_id: "sukspolka", duplicate: false },
    }),
  );

  await logIn(page, USERS.admin, COMPANY_URL);

  const button = page.getByRole("button", { name: "Zaproponuj zmianę" });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
  // Retried as a whole: the button is in the markup before Vue has attached its
  // listener, and a click in that window is silently dropped - the same race
  // `revisions_edit` and `company_proposal_feedback` handle.
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await dialog
    .getByLabel("Treść (opcjonalnie)")
    .fill("Zmiana z testu wizualnego");
  await dialog.getByRole("button", { name: "Zaproponuj", exact: true }).click();

  await expect(page.getByTestId("propose-confirmation")).toBeVisible({
    timeout: 30_000,
  });
  // The dialog fades out over the card it just changed, so a shot taken now
  // would catch a grey scrim at whatever opacity the frame landed on.
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
}

test("propozycja-potwierdzenie", async ({ page }) => {
  test.setTimeout(120_000);
  await proposeWithStubbedServer(page);

  const card = page.getByTestId("company-summary");
  const alert = page.getByTestId("propose-confirmation");

  // Asserted from the DOM as well as photographed. A baseline says the card
  // changed; these two say what was wrong with it, and they say it at both
  // viewports without a second reference image to keep. The alert is a flex
  // item in the card's header row, and the bug was entirely about where that
  // row put it.
  const cardBox = await card.boundingBox();
  const alertBox = await alert.boundingBox();
  const buttonBox = await page
    .getByRole("button", { name: "Zaproponuj zmianę" })
    .boundingBox();
  expect(cardBox && alertBox && buttonBox).toBeTruthy();

  // Its own line, under the buttons rather than beside them.
  expect(alertBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height);
  // And the whole of it: the card's width less its 16px padding either side.
  expect(alertBox!.width).toBeGreaterThan(cardBox!.width - 48);

  await expect(card).toHaveScreenshot("propozycja-potwierdzenie.png");
});
