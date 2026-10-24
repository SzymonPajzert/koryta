import { test, expect } from "./test";
import { pageTag } from "./pageTags";
import { logIn, USERS } from "../e2e/helpers/auth";
import { expectFitsThePhone } from "./phoneWidth";

/** An association's komisja rewizyjna, named the way its register names it.
 *
 * Every supervisory seat is stored as "Rada Nadzorcza" - rejestr.io reports
 * them all as one connection type - so Związek Miast Polskich's page said its
 * komisja rewizyjna was a supervisory board. The organ the register lists
 * reaches the node as `supervisoryOrgan`, and `displayRole` names the seats
 * after it.
 *
 * WHY THE NODE IS INTERCEPTED, as in company-wikipedia.spec.ts. Giving the
 * seeded company the field would rename its seats in `instytucja-strona` and
 * every other shot of it, for a change none of them is about. The handler adds
 * the register's answer to the one response the card is drawn from, and leaves
 * the rest of the node as the seed has it.
 *
 * Only the card is photographed. „Zmiany na stanowisku” below it is named on
 * the server, from the seeded node, which the handler cannot reach - that half
 * is `tests/server/api/edges/successions.test.ts`.
 *
 * Signed in, for the reason the Wikipedia spec gives: it is what gets the
 * company fetched in the browser, where the handler can answer it.
 */

/** The seeded institution with a board history: four supervisory seats beside
 * a zarząd and two prokurents, which have to keep their names. */
const COMPANY_ID = "sukspolka";
const COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

test.describe(
  "Komisja rewizyjna stowarzyszenia",
  { tag: pageTag("[seoType]/[slug]") },
  () => {
    test("instytucja-komisja-rewizyjna", async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      // By path, as in company-wikipedia.spec.ts: a glob would also catch the
      // node's `/revisions`, which has no `node` to add the organ to.
      await page.route(
        (url) => url.pathname === `/api/nodes/${COMPANY_ID}`,
        async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          // What `/api/ingest/company` writes for a stowarzyszenie whose entry
          // lists a KOMISJA REWIZYJNA.
          body.node.legalForm = "STOWARZYSZENIE";
          body.node.supervisoryOrgan = "komisja_rewizyjna";
          await route.fulfill({ response, json: body });
        },
      );

      await logIn(page, USERS.normal, COMPANY_URL);

      const card = page.getByTestId("relations-history");
      await expect(card).toBeVisible({ timeout: 30_000 });
      // Only the handler gives the company its organ, so a run that drew the
      // seeded node fails here rather than banking four „Rada Nadzorcza” rows.
      await expect(card.getByText("Komisja Rewizyjna").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(card.getByText("Rada Nadzorcza")).toHaveCount(0);
      await expect(card.getByText("Zarząd").first()).toBeVisible();
      await expect(card.getByText("Prokurent").first()).toBeVisible();

      // Off the card: the mouse is left where the login button was, and a
      // button under it would be photographed in its hover state.
      await page.mouse.move(0, 0);
      // On a phone the card is taller than the window, so the shot scrolls and
      // the fixed app bar lands across its first row, the feedback launcher
      // across its last. Neither is part of the card: hidden, as in
      // ./home-cta.spec.ts, rather than masked into magenta blocks.
      await page.addStyleTag({
        content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
      });
      await page.evaluate(() => document.fonts.ready);
      await expect(card).toHaveScreenshot("instytucja-komisja-rewizyjna.png");

      await expectFitsThePhone(page, testInfo);
    });
  },
);
