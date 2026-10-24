import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { pageTag } from "./pageTags";
import { freezeClock } from "./clock";
import { readyForFullPage } from "./fullPage";
import {
  ARTICLE_URL,
  PROPOSED_TITLE,
  REVISION_ID,
  myProposals,
  noProposals,
  proposedRevision,
} from "./fixtures/articleProposal";

/** „Zaproponuj zmianę” on an article: the pencil beside the title, which
 * Szymon picked on 2026-10-24 out of three rendered layouts, for signed in
 * readers only; the dialog, whose title box shows the whole title; the page
 * after a proposal; and the old card an article opened by id still gets.
 *
 * Each capture is of an element rather than the page: the article page draws
 * a force-directed graph further down, which settles somewhere slightly
 * different on every run.
 *
 * As admin on the article page, because that is the crowded header - the
 * pencil and the way to the revisions both. */

const ARTICLE_PAGE = { tag: pageTag("[seoType]/[slug]") };

/** Answer the proposal endpoints from the fixtures, with the reader's list of
 * proposals empty until the dialog has "filed" one. */
async function stubProposals(page: Page) {
  let filed = false;
  await page.route("**/api/revisions/mine**", (route) =>
    route.fulfill({ json: filed ? myProposals : noProposals }),
  );
  await page.route("**/api/revisions/create", (route) => {
    filed = true;
    return route.fulfill({
      json: { id: REVISION_ID, node_id: "a4", duplicate: false },
    });
  });
  await page.route(`**/api/revisions/${REVISION_ID}`, (route) =>
    route.fulfill({ json: proposedRevision }),
  );
}

async function openArticle(page: Page) {
  await freezeClock(page);
  await stubProposals(page);
  await logIn(page, USERS.admin, ARTICLE_URL);
  await expect(page.getByTestId("article-propose-change")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("admin-revisions-link")).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

/** Retried because the pencil is in the markup before Vue has attached its
 * listener, and a click in that window is silently dropped. */
async function openDialog(page: Page) {
  const pencil = page
    .getByTestId("article-propose-change")
    .getByRole("button", { name: "Zaproponuj zmianę" });
  const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await pencil.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  // The pencil's tooltip, opened by the hover the click left behind.
  await page.mouse.move(0, 0);
  return dialog;
}

test("artykul-olowek", ARTICLE_PAGE, async ({ page }) => {
  test.setTimeout(120_000);
  await openArticle(page);

  await expect(page.getByTestId("article-head")).toHaveScreenshot(
    "artykul-olowek.png",
  );
});

test("artykul-okno-zmiany", ARTICLE_PAGE, async ({ page }) => {
  test.setTimeout(120_000);
  await openArticle(page);
  const dialog = await openDialog(page);

  // A title as long as a real one, which is what the box grows for.
  await dialog.getByLabel("Tytuł").fill(PROPOSED_TITLE);

  await expect(dialog.locator(".v-card").first()).toHaveScreenshot(
    "artykul-okno-zmiany.png",
  );
});

test("artykul-po-propozycji", ARTICLE_PAGE, async ({ page }) => {
  test.setTimeout(120_000);
  await openArticle(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel("Tytuł").fill(PROPOSED_TITLE);
  await dialog.getByRole("button", { name: "Zaproponuj", exact: true }).click();

  // The preview the dialog sends the reader to, and their list of proposals.
  await expect(page).toHaveURL(new RegExp(`revisionId=${REVISION_ID}`), {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    PROPOSED_TITLE,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("node-proposals")).toBeVisible({
    timeout: 30_000,
  });
  // The dialog fades out over the page it just changed.
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.mouse.move(0, 0);
  // A full-page shot, so the feedback launcher goes: it is drawn once, over
  // whatever sits at the bottom of the first window - on a phone, the card.
  await readyForFullPage(page);

  // From the preview notice to the end of the card: everything a proposal
  // changes at the top of the page.
  const clip = await page.evaluate(() => {
    const notice = [...document.querySelectorAll(".v-alert")].find((alert) =>
      alert.textContent.includes("Wyświetlasz podgląd"),
    );
    const card = document.querySelector('[data-testid="node-proposals"]');
    if (!notice || !card) throw new Error("no preview notice or no card");
    const top = notice.getBoundingClientRect();
    const bottom = card.getBoundingClientRect();
    return {
      x: Math.floor(bottom.left),
      y: Math.floor(top.top + window.scrollY),
      width: Math.ceil(bottom.width),
      height: Math.ceil(bottom.bottom - top.top),
    };
  });
  await expect(page).toHaveScreenshot("artykul-po-propozycji.png", {
    clip,
    fullPage: true,
  });
});

test(
  "artykul-szkic-olowek",
  { tag: pageTag("entity/[destination]/[id]") },
  async ({ page }) => {
    test.setTimeout(120_000);
    // „Not approved article” - a draft, which /admin/rewizje links to by id
    // and which so stays on the old card, as do the articles stored without a
    // name.
    await logIn(page, USERS.normal, "/entity/article/7");

    const card = page.getByTestId("entity-article-card");
    await expect(card.getByTestId("article-propose-change")).toBeVisible({
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);

    await expect(card).toHaveScreenshot("artykul-szkic-olowek.png");
  },
);
