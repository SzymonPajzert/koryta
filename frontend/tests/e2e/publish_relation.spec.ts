import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-koryta-pl";

const app =
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
const db = getFirestore(app, "koryta-pl");

/** A stamp per run, so a rerun never collides with the last one and the suite's
 * `fullyParallel` workers never read each other's fixtures. */
const stamp = Date.now();

/** No hyphens in a node id: a readable url is `/osoba/<slug>-<id>` and the page
 * reads the id off the last dash-separated segment. Edge ids never reach a url
 * and may keep theirs. */
const ids = {
  friend: `pubfriend${stamp}`,
  other: `pubother${stamp}`,
  draft: `pubdraft${stamp}`,
};
const edges = {
  friendship: `pub-edge-friendship-${stamp}`,
  toDraft: `pub-edge-to-draft-${stamp}`,
};

/** Two live pages with an unpublished relation between them, plus a draft page
 * on the other end of a second one.
 *
 *   friend ──(friendship, unpublished)── other   both live: publishable here
 *   friend ──(mentorship, unpublished)── draft   the far end is a draft
 *
 * Its own pages rather than the seeded Jan Kowalski, because the seed is shared
 * and photographed: notes.spec.ts and person-facts.spec.ts take baselines of
 * /entity/person/1 and /entity/person/3, and a relation left on either of them
 * would show up as a visual diff in a spec that has nothing to do with this.
 *
 * Written with `set`, so a retry restores the fixture rather than finding the
 * relation already published by the previous attempt.
 */
async function seed() {
  const batch = db.batch();

  const page = (name: string, published: boolean) => ({
    name,
    type: "person",
    revision_id: `rev-${stamp}`,
    published,
    stats: { isApproved: published, nodeGroupSize: 1 },
  });

  batch.set(
    db.collection("nodes").doc(ids.friend),
    page(`Publikowany Znajomy ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.other),
    page(`Druga Strona ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.draft),
    page(`Szkic Osoby ${stamp}`, false),
  );

  batch.set(db.collection("edges").doc(edges.friendship), {
    source: ids.friend,
    target: ids.other,
    type: "connection",
    name: `znajomosc-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(edges.toDraft), {
    source: ids.friend,
    target: ids.draft,
    type: "connection",
    name: `mentor-${stamp}`,
    published: false,
  });

  await batch.commit();
}

/** Publishing a relation from the row that draws it.
 *
 * The gap this covers: once both pages are live, the publish dialog on the
 * draft badge - the only other way onto the site that does not involve hunting
 * through /admin/krawedzie - can never open for either of them, so a relation
 * added afterwards had nowhere to be published from.
 */
test.describe("Publishing a relation", () => {
  test.beforeEach(async () => {
    await seed();
  });

  test.afterAll(async () => {
    const batch = db.batch();
    for (const id of Object.values(ids)) {
      batch.delete(db.collection("nodes").doc(id));
    }
    for (const id of Object.values(edges)) {
      batch.delete(db.collection("edges").doc(id));
    }
    await batch.commit();
  });

  test("an admin publishes one from the row, and only where it may be", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/entity/person/${ids.friend}`);

    const relations = page.getByTestId("relations-history");
    const live = relations
      .locator(".v-list-item")
      .filter({ hasText: `Druga Strona ${stamp}` });
    await expect(live).toContainText("szkic", { timeout: 30_000 });

    // The relation to a draft page carries the badge too, and no button: the
    // rule /api/edges/publish enforces is that neither end is a draft, so the
    // only thing a button there could produce is a refusal.
    const blocked = relations
      .locator(".v-list-item")
      .filter({ hasText: `Szkic Osoby ${stamp}` });
    await expect(blocked).toContainText("szkic");
    await expect(
      blocked.getByRole("button", { name: "Opublikuj" }),
    ).toHaveCount(0);

    await live.getByRole("button", { name: "Opublikuj" }).click();

    // The badge is the confirmation - and the relation is really live, which
    // the row cannot show on its own: a published relation looks like any
    // other.
    await expect(live).not.toContainText("szkic", { timeout: 30_000 });
    await expect(async () => {
      const stored = await db.collection("edges").doc(edges.friendship).get();
      expect(stored.get("published")).toBe(true);
    }).toPass({ timeout: 30_000 });

    // Still gone after a reload, which reads the relation back rather than
    // trusting what the click left on screen.
    await page.reload();
    const reloaded = page
      .getByTestId("relations-history")
      .locator(".v-list-item")
      .filter({ hasText: `Druga Strona ${stamp}` });
    await expect(reloaded).toBeVisible({ timeout: 30_000 });
    await expect(reloaded).not.toContainText("szkic");
  });
});
