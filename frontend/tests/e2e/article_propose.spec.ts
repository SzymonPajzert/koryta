import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** „Artykuł placeholder 3”, which no other spec opens. It has to be one
 * nobody else reads: a signed in reader is shown a page's newest revision, so
 * the proposals this spec files become what such a reader sees here. */
const ARTICLE_URL = "/artykul/artykul-placeholder-3-a3";

/** Open „Zaproponuj zmianę” from the pencil beside the title.
 *
 * Retried because the button is in the markup before Vue has attached its
 * listener, and a click in that window is silently dropped - the same race
 * `company_proposal_feedback` handles. */
async function openProposal(page: Page) {
  const pencil = page
    .getByTestId("article-propose-change")
    .getByRole("button", { name: "Zaproponuj zmianę" });
  await expect(pencil).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await pencil.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

test.describe("Correcting an article's title from its page", () => {
  test("a reader who is not signed in gets no pencil", async ({ page }) => {
    // Szymon, 2026-10-24: for signed in readers only.
    await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    // Not from the server's markup, which is where an ungated pencil would
    // be, and not once the app has mounted and the sign-in state has had its
    // moment either. `networkidle` never comes on this page: the Firestore
    // listeners keep a connection open.
    await expect(page.getByTestId("article-propose-change")).toHaveCount(0);
    await page.waitForFunction(() =>
      Boolean(
        (document.querySelector("#__nuxt") as { __vue_app__?: unknown } | null)
          ?.__vue_app__,
      ),
    );
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("article-propose-change")).toHaveCount(0);
  });

  test("a proposed title is previewed in place, and its link keeps the preview", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Unique per run: the emulator keeps every proposal an earlier run filed.
    const title = `Poprawiony tytuł artykułu ${Date.now()}`;

    await logIn(page, USERS.normal, ARTICLE_URL);
    const dialog = await openProposal(page);

    // The whole title, in a box that grows with it.
    const field = dialog.getByLabel("Tytuł");
    await expect(field).toHaveJSProperty("tagName", "TEXTAREA");
    await field.fill(title);
    await dialog
      .getByRole("button", { name: "Zaproponuj", exact: true })
      .click();

    // The page as the proposal would leave it, under the notice every page
    // gives a preview, with the reader's own proposals listed below.
    await expect(page).toHaveURL(/revisionId=/, { timeout: 30_000 });
    await expect(
      page.getByText("Wyświetlasz podgląd zaproponowanej zmiany"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("node-proposals")).toBeVisible({
      timeout: 30_000,
    });

    // The card links to the preview by the name the proposal gives the page,
    // and a full load of that address goes through the redirect to the page's
    // own one - which used to drop `?revisionId=`, and with it the preview.
    const revisionId = new URL(page.url()).searchParams.get("revisionId");
    const preview = page.getByTestId(`node-proposal-preview-${revisionId}`);
    const href = await preview.getAttribute("href");
    expect(href).toContain(`revisionId=${revisionId}`);
    await page.goto(href!);
    await expect(page).toHaveURL(
      new RegExp(`${ARTICLE_URL}\\?revisionId=${revisionId}`),
      { timeout: 30_000 },
    );
    await expect(
      page.getByText("Wyświetlasz podgląd zaproponowanej zmiany"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, {
      timeout: 30_000,
    });
  });

  test("an admin also gets the way to the article's revisions", async ({
    page,
  }) => {
    await logIn(page, USERS.admin, ARTICLE_URL);
    const link = page.getByTestId("admin-revisions-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", "/admin/rewizje/a3");
  });
});

test.describe("A redirect to a page's own address keeps the query", () => {
  // /admin/rewizje previews a proposal at its page's /entity/ url, and the
  // reader's list of proposals at the name the proposal gives it. Both end in a
  // redirect, which dropped `?revisionId=`.
  test("from an /entity/ url", async ({ request }) => {
    const response = await request.get("/entity/article/6?revisionId=abc", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toBe(
      "/artykul/sample-article-6?revisionId=abc",
    );
  });

  test("from an address with the wrong name in it", async ({ request }) => {
    const response = await request.get(
      "/artykul/stary-tytul-6?revisionId=abc",
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toBe(
      "/artykul/sample-article-6?revisionId=abc",
    );
  });
});
