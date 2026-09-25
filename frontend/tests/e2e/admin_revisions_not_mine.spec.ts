import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** "Bez moich" in the review queue on /admin/rewizje: the admin's own
 * proposals left out, so what somebody else filed stands out.
 *
 * Here rather than only in the unit tests because the endpoint leaves them out
 * with a `!=` ordered by another field, and only a real Firestore says whether
 * it takes that query. (Not whether production has the index for it - the
 * emulator needs none.)
 */
const RUN = Date.now();
const MINE = `000-moja-${RUN}`;
const THEIRS = `000-cudza-${RUN}`;

/** The emulator app, created on first use. `getAuth()` with no argument does
 * not create it - it throws unless something in this worker already has, which
 * is only true when another spec happened to run first. */
const app = () =>
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();

const db = () => getFirestore(app(), "koryta-pl");

/** A pending proposal filed through the dialog, on an entry of its own. */
async function propose(id: string, uid: string) {
  await db()
    .collection("nodes")
    .doc(id)
    .set({ name: id, type: "person", published: false });
  await db()
    .collection("revisions")
    .doc(id)
    .set({
      node_id: id,
      collection: "nodes",
      data: { name: id, type: "person", content: `Propozycja ${id}` },
      update_time: Timestamp.now(),
      update_user: uid,
      update_automatic: false,
      status: "pending",
    });
}

test.beforeAll(async () => {
  const admin = await getAuth(app()).getUserByEmail(USERS.admin.email);
  await propose(MINE, admin.uid);
  await propose(THEIRS, `ktos-inny-${RUN}`);
});

test.afterAll(async () => {
  for (const id of [MINE, THEIRS]) {
    await db().collection("revisions").doc(id).delete();
    await db().collection("nodes").doc(id).delete();
  }
});

test("'Bez moich' leaves the admin's own proposals out of the queue", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/rewizje#kolejka");
  await page.waitForURL(/\/admin\/rewizje/, { timeout: 30_000 });

  const queue = page.locator("#kolejka");
  const row = (id: string) => queue.locator(`[data-proposal-id="${id}"]`);
  await expect(row(THEIRS)).toBeVisible({ timeout: 30_000 });
  await expect(row(MINE)).toBeVisible();

  await queue.locator('[data-filter="hide"]').click();

  await expect(page).toHaveURL(/mine=hide/, { timeout: 30_000 });
  await expect(row(MINE)).toHaveCount(0, { timeout: 30_000 });
  await expect(row(THEIRS)).toBeVisible();
  await expect(queue.locator('[data-filter="hide"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
