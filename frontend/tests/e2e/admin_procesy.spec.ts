import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";
import { OPS_DATABASE } from "../../shared/tasks";
import { JOBS_COLLECTION, JOB_RUNS_COLLECTION } from "../../shared/jobs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = () =>
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
const opsDb = () => getFirestore(app(), OPS_DATABASE);
const siteDb = () => getFirestore(app(), "koryta-pl");

/** /admin/procesy against the real route: runs written the way the Python
 * reporter writes them (data/pipelines/src/stores/job_runs.py), into the ops
 * database, and a capture written the way /api/ingest/page writes one. The
 * visual test stubs the route; this is what checks the documents and the
 * page agree on field names and times. */
test.describe("Procesy", () => {
  test("pokazuje zgłoszone uruchomienia i zapisane strony", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Seeds, logs in, waits for the page

    const stamp = Date.now();
    const now = new Date(stamp);
    const minutesAgo = (minutes: number) => new Date(stamp - minutes * 60_000);
    const runId = `e2e${stamp}running`;
    const otherJob = `e2e_job_${stamp}`;
    const otherRun = `e2e${stamp}failed`;
    const captureId = `e2e${stamp}capture`;

    const batch = opsDb().batch();
    batch.set(opsDb().collection(JOB_RUNS_COLLECTION).doc(runId), {
      job: "krs_scrape_free",
      state: "running",
      trigger: "manual",
      host: "e2e@playwright",
      startedAt: minutesAgo(5),
      heartbeatAt: minutesAgo(1),
      finishedAt: null,
      progress: { done: 12, total: 40, unit: "firm" },
      counters: { answered: 20, empty: 1, failed: 0, upload_failed: 0 },
      phase: "odpisy",
      stopReason: null,
      errors: [],
      exitCode: null,
      summaryPath: null,
      version: null,
    });
    batch.set(
      opsDb().collection(JOBS_COLLECTION).doc("krs_scrape_free"),
      {
        job: "krs_scrape_free",
        lastRunId: runId,
        lastStartedAt: minutesAgo(5),
        lastState: "running",
        updatedAt: minutesAgo(1),
      },
      { merge: true },
    );
    batch.set(opsDb().collection(JOB_RUNS_COLLECTION).doc(otherRun), {
      job: otherJob,
      state: "failed",
      trigger: "manual",
      host: "e2e@playwright",
      startedAt: minutesAgo(30),
      heartbeatAt: minutesAgo(20),
      finishedAt: minutesAgo(20),
      progress: null,
      counters: {},
      phase: null,
      stopReason: "raised RuntimeError",
      errors: ["RuntimeError('e2e')"],
      exitCode: null,
      summaryPath: null,
      version: null,
    });
    await batch.commit();
    await siteDb()
      .collection("articlePages")
      .doc(captureId)
      .set({
        url: `https://example.pl/${captureId}`,
        normalizedUrl: `example.pl/${captureId}`,
        domain: "example.pl",
        title: `Strona ${captureId}`,
        storagePath: `file:///tmp/${captureId}.tar.gz`,
        htmlSha256: "0".repeat(64),
        htmlBytes: 1024,
        selection: null,
        source: "extension",
        status: "done",
        capturedBy: "e2e",
        capturedAt: now,
        updatedAt: now,
        extraction: { factCount: 2, finishedAt: now, tag: "capture_v1" },
      });

    try {
      await logIn(page, USERS.admin, "/admin/procesy");

      const free = page.locator('[data-job="krs_scrape_free"]');
      await expect(free).toHaveAttribute("data-health", "running", {
        timeout: 60_000,
      });

      // A job the registry does not know still shows, under "Inne".
      await expect(page.locator(`[data-job="${otherJob}"]`)).toHaveAttribute(
        "data-health",
        "failed",
      );

      // The capture is one run of the triggered job.
      const captures = page.locator('[data-job="capture_extraction"]');
      if (!(await captures.locator(`[data-run="${captureId}"]`).isVisible())) {
        await captures.locator("[data-row-toggle]").first().click();
      }
      await expect(captures.locator(`[data-run="${captureId}"]`)).toBeVisible();

      // Under the emulators the buckets are not probed, and the page says so
      // rather than calling the mirror stale.
      await expect(page.locator('[data-job="compressor"]')).toHaveAttribute(
        "data-health",
        "unknown",
      );
    } finally {
      const cleanup = opsDb().batch();
      cleanup.delete(opsDb().collection(JOB_RUNS_COLLECTION).doc(runId));
      cleanup.delete(opsDb().collection(JOB_RUNS_COLLECTION).doc(otherRun));
      cleanup.delete(
        opsDb().collection(JOBS_COLLECTION).doc("krs_scrape_free"),
      );
      await cleanup.commit();
      await siteDb().collection("articlePages").doc(captureId).delete();
    }
  });
});
