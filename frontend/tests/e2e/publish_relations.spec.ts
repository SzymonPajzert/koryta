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

/** A stamp per run, so specs that run in parallel never read each other's
 * fixtures and a rerun never collides with the last one. */
const stamp = Date.now();
const ids = {
  draft: `pub-draft-${stamp}`,
  live: `pub-live-${stamp}`,
  other: `pub-other-${stamp}`,
  hidden: `pub-hidden-${stamp}`,
  cascadeA: `pub-cascade-a-${stamp}`,
  cascadeB: `pub-cascade-b-${stamp}`,
  unapproved: `pub-unapproved-${stamp}`,
  // No hyphens: an entity url is `<slug>-<id>`, and the id is read back as
  // everything after the last dash. This one is opened as a page, not just
  // read out of Firestore, so it has to survive that round trip.
  selfPublish: `pubselfpub${stamp}`,
};

/** Six nodes and four relations, laid out to exercise every case the publish
 * rules have - and so that no spec depends on another having run, because the
 * suite is `fullyParallel`:
 *
 *   draft    ──(ready)──    live       the relation both ends of which go live
 *   draft    ──(blocked)──  hidden     the one whose other end stays a draft
 *   live     ──(queued)──   other      already publishable: belongs in the queue
 *   cascadeA ──(cascade)──  cascadeB   seeded live, to be taken down with a page
 */
async function seed() {
  const batch = db.batch();
  const node = (name: string, published: boolean) => ({
    name,
    type: "person" as const,
    revision_id: `rev-${stamp}`,
    published,
    stats: { isApproved: published },
  });

  batch.set(
    db.collection("nodes").doc(ids.draft),
    node(`Draft ${stamp}`, false),
  );
  batch.set(db.collection("nodes").doc(ids.live), node(`Live ${stamp}`, true));
  batch.set(
    db.collection("nodes").doc(ids.other),
    node(`Other ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.hidden),
    node(`Hidden ${stamp}`, false),
  );
  batch.set(
    db.collection("nodes").doc(ids.cascadeA),
    node(`CascadeA ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.cascadeB),
    node(`CascadeB ${stamp}`, true),
  );

  batch.set(db.collection("edges").doc(`edge-ready-${stamp}`), {
    source: ids.draft,
    target: ids.live,
    type: "connection",
    name: `gotowe-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(`edge-blocked-${stamp}`), {
    source: ids.draft,
    target: ids.hidden,
    type: "connection",
    name: `zablokowane-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(`edge-queued-${stamp}`), {
    source: ids.live,
    target: ids.other,
    type: "connection",
    name: `kolejka-${stamp}`,
    published: false,
  });
  // The state most pages are actually in: revisions, none of them approved,
  // so the node points at no version at all.
  batch.set(db.collection("nodes").doc(ids.unapproved), {
    name: `Unapproved ${stamp}`,
    type: "person",
    published: false,
    stats: { isApproved: false },
  });
  batch.set(db.collection("revisions").doc(`rev-old-${stamp}`), {
    node_id: ids.unapproved,
    collection: "nodes",
    data: { name: `Unapproved ${stamp}`, type: "person", education: "stara" },
    update_time: new Date(stamp - 60_000).toISOString(),
    update_user: "pipeline",
    update_automatic: true,
  });
  batch.set(db.collection("revisions").doc(`rev-new-${stamp}`), {
    node_id: ids.unapproved,
    collection: "nodes",
    data: { name: `Unapproved ${stamp}`, type: "person", education: "nowa" },
    update_time: new Date(stamp).toISOString(),
    update_user: "pipeline",
    update_automatic: true,
  });

  batch.set(db.collection("nodes").doc(ids.selfPublish), {
    name: `Selfpublish ${stamp}`,
    type: "person",
    published: false,
    stats: { isApproved: false, nodeGroupSize: 1 },
  });
  batch.set(db.collection("revisions").doc(`rev-self-${stamp}`), {
    node_id: ids.selfPublish,
    collection: "nodes",
    data: { name: `Selfpublish ${stamp}`, type: "person" },
    update_time: new Date(stamp).toISOString(),
    update_user: "pipeline",
    update_automatic: true,
  });

  batch.set(db.collection("edges").doc(`edge-cascade-${stamp}`), {
    source: ids.cascadeA,
    target: ids.cascadeB,
    type: "connection",
    name: `kaskada-${stamp}`,
    published: true,
  });

  await batch.commit();
}

test.describe("Publishing relations", () => {
  test.beforeAll(async () => {
    await seed();
  });

  test("an admin publishes a page and picks which relations go with it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${ids.draft}`);

    await page.getByTestId("publish-toggle").click();

    const dialog = page.getByTestId("publish-node-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // Both relations are offered, but only the one whose other end is already
    // live may be ticked - that is the "gray them out" rule, on screen.
    const ready = dialog.getByTestId(
      `publish-relation-check-edge-ready-${stamp}`,
    );
    const blocked = dialog.getByTestId(
      `publish-relation-check-edge-blocked-${stamp}`,
    );
    await expect(ready.locator("input")).toBeEnabled();
    await expect(blocked.locator("input")).toBeDisabled();

    // "Select all" means "all the ones that can go", not "all of them".
    await dialog.getByTestId("publish-select-all").click();
    await expect(ready.locator("input")).toBeChecked();
    await expect(blocked.locator("input")).not.toBeChecked();

    await dialog.getByTestId("publish-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const [node, edge] = await Promise.all([
            db.collection("nodes").doc(ids.draft).get(),
            db.collection("edges").doc(`edge-ready-${stamp}`).get(),
          ]);
          return [node.data()?.published, edge.data()?.published];
        },
        { timeout: 30_000 },
      )
      .toEqual([true, true]);

    // The blocked one is untouched: its other end is still a draft.
    const blockedDoc = await db
      .collection("edges")
      .doc(`edge-blocked-${stamp}`)
      .get();
    expect(blockedDoc.data()?.published).not.toBe(true);
  });

  test("the admin queue lists relations whose pages are both live, and publishes them", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, "/admin/krawedzie");

    const row = page.getByRole("row", { name: new RegExp(`kolejka-${stamp}`) });
    await expect(row).toBeVisible({ timeout: 60_000 });

    // The one still waiting on a draft page must not be offered here.
    await expect(page.locator("body")).not.toContainText(
      `zablokowane-${stamp}`,
    );

    await row.getByRole("checkbox").check();
    await page.getByTestId("edges-publish-selected").click();

    await expect
      .poll(
        async () =>
          (
            await db.collection("edges").doc(`edge-queued-${stamp}`).get()
          ).data()?.published,
        { timeout: 30_000 },
      )
      .toBe(true);

    // Published, so it drops out of the queue it was in.
    await expect(page.locator("body")).not.toContainText(`kolejka-${stamp}`, {
      timeout: 30_000,
    });
  });

  test("publishing a page with nothing approved approves its newest revision", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${ids.unapproved}`);

    // This used to be a disabled button and a tooltip explaining the page
    // needed an approved revision - said to the one person who would have had
    // to approve one, on the screen where publishing happens.
    const toggle = page.getByTestId("publish-toggle");
    await expect(toggle).toBeEnabled({ timeout: 60_000 });
    await toggle.click();

    const dialog = page.getByTestId("publish-node-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // It says which version, because nobody chose it.
    await expect(dialog.getByTestId("publish-auto-approve")).toBeVisible();

    await dialog.getByTestId("publish-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const node = await db.collection("nodes").doc(ids.unapproved).get();
          const revision = node.data()?.revision_id as
            { id?: string } | string | undefined;
          return [
            node.data()?.published,
            typeof revision === "string" ? revision : revision?.id,
            node.data()?.education,
          ];
        },
        { timeout: 30_000 },
      )
      .toEqual([true, `rev-new-${stamp}`, "nowa"]);
  });

  test("an admin publishes an unapproved page from the page itself", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // The screen where this was reported: the reviewer reads the person's page,
    // decides, and clicks "Opublikuj" next to the „szkic" badge.
    await logIn(page, USERS.admin, `/osoba/selfpublish-${ids.selfPublish}`);

    await page.getByTestId("draft-status-publish").click();

    const dialog = page.getByTestId("publish-node-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // The badge has no revision list of its own, so the dialog is what says
    // which version is about to become the public one - and it says it here
    // too, not only on /admin/rewizje.
    await expect(dialog.getByTestId("publish-auto-approve")).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByTestId("publish-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const node = await db.collection("nodes").doc(ids.selfPublish).get();
          const revision = node.data()?.revision_id as
            { id?: string } | string | undefined;
          return [
            node.data()?.published,
            typeof revision === "string" ? revision : revision?.id,
          ];
        },
        { timeout: 30_000 },
      )
      .toEqual([true, `rev-self-${stamp}`]);
  });

  test("hiding a page hides the relations that lean on it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${ids.cascadeA}`);

    // Both this page and the one at the other end are live, and so is the
    // relation between them. Hiding this one has to take the relation down
    // too, or the graph keeps an edge pointing at a page nobody can open.
    await page.getByTestId("publish-toggle").click();

    await expect
      .poll(
        async () => {
          const [node, edge] = await Promise.all([
            db.collection("nodes").doc(ids.cascadeA).get(),
            db.collection("edges").doc(`edge-cascade-${stamp}`).get(),
          ]);
          return [node.data()?.published, edge.data()?.published];
        },
        { timeout: 30_000 },
      )
      .toEqual([false, false]);

    // The page at the other end is not touched - it is still a perfectly good
    // page, it just has one fewer relation on it.
    const other = await db.collection("nodes").doc(ids.cascadeB).get();
    expect(other.data()?.published).toBe(true);
  });
});
