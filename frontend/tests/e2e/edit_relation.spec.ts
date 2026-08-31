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

/** No hyphens in a node id - see `remove_edge.spec.ts`. Edge ids never reach a
 * url and may keep theirs. */
const ids = {
  worker: `edworker${stamp}`,
  company: `edcompany${stamp}`,
  queued: `edqueued${stamp}`,
};
const edges = {
  job: `ed-edge-job-${stamp}`,
  queuedJob: `ed-edge-queued-job-${stamp}`,
};

/** What /eksploruj/nowe is asked for, so the queue holds exactly one person.
 *
 * `?minVotes=N` is a *minimum*, which makes the score a namespace shared with
 * every other spec that seeds a queued person - and a fixture scoring higher
 * than somebody else's threshold lands in their queue, not only in its own.
 * This one sat at 901 to begin with and quietly hijacked `remove_edge.spec.ts`,
 * whose threshold is 900: its queue focuses `tableItems[0]`, and 901 sorted
 * ahead of the person that spec had just seeded.
 *
 * So a queue fixture needs both halves. **Below** every other spec's threshold,
 * so nobody else's queue can see it, and **later** than theirs on
 * `latestEmploymentStart`, so it is still first in its own - the queue orders
 * on that date, descending. 899 against `remove_edge`'s 900, and 2030-06-01
 * against its 2030-01-01. */
const QUEUE_SCORE = 899;

/** Its own pages rather than the seeded Jan Kowalski, because this spec writes
 * to the relations it reads and the seed is shared between specs. Written with
 * `set`, so a retry restores the fixture rather than finding it corrected. */
async function seed() {
  const batch = db.batch();

  const employment = {
    experienceMonths: 12,
    latestEmploymentStart: "2019-03-01",
    targetNodeIds: [ids.company],
    currentlyEmployed: true,
  };

  batch.set(db.collection("nodes").doc(ids.worker), {
    name: `Poprawiany Pracownik ${stamp}`,
    type: "person",
    revision_id: `rev-${stamp}`,
    published: true,
    stats: {
      isApproved: true,
      nodeGroupSize: 1,
      edges: { all: employment, approved: employment },
    },
  });
  batch.set(db.collection("nodes").doc(ids.company), {
    name: `Spolka Poprawiana ${stamp}`,
    type: "place",
    revision_id: `rev-${stamp}`,
    published: true,
    stats: { isApproved: true, nodeGroupSize: 1 },
  });

  batch.set(db.collection("edges").doc(edges.job), {
    source: ids.worker,
    target: ids.company,
    type: "employed",
    name: "Czlonek rady",
    start_date: "2019-03-01",
    published: true,
  });

  const queuedEmployment = {
    ...employment,
    latestEmploymentStart: "2030-06-01",
  };
  batch.set(db.collection("nodes").doc(ids.queued), {
    name: `Kolejkowy Poprawiany ${stamp}`,
    type: "person",
    revision_id: `rev-${stamp}`,
    published: false,
    stats: {
      isApproved: false,
      nodeGroupSize: 1,
      notesCount: 0,
      votes: { interesting: QUEUE_SCORE, quality: 0, humanVoted: false },
      edges: { all: queuedEmployment, approved: queuedEmployment },
    },
  });
  batch.set(db.collection("edges").doc(edges.queuedJob), {
    source: ids.queued,
    target: ids.company,
    type: "employed",
    name: "Czlonek rady",
    start_date: "2030-06-01",
    published: true,
  });

  await batch.commit();
}

/** The pending revisions standing against one relation. */
async function proposalsFor(edgeId: string) {
  const snapshot = await db
    .collection("revisions")
    .where("node_id", "==", edgeId)
    .where("status", "==", "pending")
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

test.describe("Correcting a relation", () => {
  // Per test, not per file: this spec rewrites what it reads, so a retry would
  // otherwise start from the corrected fixture and assert against the wrong
  // starting value.
  test.beforeEach(async () => {
    await seed();
  });

  test("an admin fixes a job title and it sticks", async ({ page }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/entity/person/${ids.worker}`);

    const rows = page.getByTestId("relations-history").locator(".history-row");
    const job = rows.filter({ hasText: `Spolka Poprawiana ${stamp}` });
    await expect(job).toBeVisible({ timeout: 30_000 });
    await expect(job).toContainText("Czlonek rady");

    await job.getByTestId(`edge-edit-${edges.job}`).click();

    const dialog = page.getByTestId("edit-relation-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // Which relation is being corrected, not just an id.
    await expect(dialog).toContainText(`Poprawiany Pracownik ${stamp}`);
    await expect(dialog).toContainText(`Spolka Poprawiana ${stamp}`);

    const role = dialog
      .getByTestId("edit-relation-name")
      .locator("input")
      .first();
    // Prefilled from what the relation stores, so a correction is an edit
    // rather than a retype.
    await expect(role).toHaveValue("Czlonek rady");
    await role.fill("Prezes zarzadu");
    await dialog.getByTestId("edit-relation-submit").click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(job).toContainText("Prezes zarzadu", { timeout: 30_000 });

    // Really stored, not patched into the list in the browser - and applied
    // rather than queued, because an admin's edit is its own review.
    await page.reload();
    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      rows.filter({ hasText: `Spolka Poprawiana ${stamp}` }),
    ).toContainText("Prezes zarzadu");
    expect(await proposalsFor(edges.job)).toHaveLength(0);
  });

  test("a contributor's correction waits for a reviewer", async ({ page }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.normal, `/entity/person/${ids.worker}`);

    const rows = page.getByTestId("relations-history").locator(".history-row");
    const job = rows.filter({ hasText: `Spolka Poprawiana ${stamp}` });
    await expect(job).toBeVisible({ timeout: 30_000 });

    await job.getByTestId(`edge-edit-${edges.job}`).click();
    const dialog = page.getByTestId("edit-relation-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // The dialog says which of the two is about to happen, before the fields.
    await expect(dialog).toContainText("do zatwierdzenia");

    await dialog
      .getByTestId("edit-relation-name")
      .locator("input")
      .first()
      .fill("Wiceprezes");
    await dialog.getByTestId("edit-relation-submit").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The proposal stands and the relation is untouched.
    await expect(page.getByText("czeka na zatwierdzenie")).toBeVisible({
      timeout: 30_000,
    });
    const proposals = await proposalsFor(edges.job);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.data).toMatchObject({
      name: "Wiceprezes",
      // The ends and the type of a relation are not editable anywhere, so the
      // proposal has to restate the ones it started with.
      source: ids.worker,
      target: ids.company,
      type: "employed",
    });

    await page.reload();
    await expect(
      rows.filter({ hasText: `Spolka Poprawiana ${stamp}` }),
    ).toContainText("Czlonek rady", { timeout: 30_000 });
  });

  test("a correction can be made from the /eksploruj/nowe queue", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // The queue and the profile stay in parity - see
    // .agent/skills/relation-surfaces.md.
    await logIn(page, USERS.admin, `/eksploruj/nowe?minVotes=${QUEUE_SCORE}`);

    const relations = page.getByTestId("explore-relations");
    await expect(relations.getByText(`Spolka Poprawiana ${stamp}`)).toBeVisible(
      { timeout: 30_000 },
    );

    await relations.getByTestId(`edge-edit-${edges.queuedJob}`).click();
    const dialog = page.getByTestId("edit-relation-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog
      .getByTestId("edit-relation-name")
      .locator("input")
      .first()
      .fill("Przewodniczacy rady");
    await dialog.getByTestId("edit-relation-submit").click();

    // Corrected in place, without the page moving on to somebody else - the
    // reviewer is still judging this person.
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(relations).toContainText("Przewodniczacy rady", {
      timeout: 30_000,
    });
  });

  test("a logged out reader is offered no pencil", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/entity/person/${ids.worker}`);

    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid^="edge-edit-"]')).toHaveCount(0);
  });
});
