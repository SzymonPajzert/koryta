import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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

/** A contributor with a confirmed address, and a suggestion of theirs awaiting
 * review.
 *
 * The seeded `user@koryta.pl` cannot stand in for this: nothing verifies it,
 * and an unverified address is one the site refuses to write to.
 */
async function seedPendingRevision(stamp: number) {
  const db = adminDb();
  const uid = `mail-author-${stamp}`;
  const email = `mail-author-${stamp}@example.com`;
  const nodeId = `mail-node-${stamp}`;
  const revisionId = `mail-rev-${stamp}`;
  const name = `Testowa Osoba ${stamp}`;

  await getAuth().createUser({
    uid,
    email,
    emailVerified: true,
    password: "password123",
  });

  await db
    .collection("nodes")
    .doc(nodeId)
    .set({ name, type: "person", published: false });
  await db
    .collection("revisions")
    .doc(revisionId)
    .set({
      node_id: nodeId,
      collection: "nodes",
      data: { name, type: "person", content: `Propozycja ${stamp}` },
      update_time: Timestamp.now(),
      update_user: uid,
      status: "pending",
    });

  return { db, uid, email, nodeId, revisionId, name };
}

/** The approve button for the seeded revision on the entry's page.
 *
 * Deciding happens in the history list above the comparison table, inside the
 * revision's row - which opens by itself, being the newest one still waiting.
 * `getByTestId` is strict, so this also pins that the table's column headers no
 * longer carry a second button with the same id.
 */
async function approveButton(page: Page, revisionId: string) {
  const row = page.locator(`[data-revision-row="${revisionId}"]`);
  await expect(row.locator("[data-row-panel]")).toBeVisible({
    timeout: 30_000,
  });
  const approve = page.getByTestId(`approve-${revisionId}`);
  await expect(approve).toBeVisible();
  return approve;
}

test.describe("Mail about a reviewed revision", () => {
  test("approving queues a message to the contributor", async ({ page }) => {
    // Registering, logging in and waiting for onRevisionWritten all sit in
    // front of the assertion.
    test.setTimeout(240_000);
    const stamp = Date.now();
    const { db, email, nodeId, revisionId, name } =
      await seedPendingRevision(stamp);

    await logIn(page, USERS.admin, `/admin/rewizje/${nodeId}`);

    await page.goto(`/admin/rewizje/${nodeId}`, {
      waitUntil: "domcontentloaded",
    });
    const approve = await approveButton(page, revisionId);
    await approve.click();

    // The write to `mail` happens after the approval is committed and the
    // handler has answered, so it can land a moment after the button settles.
    await expect(async () => {
      const doc = await db
        .collection("mail")
        .doc(`revisionApproved_${revisionId}`)
        .get();
      expect(doc.exists).toBe(true);
      const data = doc.data()!;
      expect(data.to).toEqual([email]);
      expect(data.message.subject).toContain(name);
      // Approving does not publish, and the message has to say so or the
      // contributor goes looking for a page they still cannot open.
      expect(data.message.text).toContain("widoczna publicznie");
    }).toPass({ timeout: 30_000 });
  });

  test("nothing is queued for an address nobody confirmed", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const stamp = Date.now() + 1;
    const { db, uid, nodeId, revisionId } = await seedPendingRevision(stamp);
    await getAuth().updateUser(uid, { emailVerified: false });

    await logIn(page, USERS.admin, `/admin/rewizje/${nodeId}`);
    await page.goto(`/admin/rewizje/${nodeId}`, {
      waitUntil: "domcontentloaded",
    });
    const approve = await approveButton(page, revisionId);
    await approve.click();

    // The approval itself must still go through - the mail is a courtesy on
    // top of it, not a precondition.
    await expect(async () => {
      const revision = await db.collection("revisions").doc(revisionId).get();
      expect(revision.data()?.status).toBe("approved");
    }).toPass({ timeout: 30_000 });

    const queued = await db
      .collection("mail")
      .doc(`revisionApproved_${revisionId}`)
      .get();
    expect(queued.exists).toBe(false);
  });
});
