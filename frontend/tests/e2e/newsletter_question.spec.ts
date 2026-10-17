import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { waitForLoginFormHydrated } from "./helpers/login";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The newsletter question put to a reader right after signing in or creating
 * an account (components/mail/NewsletterQuestion.vue), and the /profil card
 * that manages the answer. The corner card is in mail_campaign.spec.ts. */

/** The emulator's admin app, made on first use: a spec cannot count on
 * another one in the same worker having made it. */
function admin() {
  return getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
}

function adminDb(): Firestore {
  return getFirestore(admin(), "koryta-pl");
}

/** An account of its own per test, so a run never depends on what an earlier
 * one left in the emulator. */
async function account(
  name: string,
  newsletter?: { callsToAction: boolean; recentPeople: boolean },
) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const uid = `newsletter-${name}-${stamp}`;
  const email = `${uid}@example.com`;
  await getAuth(admin()).createUser({
    uid,
    email,
    emailVerified: true,
    password: "password123",
    displayName: `Czytelnik ${stamp}`,
  });
  if (newsletter) {
    await adminDb().collection("users").doc(uid).set({ newsletter });
  }
  return { uid, email, password: "password123" };
}

async function userDoc(uid: string) {
  return (await adminDb().collection("users").doc(uid).get()).data();
}

test.describe("Newsletter question", () => {
  test("a new account is asked on /login, and the yes is kept with where it was given", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/login?konto=nowe&redirect=%2Fo-nas", {
      waitUntil: "domcontentloaded",
    });
    await waitForLoginFormHydrated(page);
    const email = `newsletter-signup-${Date.now()}@example.com`;
    await page.locator("input#email").fill(email);
    await page.locator("input#password").fill("password123");
    await page.locator('button:has-text("Stwórz konto")').click();

    const question = page.locator("[data-newsletter-question]");
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(question).toContainText("Konto założone");
    await expect(question).toContainText(email);
    await question.locator("[data-newsletter-yes]").click();

    // The confirmation stays until the countdown takes the reader back: the
    // answer lands in the document before the save returns, which once took
    // the question - and this line with it - away under the click.
    const note = page.locator("[data-newsletter-note]");
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note).toContainText("gdy potwierdzisz adres");
    await page.waitForURL((url) => url.pathname === "/o-nas", {
      timeout: 30_000,
    });

    const { uid } = await getAuth(admin()).getUserByEmail(email);
    await expect(async () => {
      const doc = await userDoc(uid);
      expect(doc?.newsletter).toEqual({
        callsToAction: true,
        recentPeople: true,
      });
      expect(doc?.newsletterUpdated?.via).toBe("signup");
    }).toPass({ timeout: 30_000 });

    await page.goto("/profil", { waitUntil: "domcontentloaded" });
    const status = page.locator("[data-newsletter-status]");
    await expect(status).toContainText(email, { timeout: 30_000 });
    await expect(status).toContainText("gdy potwierdzisz ten adres");
    await expect(status).toContainText("przy zakładaniu konta");
  });

  test("the header's dialog asks after signing in, and a no is not asked again", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const reader = await account("dialog");

    const signInThroughTheHeader = async () => {
      await page.goto("/o-nas", { waitUntil: "domcontentloaded" });
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
      await dialog.locator("input#email").fill(reader.email);
      await dialog.locator("input#password").fill(reader.password);
      await dialog.locator('button[type="submit"]').click({ force: true });
    };

    await signInThroughTheHeader();
    const asked = page.locator("[data-login-newsletter]");
    // The dialog checks whether to ask before it shows the question.
    await expect(asked.locator("[data-newsletter-question]")).toBeVisible({
      timeout: 30_000,
    });
    await expect(asked).toContainText("Zalogowano jako");
    await asked.locator("[data-newsletter-no]").click();
    await expect(asked).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("[data-login-snackbar]")).toContainText(
      "nie wyślemy Ci newslettera",
    );

    await expect(async () => {
      const doc = await userDoc(reader.uid);
      expect(doc?.newsletter).toEqual({
        callsToAction: false,
        recentPeople: false,
      });
      expect(doc?.newsletterUpdated?.via).toBe("login");
    }).toPass({ timeout: 30_000 });

    // Signed out and in again: answered is answered.
    await page.locator(".v-app-bar button", { hasText: "Wyloguj" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });
    await signInThroughTheHeader();
    await expect(page.locator(".v-dialog")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("[data-newsletter-question]")).toHaveCount(0);
  });

  test("a switch on /profil changes one topic and records it", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const reader = await account("profil", {
      callsToAction: false,
      recentPeople: false,
    });
    await page.goto("/login?redirect=%2Fprofil", {
      waitUntil: "domcontentloaded",
    });
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill(reader.email);
    await page.locator("input#password").fill(reader.password);
    await page.locator('button[type="submit"]').click({ force: true });
    await page.waitForURL((url) => url.pathname === "/profil", {
      timeout: 30_000,
    });

    const topic = page.locator('[data-newsletter-topic="recentPeople"] input');
    await expect(topic).toBeEnabled({ timeout: 30_000 });
    await topic.check();

    await expect(async () => {
      const doc = await userDoc(reader.uid);
      expect(doc?.newsletter).toEqual({
        callsToAction: false,
        recentPeople: true,
      });
      expect(doc?.newsletterUpdated?.via).toBe("profil");
    }).toPass({ timeout: 30_000 });
    await expect(page.locator("[data-newsletter-status]")).toContainText(
      reader.email,
    );
  });
});
