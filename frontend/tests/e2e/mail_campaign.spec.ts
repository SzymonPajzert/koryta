import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

function adminDb(): Firestore {
  const app =
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp();
  return getFirestore(app, "koryta-pl");
}

/** An account of its own per test, so a run never depends on what an earlier
 * one left in the emulator. */
async function account(
  stamp: number,
  name: string,
  options: { emailVerified: boolean; newsletter?: Record<string, boolean> },
) {
  const uid = `mail-${name}-${stamp}`;
  const email = `${uid}@example.com`;
  await getAuth().createUser({
    uid,
    email,
    emailVerified: options.emailVerified,
    password: "password123",
    displayName: `Czytelnik ${stamp}`,
  });
  if (options.newsletter) {
    await adminDb()
      .collection("users")
      .doc(uid)
      .set({ newsletter: options.newsletter });
  }
  return { uid, email, password: "password123" };
}

test.describe("Campaign mail", () => {
  test("the owner tests and sends a campaign, and the reader can leave the list", async ({
    page,
  }) => {
    // Signing in, a fresh audience per send, and the unsubscribe page.
    test.setTimeout(300_000);
    const stamp = Date.now();
    const db = adminDb();
    const reader = await account(stamp, "reader", {
      emailVerified: true,
      newsletter: { callsToAction: true },
    });
    // A test goes to the owner's own address, which has to be confirmed.
    await getAuth().updateUser("test-admin", { emailVerified: true });

    await logIn(page, USERS.admin, "/admin/mailing");
    await expect(
      page.locator(`[data-audience-row="${reader.uid}"]`),
    ).toBeVisible({
      timeout: 60_000,
    });

    // A new campaign starts as the pilot's draft; make it this run's own.
    await page.locator("[data-campaign-new]").click();
    const subject = `Kampania testowa ${stamp}`;
    await page.locator("[data-campaign-subject] input").fill(subject);
    await page.locator("[data-campaign-save]").click();
    await expect(page).toHaveURL(/kampania=/, { timeout: 30_000 });
    const campaignId = new URL(page.url()).searchParams.get("kampania")!;

    await page.locator("[data-campaign-test]").click();
    await expect(async () => {
      const tests = await db
        .collection("mail")
        .where("campaignTest", "==", campaignId)
        .get();
      expect(tests.docs).toHaveLength(1);
      const data = tests.docs[0]!.data();
      expect(data.to).toEqual([USERS.admin.email]);
      expect(data.message.subject).toBe(`[Test] ${subject}`);
    }).toPass({ timeout: 30_000 });

    // Send to the reader alone.
    const row = page.locator("tr", {
      has: page.locator(`[data-audience-row="${reader.uid}"]`),
    });
    await row.locator("input[type=checkbox]").check();
    await page.locator("[data-campaign-send]").click();
    await page.locator("[data-campaign-send-confirm]").click();

    let unsubscribeLink = "";
    await expect(async () => {
      const mail = await db
        .collection("mail")
        .doc(`campaign_${campaignId}_${reader.uid}`)
        .get();
      expect(mail.exists).toBe(true);
      const data = mail.data()!;
      expect(data.to).toEqual([reader.email]);
      expect(data.message.subject).toBe(subject);
      expect(data.headers["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
      const match = /(https?:\/\/\S+\/wypisz\?\S+)/.exec(data.message.text);
      expect(match).not.toBeNull();
      unsubscribeLink = match![1]!;
    }).toPass({ timeout: 30_000 });

    const campaign = await db.collection("mailCampaigns").doc(campaignId).get();
    expect(campaign.data()?.recipients).toEqual([reader.uid]);

    // The reader follows the link from their inbox: the page asks, and only
    // the button takes them off.
    const link = new URL(unsubscribeLink);
    await page.goto(`${link.pathname}${link.search}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("[data-unsubscribe-confirm]").click();
    await expect(page.locator("[data-unsubscribe-done]")).toBeVisible({
      timeout: 30_000,
    });

    const user = await db.collection("users").doc(reader.uid).get();
    expect(user.data()?.newsletter?.callsToAction).toBe(false);
    const after = await db.collection("mailCampaigns").doc(campaignId).get();
    expect(after.data()?.unsubscribed).toEqual([reader.uid]);
  });

  test("a signed-in reader is asked once whether they want mail", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const stamp = Date.now() + 1;
    const db = adminDb();
    const reader = await account(stamp, "asked", { emailVerified: true });

    await page.goto("/login?redirect=%2Fpomoc", {
      waitUntil: "domcontentloaded",
    });
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill(reader.email);
    await page.locator("input#password").fill(reader.password);
    await page.locator('button[type="submit"]').click({ force: true });
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });

    const prompt = page.locator("[data-mail-opt-in]");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await page.locator("[data-mail-opt-in-yes]").click();
    await expect(prompt).toBeHidden();

    await expect(async () => {
      const user = await db.collection("users").doc(reader.uid).get();
      expect(user.data()?.newsletter).toEqual({
        callsToAction: true,
        recentPeople: true,
      });
    }).toPass({ timeout: 30_000 });

    // Answered is answered: a reload does not ask again.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(prompt).toHaveCount(0);
  });
});
