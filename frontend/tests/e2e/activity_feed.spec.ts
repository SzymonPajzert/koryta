import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** That /aktywnosc keeps a reader's own work out of the list until they untick
 * "Ukryj moje zmiany" and then shows it named, masks an administrator's
 * decision, and that only an administrator gets the filter for the
 * administrators on trial.
 *
 * The emulator fixtures seed no votes and no audit rows - the stats page's
 * visual baseline depends on that - so this spec files one of each, dated now,
 * and takes them away again. What a batch says and how it folds is the unit
 * tests' job; this is the page, the endpoint and the auth between them.
 *
 * The feed is memoized per window for five minutes, so the rows go in before
 * any page asks for it, and nothing warms /aktywnosc in global-setup.
 */
const RUN = Date.now();
const PREFIX = "actfeed";
const personId = `${PREFIX}${RUN}p`;
const personName = `Aktywna Osoba ${RUN}`;
const auditId = `${PREFIX}${RUN}a`;
/** `votes` documents are keyed `${target}_${uid}`, and the rules hold a client
 * to its own uid; the admin SDK writes it here as the seeded normal user. */
const voteId = `${personId}_test-user`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

/** Everything any run of this spec left behind - a failed run skips its
 * `afterAll`, and a leftover vote dated inside the window would put a second
 * line where this one expects its own. */
async function clearPreviousRuns() {
  for (const collection of ["votes", "audit", "nodes"]) {
    const stale = await db()
      .collection(collection)
      .where(FieldPath.documentId(), ">=", PREFIX)
      .where(FieldPath.documentId(), "<", `${PREFIX}\uf8ff`)
      .get();
    if (stale.empty) continue;
    const batch = db().batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

test.beforeAll(async () => {
  await clearPreviousRuns();
  const now = new Date().toISOString();
  const batch = db().batch();
  batch.set(db().collection("nodes").doc(personId), {
    name: personName,
    type: "person",
    published: true,
    stats: { nodeGroupSize: 1, isApproved: true },
  });
  batch.set(db().collection("votes").doc(voteId), {
    nodeId: personId,
    userUid: "test-user",
    categoryVotes: { interesting: 3 },
    updatedAt: now,
  });
  batch.set(db().collection("audit").doc(auditId), {
    action: "publish",
    collection: "nodes",
    target_id: personId,
    user: "test-admin",
    at: now,
  });
  await batch.commit();
});

test.afterAll(async () => {
  await clearPreviousRuns();
});

/** This spec's line of one kind: another spec's vote or publication, left in
 * the emulator, says the same words about a different page. */
const lineOf = (page: Page, sentence: string) =>
  page
    .getByTestId("feed-item")
    .filter({ hasText: sentence })
    .filter({ has: page.getByRole("link", { name: personName }) });

test("a reader sees an admin's publication masked, and their own vote once they ask", async ({
  page,
}) => {
  await logIn(page, USERS.normal, "/aktywnosc");
  await expect(page.getByRole("heading", { name: "Aktywność" })).toBeVisible();

  const published = lineOf(page, "opublikował/a 1 osobę");
  await expect(published).toBeVisible({ timeout: 30_000 });
  await expect(published).toContainText("Anonim");
  await expect(published).not.toContainText("Admin User");

  // Loaded with the publication, and hidden until the box is unticked.
  const own = lineOf(page, "ocenił/a 1 osobę");
  await expect(own).toHaveCount(0);
  const hideMine = page.getByRole("checkbox", { name: "Ukryj moje zmiany" });
  await expect(hideMine).toHaveAttribute("aria-checked", "true");
  await hideMine.click();
  await expect(page).toHaveURL(/moje=tak/);
  await expect(own).toBeVisible();
  await expect(own).toContainText("Ty");

  await expect(page.getByTestId("activity-new-admins")).toHaveCount(0);
});

test("an administrator sees names and the filter for administrators on trial", async ({
  page,
}) => {
  await logIn(page, USERS.admin, "/aktywnosc");

  await expect(lineOf(page, "ocenił/a 1 osobę")).toContainText("Normal User", {
    timeout: 30_000,
  });
  // The publication is the administrator's own, so it waits for the box.
  const published = lineOf(page, "opublikował/a 1 osobę");
  await expect(published).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Ukryj moje zmiany" }).click();
  await expect(published).toBeVisible();
  await expect(published).toContainText("Admin User");

  await page.getByTestId("activity-new-admins").click();
  await expect(page).toHaveURL(/kto=nowi-admini/);
  // The seed keeps one administrator on trial (scripts/seed-emulator.ts), who
  // is listed whether or not they did anything.
  await expect(page.getByTestId("activity-new-admin-list")).toContainText(
    "Trial Admin",
  );
});
