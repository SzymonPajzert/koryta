import { expect, type Page } from "@playwright/test";
import { test } from "./test";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** The newsletter for readers without an account: the form under the call to
 * action on the home page, the page its confirmation mail links to, and
 * /wypisz for such a reader. Signed out, as such a reader always is.
 *
 * The confirm and unsubscribe answers are given here rather than by the
 * server, which would refuse a token it never issued - the same as
 * wypisz.spec.ts. The address left in the form is the same on every run: the
 * form says the same thing whatever the server made of it. */

const HOME = { tag: pageTag("index") };
const CONFIRM = { tag: pageTag("newsletter/potwierdz") };
const WYPISZ = { tag: pageTag("wypisz") };

const CONFIRM_LINK = "/newsletter/potwierdz?s=9f2c41&t=token";
const UNSUBSCRIBE_LINK = "/wypisz?u=sub_9f2c41&t=token&k=callsToAction";

async function homeForm(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const form = page.locator("[data-newsletter-signup]");
  await expect(form).toBeVisible({ timeout: 30_000 });
  // Typed again until Vuetify marks the field filled, which only the hydrated
  // component does. Before that a fill reaches the DOM alone, and a click on
  // the button is the browser's own submit, which reloads the page.
  const field = form.locator("[data-newsletter-signup-email]");
  const input = field.locator("input");
  await expect(async () => {
    await input.fill("x");
    await expect(field.locator(".v-field")).toHaveClass(/v-field--dirty/, {
      timeout: 500,
    });
  }).toPass({ timeout: 30_000 });
  await input.fill("");
  // Left, so the picture is of the field at rest rather than focused.
  await input.blur();
  // The feedback button floats over whatever is at the bottom right.
  await page.addStyleTag({
    content: ".feedback-fab { visibility: hidden !important; }",
  });
  await form.scrollIntoViewIfNeeded();
  return form;
}

function answerConfirm(page: Page, outcome: "confirmed" | "invalid") {
  return page.route("**/api/newsletter/confirm", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { outcome } })
      : route.fallback(),
  );
}

test("newsletter-strona-glowna", HOME, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const form = await homeForm(page);
  await expect(form).toHaveScreenshot("newsletter-strona-glowna.png");
  await expectFitsThePhone(page, testInfo);
});

test("newsletter-strona-glowna-literowka", HOME, async ({ page }) => {
  test.setTimeout(120_000);
  const form = await homeForm(page);
  await form
    .locator("[data-newsletter-signup-email] input")
    .fill("jan.kowalski");
  await form.locator("[data-newsletter-signup-submit]").click();
  await expect(form.locator("[role=alert]")).toBeVisible();
  // The pointer is moved off the button and its ripple let fade, so the
  // picture is of the button at rest rather than of a moment in the click.
  await page.mouse.move(0, 0);
  await expect(form.locator(".v-ripple__animation")).toHaveCount(0);
  await expect(form).toHaveScreenshot("newsletter-strona-glowna-literowka.png");
});

test("newsletter-strona-glowna-wyslano", HOME, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const form = await homeForm(page);
  const who = testInfo.project.name.replace("visual-", "");
  await form
    .locator("[data-newsletter-signup-email] input")
    .fill(`czytelniczka.${who}@example.com`);
  await form.locator("[data-newsletter-signup-submit]").click();
  await expect(form.locator("[data-newsletter-signup-done]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(form).toHaveScreenshot("newsletter-strona-glowna-wyslano.png");
});

test("newsletter-potwierdz", CONFIRM, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(CONFIRM_LINK, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-confirm-button]")).toBeVisible({
    timeout: 30_000,
  });
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("newsletter-potwierdz.png", {
    fullPage: true,
  });
  await expectFitsThePhone(page, testInfo);
});

test("newsletter-potwierdz-gotowe", CONFIRM, async ({ page }) => {
  test.setTimeout(120_000);
  await answerConfirm(page, "confirmed");
  await page.goto(CONFIRM_LINK, { waitUntil: "domcontentloaded" });
  await page.locator("[data-confirm-button]").click();
  await expect(page.locator("[data-confirm-done]")).toBeVisible({
    timeout: 30_000,
  });
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("newsletter-potwierdz-gotowe.png", {
    fullPage: true,
  });
});

test("newsletter-potwierdz-niewazny", CONFIRM, async ({ page }) => {
  test.setTimeout(120_000);
  await answerConfirm(page, "invalid");
  await page.goto(CONFIRM_LINK, { waitUntil: "domcontentloaded" });
  await page.locator("[data-confirm-button]").click();
  await expect(page.locator("[data-confirm-invalid]")).toBeVisible({
    timeout: 30_000,
  });
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("newsletter-potwierdz-niewazny.png", {
    fullPage: true,
  });
});

test("wypisz-bez-konta", WYPISZ, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(UNSUBSCRIBE_LINK, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-unsubscribe-confirm]")).toBeVisible({
    timeout: 30_000,
  });
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wypisz-bez-konta.png", {
    fullPage: true,
  });
});

test("wypisz-bez-konta-gotowe", WYPISZ, async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/mail/unsubscribe", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { outcome: "unsubscribed", topic: "callsToAction" },
        })
      : route.fallback(),
  );
  await page.goto(UNSUBSCRIBE_LINK, { waitUntil: "domcontentloaded" });
  await page.locator("[data-unsubscribe-confirm]").click();
  await expect(page.locator("[data-unsubscribe-done]")).toBeVisible({
    timeout: 30_000,
  });
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("wypisz-bez-konta-gotowe.png", {
    fullPage: true,
  });
});
