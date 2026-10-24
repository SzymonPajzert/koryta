import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  answerEntityPage,
  graphSettled,
  openInApp,
  shootWholePage,
} from "./entityPage";
import {
  PREZES_RELAY,
  companyWithBoard,
  companyWithoutBoard,
} from "./fixtures/companyPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A company's page as the redesign left it (approved 2026-10-24), whole, in
 * the two shapes it takes.
 *
 * With nobody known to hold a post today: the history of who did, and in
 * place of the two sections a page with a board has, the one quiet line that
 * says what is missing and counts the handovers it may not name (`k-absent`).
 * Signed out, the way most readers meet such a page.
 *
 * With a board: „Obecny skład” drawn once, in cards that carry the editor's
 * tools, the history without the board's posts, the owners and - for an
 * editor, who may add one - the empty line under „Spółki zależne”, then the
 * handovers in the row a person's page draws too: the newest five of a
 * function, then „Pokaż starsze”, and a day the board changed under one head.
 * Signed in as the admin, whose row of actions is the fullest; and once more
 * with „Pokaż starsze” opened.
 *
 * `instytucja-strona` in pages.spec.ts still photographs the seed's company,
 * which has a board and three handovers; neither of these could be made out
 * of it. ./fixtures/companyPage.ts says what they are, and ./entityPage.ts how
 * they are answered. */

const COMPANY = { tag: pageTag("[seoType]/[slug]") };

test("instytucja-bez-skladu", COMPANY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerEntityPage(page, companyWithoutBoard);
  await openInApp(page, companyWithoutBoard.url);

  // A name in capitals, one step down from a title in mixed case. Scoped to
  // the header: until the page has drawn, the h1 on screen is the one of the
  // page the navigation started from.
  const title = page
    .getByTestId("company-summary")
    .getByRole("heading", { level: 1 });
  await expect(title).toHaveText(
    "ZAKŁAD GOSPODARKI ODPADAMI PRZYKŁADOWO SP. Z O.O.",
    { timeout: 30_000 },
  );
  await expect(title).toHaveClass(/k-title--caps/);
  await expect(page.getByTestId("company-facts")).toContainText(
    "Lokalizacja: Gmina Przykładowo",
  );

  // What the register does not tell us, in one line under the history, and
  // neither of the sections it stands for.
  const absent = page.getByTestId("company-absent");
  await expect(absent).toContainText("Nie znamy obecnego składu.", {
    timeout: 30_000,
  });
  await expect(absent).toContainText("Pominęliśmy 2 zmiany na stanowiskach");
  await expect(page.getByTestId("successions-current")).toHaveCount(0);
  await expect(page.getByTestId("successions-relay")).toHaveCount(0);

  // Everybody who ever held a post here, in one box: nothing is held today,
  // so there is one group and no head over it.
  const history = page.getByTestId("relations-history");
  await expect(history.locator(".history-row")).toHaveCount(4);
  await expect(history.locator(".k-group-head")).toHaveCount(0);
  await expect(page.getByTestId("history-caption")).toHaveText(
    "4 osoby · wpisy od 2014",
  );

  // The seat, as its one owner; and no „Spółki zależne” at all for a reader
  // who could not add one.
  await expect(
    page.getByRole("heading", { name: "Właściciele" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Spółki zależne" }),
  ).toHaveCount(0);

  await graphSettled(page, testInfo);
  await shootWholePage(page, "instytucja-bez-skladu.png");

  await expectFitsThePhone(page, testInfo);
});

/** The company with a board, signed in as the admin, with every part of it
 * drawn. */
async function openWithBoard(page: Page, testInfo: TestInfo) {
  await freezeClock(page);
  await answerEntityPage(page, companyWithBoard);
  await logIn(page, USERS.admin, companyWithBoard.url);

  await expect(
    page.getByTestId("company-summary").getByRole("heading", { level: 1 }),
  ).toHaveText(
    "Przedsiębiorstwo Wodociągów i Kanalizacji Przykładowo sp. z o.o.",
    { timeout: 30_000 },
  );
  await expect(
    page.getByTestId("company-wikipedia").getByRole("link"),
  ).toHaveText("Wikipedia");
  // The admin's tools, on their own line under the reader's actions.
  await expect(page.getByTestId("admin-revisions-link")).toBeVisible();
  await expect(page.getByTestId("job-request-open")).toBeVisible();

  // Today's board, drawn once, each card with the tools its history row had.
  const board = page.getByTestId("successions-current");
  await expect(board.locator('[data-testid^="current-post-"]')).toHaveCount(4, {
    timeout: 30_000,
  });
  await expect(
    board
      .getByTestId("current-post-vispwikp8")
      .getByTestId("edge-edit-vispwikp8"),
  ).toBeVisible();

  // ...so the history holds the rest: the one post held today that is no
  // card - a term entered ahead - and the nine that ended.
  const history = page.getByTestId("relations-history");
  await expect(history.getByTestId("history-box-current")).toContainText(
    "Natalia Testowa",
  );
  await expect(
    history.getByTestId("history-box-ended").locator(".history-row"),
  ).toHaveCount(9);
  await expect(history).not.toContainText("Halina Przykładowa");

  // Owners counted beside their head - the gmina's seat and its stake are one
  // owner - and no subsidiaries, which an editor is told in a line rather
  // than left a bare head and „Dodaj”.
  await expect(page.getByText("2 podmioty")).toBeVisible();
  await expect(page.getByTestId("connections-empty")).toHaveText(
    "Nie znamy spółek zależnych.",
  );

  const relay = page.getByTestId("successions-relay");
  await expect(page.getByTestId("successions-count")).toHaveText(
    "9 zmian w 2 funkcjach",
  );
  // Five of the presidents' seven, and the board's day as one card.
  await expect(relay.getByTestId("succession-batch")).toHaveCount(6);
  await expect(
    relay.getByTestId(`succession-older-${PREZES_RELAY}`),
  ).toHaveText("Pokaż starsze (2)");
  await expect(relay.getByTestId("batch-count")).toHaveText(
    "2 zmiany tego dnia",
  );
  await expect(relay.getByTestId("batch-parties")).toHaveText(
    "wśród ustępujących: 2 × PiS",
  );
  await expect(relay.getByTestId("handover-party-change")).toHaveCount(3);

  // What only a signed in reader has under the graph.
  await expect(page.getByTestId("note-editor")).toContainText(
    "Wiesz więcej na temat tej spółki?",
    { timeout: 30_000 },
  );
  await expect(page.getByText("Brak komentarzy.")).toBeVisible({
    timeout: 30_000,
  });

  await graphSettled(page, testInfo);
  return relay;
}

test("instytucja-sklad", COMPANY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openWithBoard(page, testInfo);

  await shootWholePage(page, "instytucja-sklad.png");

  await expectFitsThePhone(page, testInfo);
});

test("instytucja-sklad-starsze", COMPANY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const relay = await openWithBoard(page, testInfo);

  // Opened in place, and the button gone with it.
  const older = relay.getByTestId(`succession-older-${PREZES_RELAY}`);
  await older.click();
  await expect(older).toHaveCount(0);
  await expect(relay.getByTestId("succession-batch")).toHaveCount(8);

  // The relay alone, which on a phone is taller than the window: the fixed
  // app bar would come out across whichever part of it the shot scrolled to.
  await page.addStyleTag({
    content: ".v-app-bar { visibility: hidden !important; }",
  });
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(relay).toHaveScreenshot("instytucja-sklad-starsze.png");

  await expectFitsThePhone(page, testInfo);
});
