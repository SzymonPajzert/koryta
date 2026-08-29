import { test, expect, type Locator } from "@playwright/test";
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

const stamp = Date.now();

/** No hyphens in a node id: a readable url is `/osoba/<slug>-<id>` and the page
 * reads the id back as the last dash-separated segment. */
const ids = {
  worker: `audworker${stamp}`,
  company: `audcompany${stamp}`,
};
const edgeId = `aud-edge-job-${stamp}`;

/** One person, one company, one relation between them - this spec's own,
 * because it removes what it reads and the seeded Jan Kowalski is asserted on
 * by four other specs. */
async function seed() {
  const batch = db.batch();
  const page = (name: string, type: "person" | "place") => ({
    name,
    type,
    revision_id: `rev-${stamp}`,
    published: true,
    stats: { isApproved: true, nodeGroupSize: 1 },
  });

  batch.set(
    db.collection("nodes").doc(ids.worker),
    page(`Audytowany Pracownik ${stamp}`, "person"),
  );
  batch.set(
    db.collection("nodes").doc(ids.company),
    page(`Audytowana Spolka ${stamp}`, "place"),
  );
  // `set`, so a retry restores the fixture rather than finding it removed.
  batch.set(db.collection("edges").doc(edgeId), {
    source: ids.worker,
    target: ids.company,
    type: "employed",
    name: "Zarzad",
    start_date: "2019-03-01",
    published: true,
  });

  await batch.commit();
}

test.describe("Decision log", () => {
  // Per test, not per file: this spec removes a relation, so a retry or a
  // second local run against a still-running dev server would otherwise start
  // from a fixture the previous attempt already destroyed.
  test.beforeEach(async () => {
    await seed();
  });

  test("an admin reads back a removal and undoes it", async ({ page }) => {
    test.setTimeout(240_000);
    await logIn(page, USERS.admin, `/entity/person/${ids.worker}`);

    // Remove the relation, so the log has a decision of this spec's own to
    // find. The audit collection is never cleared by the seed, so the row has
    // to be located by its own stamped text rather than by position.
    const reason = `Blednie scalona osoba ${stamp}`;
    await page
      .getByTestId("relations-history")
      .locator(".history-row")
      .filter({ hasText: `Audytowana Spolka ${stamp}` })
      .getByTestId(`edge-remove-${edgeId}`)
      .click();
    const removeDialog = page.getByTestId("remove-edge-dialog");
    await expect(removeDialog).toBeVisible({ timeout: 30_000 });
    await removeDialog
      .getByTestId("remove-edge-reason")
      .locator("textarea")
      .first()
      .fill(reason);
    await removeDialog.getByTestId("remove-edge-confirm").click();
    await expect(removeDialog).toBeHidden({ timeout: 30_000 });

    // The log says who decided what, about which relation, and why.
    await page.goto("/admin/audyt");
    const row = page
      .getByTestId("audit-table")
      .locator("tr")
      .filter({ hasText: reason });
    await expect(row).toBeVisible({ timeout: 30_000 });
    // "powiązania", not "wpisu": the label follows what the decision was about,
    // and publishing a relation is not publishing a page.
    await expect(row).toContainText("Usunięcie powiązania");
    await expect(row).toContainText(`Audytowany Pracownik ${stamp}`);
    await expect(row).toContainText(`Audytowana Spolka ${stamp}`);
    // The uid is resolved to a name through the batched lookup.
    await expect(row).toContainText("Admin User");

    await row.getByTestId(`audit-restore-${await rowId(row)}`).click();

    // The button goes, because the relation is no longer removed - but the row
    // stays, because the removal still happened.
    await expect(row.getByRole("button", { name: "Przywróć" })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(row).toBeVisible();
    await expect(page.getByText("Powiązanie wróciło jako szkic")).toBeVisible({
      timeout: 30_000,
    });

    // Back as a draft, which is not the same as back on the site. A signed-in
    // reader is shown drafts - `authFetch` asks for `latest` on every request,
    // and `getLocalGraph` skips the visibility test when it does - so the
    // relation returns to the admin's own view of the page immediately.
    await page.goto(`/entity/person/${ids.worker}`);
    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page
        .getByTestId("relations-history")
        .getByText(`Audytowana Spolka ${stamp}`),
    ).toBeVisible({ timeout: 30_000 });

    // The public still does not see it: that is what "as a draft" means, and it
    // is why the relation is waiting in the publishing queue rather than live.
    await page.goto("/admin/krawedzie");
    await expect(
      page
        .getByTestId("edges-queue-table")
        .getByText(`Audytowany Pracownik ${stamp}`),
    ).toBeVisible({ timeout: 30_000 });

    // And the restoration is on the record too.
    await page.goto("/admin/audyt");
    await expect(
      page
        .getByTestId("audit-table")
        .locator("tr")
        .filter({ hasText: `Audytowany Pracownik ${stamp}` })
        .filter({ hasText: "Przywrócenie powiązania" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("the log is closed to a reader who is not an admin", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.normal);
    await page.goto("/admin/audyt");

    // The admin middleware aborts the navigation rather than rendering it.
    await expect(page.getByTestId("audit-table")).toHaveCount(0);
  });
});

/** The audit row's document id, read off the restore button's test hook. The
 * page keys rows by the Firestore document id, which the spec cannot know up
 * front - it only knows the reason it typed. */
async function rowId(row: Locator): Promise<string> {
  const testId = await row
    .locator('[data-testid^="audit-restore-"]')
    .getAttribute("data-testid");
  return (testId ?? "").replace("audit-restore-", "");
}
