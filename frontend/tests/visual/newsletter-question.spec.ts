import { expect, type Page, type TestInfo } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { test } from "./test";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";
import { waitForLoginFormHydrated } from "../e2e/helpers/login";

/** The newsletter question (components/mail/NewsletterQuestion.vue) where it
 * is put to a reader: on /login right after creating an account or signing
 * in, in the sign-in dialog the header opens, and in the corner card a later
 * visit gets; then the /profil card that manages the answer.
 *
 * Every account here is made for its project, with a fixed address and name,
 * and made again on every run, so the question is always due and the
 * addresses in the pictures never change. The day of the last change on
 * /profil comes from the server's clock and is masked. */

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const LOGIN = { tag: pageTag("login") };
const PROFIL = { tag: pageTag("profil") };

function admin() {
  return getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
}

/** `anna.desktop@example.com` and the like: one address per project, since
 * both projects share an emulator. */
const address = (name: string, testInfo: TestInfo) =>
  `${name}.${testInfo.project.name.replace("visual-", "")}@example.com`;

/** Removes whatever an earlier run left under this address. */
async function forget(email: string) {
  const auth = getAuth(admin());
  try {
    const { uid } = await auth.getUserByEmail(email);
    await auth.deleteUser(uid);
    await getFirestore(admin(), "koryta-pl")
      .collection("users")
      .doc(uid)
      .delete();
  } catch {
    // Nobody has it yet.
  }
}

/** A confirmed account that has never answered the question. */
async function freshAccount(email: string, displayName: string) {
  await forget(email);
  await getAuth(admin()).createUser({
    email,
    emailVerified: true,
    password: "password123",
    displayName,
  });
  return { email, password: "password123" };
}

async function register(page: Page, email: string) {
  await forget(email);
  await page.goto("/login?konto=nowe", { waitUntil: "domcontentloaded" });
  await waitForLoginFormHydrated(page);
  await page.locator("input#email").fill(email);
  await page.locator("input#password").fill("password123");
  await page.locator('button:has-text("Stwórz konto")').click();
  await expect(page.locator("[data-newsletter-question]")).toBeVisible({
    timeout: 30_000,
  });
}

async function signInOnLoginPage(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await waitForLoginFormHydrated(page);
  await page.locator("input#email").fill(user.email);
  await page.locator("input#password").fill(user.password);
  await page.locator('button[type="submit"]').click({ force: true });
  await expect(page.locator("[data-newsletter-question]")).toBeVisible({
    timeout: 30_000,
  });
}

async function signInThroughTheHeader(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto("/o-nas", { waitUntil: "domcontentloaded" });
  // Worded on a desktop, an icon on a phone, with the words still in it.
  // Clicked again until the dialog opens: a click before the header has
  // hydrated lands on a button with no listener yet.
  const dialog = page.locator(".v-dialog");
  await expect(async () => {
    await page
      .locator(".v-app-bar button")
      .filter({ has: page.locator("span", { hasText: "Zaloguj się" }) })
      .first()
      .click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await waitForLoginFormHydrated(dialog);
  await dialog.locator("input#email").fill(user.email);
  await dialog.locator("input#password").fill(user.password);
  await dialog.locator('button[type="submit"]').click({ force: true });
}

/** The /profil Newsletter card, without the day of the last change. */
async function expectProfileCard(page: Page, name: string) {
  await page.goto("/profil", { waitUntil: "domcontentloaded" });
  const card = page.locator("[data-newsletter-card]");
  await expect(card.locator("[data-newsletter-status]")).toBeVisible({
    timeout: 30_000,
  });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveScreenshot(name, {
    mask: [card.locator(".newsletter-status__when")],
  });
}

test("newsletter-po-rejestracji", LOGIN, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await register(page, address("nowe-konto", testInfo));

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("newsletter-po-rejestracji.png", {
    fullPage: true,
  });
  await expectFitsThePhone(page, testInfo);

  // The yes, and the greeting that says what was saved. The countdown's
  // number moves every second, so its button is masked.
  await page.locator("[data-newsletter-yes]").click();
  await expect(page.locator("[data-newsletter-note]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveScreenshot("newsletter-zapisano.png", {
    fullPage: true,
    mask: [page.locator("button", { hasText: "Wróć do przeglądania" })],
  });
});

test("newsletter-po-zalogowaniu", LOGIN, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const user = await freshAccount(address("anna", testInfo), "Anna Nowak");
  await signInOnLoginPage(page, user);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("newsletter-po-zalogowaniu.png", {
    fullPage: true,
  });
  await expectFitsThePhone(page, testInfo);
});

test("newsletter-w-okienku-logowania", PROFIL, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const user = await freshAccount(address("jan", testInfo), "Jan Kowalski");
  await signInThroughTheHeader(page, user);
  const asked = page.locator("[data-login-newsletter]");
  // The dialog checks whether to ask before it shows the question.
  await expect(asked.locator("[data-newsletter-question]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(asked).toHaveScreenshot("newsletter-w-okienku-logowania.png");

  await asked.locator("[data-newsletter-yes]").click();
  await expect(page.locator("[data-login-snackbar]")).toBeVisible({
    timeout: 30_000,
  });
  await expectProfileCard(page, "newsletter-profil-zapisany.png");
});

test(
  "newsletter-profil-niepotwierdzony",
  PROFIL,
  async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await register(page, address("niepotwierdzony", testInfo));
    await page.locator("[data-newsletter-yes]").click();
    await expect(page.locator("[data-newsletter-note]")).toBeVisible({
      timeout: 30_000,
    });
    await expectProfileCard(page, "newsletter-profil-niepotwierdzony.png");
  },
);

test("newsletter-w-rogu", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const user = await freshAccount(address("ola", testInfo), "Ola Wiśniewska");
  await signInOnLoginPage(page, user);
  // Leaves without answering; the next page asks in the corner.
  await page.goto("/o-nas", { waitUntil: "domcontentloaded" });
  const card = page.locator("[data-mail-opt-in]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveScreenshot("newsletter-w-rogu.png");
});
