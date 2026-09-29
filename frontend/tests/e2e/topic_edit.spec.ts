import { test, expect, type Locator, type Page } from "@playwright/test";
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

/** One topic per test, because both write to the one they open. No hyphens: a
 * topic's url is `<slug>-<id>`, and everything after the last dash is the id. */
const ids = {
  admin: `tematadmin${stamp}`,
  reader: `tematreader${stamp}`,
};

/** The lead of the topic in the report, as it read before it was corrected in
 * the database by hand: „w Bielsko-Białej” where Polish wants „w
 * Bielsku-Białej”. */
const BEFORE = "Przykłady koryciarstwa w Bielsko-Białej od lipca 2026 roku";
const AFTER = "Przykłady koryciarstwa w Bielsku-Białej od lipca 2026 roku";

/** Live and approved, like the topic in the report. Written with `set`, so a
 * retry restores the fixture rather than finding it corrected. */
async function seedTopic(id: string, name: string) {
  await db
    .collection("nodes")
    .doc(id)
    .set({
      name,
      type: "topic",
      content: "",
      description: BEFORE,
      revision_id: `rev-${stamp}`,
      published: true,
      stats: { isApproved: true, nodeGroupSize: 0 },
    });
}

/** The proposals still waiting on a topic. */
async function pendingFor(nodeId: string) {
  const snap = await db
    .collection("revisions")
    .where("node_id", "==", nodeId)
    .get();
  return snap.docs
    .map((doc) => doc.data())
    .filter((revision) => revision.status === "pending");
}

/** Opens the header's pencil and returns its dialog.
 *
 * Retried because the button is in the server's markup before Vue has attached
 * its listener, and a click in that window is dropped - the race
 * `company_proposal_feedback` handles the same way. */
async function openEditor(page: Page, title: string): Promise<Locator> {
  const button = page.getByRole("button", { name: title });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator(`.v-dialog:has-text("${title}")`);
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

test.describe("Editing a topic from its page", () => {
  test.beforeAll(async () => {
    await seedTopic(ids.admin, `Bielsko Biała ${stamp}`);
    await seedTopic(ids.reader, `Bielsko Biała czytelnika ${stamp}`);
  });

  /** Deleting is idempotent, so this is safe whatever the tests did. The
   * revisions they wrote are left: deleting a node's last one makes
   * `onRevisionWritten` write the node back as a stub. */
  test.afterAll(async () => {
    const batch = db.batch();
    for (const id of Object.values(ids)) {
      batch.delete(db.collection("nodes").doc(id));
    }
    await batch.commit();
  });

  test("an admin corrects the name and the lead, and they are live at once", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // By an out-of-date slug, which is also how a renamed topic's old links
    // arrive: the id is what resolves it.
    await logIn(page, USERS.admin, `/temat/temat-${ids.admin}`);
    await expect(page.getByTestId("topic-description")).toHaveText(BEFORE, {
      timeout: 30_000,
    });

    // The history of those edits, one click away: it is the only place the
    // wording an admin replaced survives.
    await expect(page.getByTestId("admin-revisions-link")).toHaveAttribute(
      "href",
      `/admin/rewizje/${ids.admin}`,
    );

    const dialog = await openEditor(page, "Edytuj temat");
    // Said before saving, since nobody else will look at it.
    await expect(dialog).toContainText("Zmiana wchodzi od razu");
    await dialog.getByLabel("Nazwa tematu").fill(`Bielsko-Biała ${stamp}`);
    await dialog.getByLabel("Opis tematu (opcjonalnie)").fill(AFTER);
    await dialog.getByRole("button", { name: "Zapisz zmianę" }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("topic-edit-notice")).toContainText(
      "Zmiana zapisana.",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("topic-description")).toHaveText(AFTER);
    await expect(page.getByTestId("topic-name")).toHaveText(
      `Bielsko-Biała ${stamp}`,
    );

    // Really stored rather than patched into the page - and applied rather
    // than queued, because an admin's edit is its own review.
    await page.reload();
    await expect(page.getByTestId("topic-description")).toHaveText(AFTER, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("topic-name")).toHaveText(
      `Bielsko-Biała ${stamp}`,
    );
    expect(await pendingFor(ids.admin)).toHaveLength(0);
    const stored = (await db.collection("nodes").doc(ids.admin).get()).data();
    // Still live: correcting the wording is not a decision about who sees it.
    expect(stored).toMatchObject({ description: AFTER, published: true });
  });

  test("a reader's correction waits for a reviewer, and can be previewed", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const proposedName = `Bielsko-Biała, czytelnik ${stamp}`;
    await logIn(page, USERS.normal, `/temat/temat-${ids.reader}`);
    await expect(page.getByTestId("topic-description")).toHaveText(BEFORE, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("admin-revisions-link")).toHaveCount(0);

    const dialog = await openEditor(page, "Zaproponuj zmianę");
    await expect(dialog).toContainText(
      "Zmiany będą musiały zostać zatwierdzone",
    );
    // A new name as well, one whose slug differs from the stored one: the
    // preview link below is built from the name the proposal gives.
    await dialog.getByLabel("Nazwa tematu").fill(proposedName);
    await dialog.getByLabel("Opis tematu (opcjonalnie)").fill(AFTER);
    await dialog
      .getByRole("button", { name: "Zaproponuj", exact: true })
      .click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("topic-edit-notice")).toContainText(
      "Propozycja zapisana i czeka na zatwierdzenie.",
      { timeout: 30_000 },
    );

    // Nobody has reviewed it, so the page goes on saying what it said.
    await page.reload();
    await expect(page.getByTestId("topic-description")).toHaveText(BEFORE, {
      timeout: 30_000,
    });
    const pending = await pendingFor(ids.reader);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      update_automatic: false,
      data: { type: "topic", name: proposedName, description: AFTER },
    });

    // „Podgląd” on /profil is how a reader looks at what they proposed. It
    // arrives on the proposed name's slug, which the page redirects to the
    // stored one - and the redirect used to drop `?revisionId=`, so the
    // reader saw the current text and no trace of their proposal.
    await page.goto("/profil", { waitUntil: "domcontentloaded" });
    const link = page.getByRole("link", { name: proposedName });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    await expect(page).toHaveURL(
      new RegExp(`/temat/[^?]*-${ids.reader}\\?revisionId=`),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("topic-preview-notice")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("topic-name")).toHaveText(proposedName);
    await expect(page.getByTestId("topic-description")).toHaveText(AFTER);
  });
});
