import type { JobRun, JobsOverview } from "../../../shared/jobs";

/** /api/ops/jobs for /admin/procesy's visual tests.
 *
 * The runs live in the ops database, which the seed leaves empty, and two of
 * the jobs are read off production buckets, so the whole overview is answered
 * from here. Against the frozen clock (2026-09-01 10:00 UTC, 12:00 in Warsaw)
 * it puts one job in every state the page draws: a capture stuck in the
 * extractor, a nightly scrape that stopped at its deadline, a stale mirror, a
 * finished export, the morning's people import cut short the day after a
 * trial run, a company import run by hand, a crawl still going, jobs nobody
 * has wired yet and one the registry does not know. */

function run(
  id: string,
  job: string,
  fields: Partial<JobRun> & Pick<JobRun, "state" | "startedAt">,
): JobRun {
  return {
    id,
    job,
    trigger: "manual",
    host: "romb@predator",
    heartbeatAt: fields.finishedAt ?? fields.startedAt,
    finishedAt: null,
    progress: null,
    counters: {},
    phase: null,
    stopReason: null,
    errors: [],
    exitCode: null,
    summaryPath: null,
    version: null,
    ...fields,
  };
}

function capture(
  id: string,
  fields: Partial<JobRun> & Pick<JobRun, "state" | "startedAt" | "title">,
): JobRun {
  return run(id, "capture_extraction", {
    trigger: "event",
    host: "rozszerzenie",
    url: `https://example.pl/${id}`,
    ...fields,
  });
}

const none = {
  queued: 0,
  running: 0,
  succeeded: 0,
  partial: 0,
  failed: 0,
};

export const opsJobs: JobsOverview = {
  generatedAt: "2026-09-01T10:00:00.000Z",
  problems: [],
  jobs: [
    {
      id: "capture_extraction",
      record: null,
      captureStats: {
        since: "2026-08-25T10:00:00.000Z",
        byState: { ...none, succeeded: 12, failed: 3, running: 2 },
      },
      runs: [
        capture("strona-w-toku", {
          state: "running",
          title: "Rada nadzorcza wodociągów w nowym składzie",
          startedAt: "2026-09-01T09:58:00.000Z",
          phase: "ekstrakcja",
        }),
        capture("strona-z-faktami", {
          state: "succeeded",
          title: "Prezes spółki miejskiej odwołany po kontroli",
          startedAt: "2026-09-01T09:40:00.000Z",
          finishedAt: "2026-09-01T09:41:12.000Z",
          counters: { facts: 3 },
          link: "/ekstrakcje?article=https%3A%2F%2Fexample.pl%2Fstrona-z-faktami",
          version: "qwen3.8-27b",
        }),
        capture("strona-utknela", {
          state: "running",
          title: "Nowy wiceprezes portu lotniczego",
          startedAt: "2026-09-01T08:02:00.000Z",
          phase: "ekstrakcja",
        }),
        capture("strona-bez-faktow", {
          state: "succeeded",
          title: "Ranking gmin 2026",
          host: "wklejone na /zrodla",
          startedAt: "2026-09-01T07:50:00.000Z",
          finishedAt: "2026-09-01T07:50:40.000Z",
          counters: { facts: 0 },
        }),
        capture("strona-nie-artykul", {
          state: "failed",
          title: "Strona główna portalu",
          startedAt: "2026-09-01T07:30:00.000Z",
          finishedAt: "2026-09-01T07:30:20.000Z",
          errors: ["Analiza: to nie jest artykuł (koryciarstwo 0/5)."],
        }),
      ],
    },
    {
      id: "company_import",
      record: {
        lastRunId: "company-0827",
        lastStartedAt: "2026-08-27T13:12:00.000Z",
        lastScheduledAt: null,
        lastSucceededAt: "2026-08-27T13:15:41.000Z",
      },
      runs: [
        run("company-0827", "company_import", {
          state: "succeeded",
          startedAt: "2026-08-27T13:12:00.000Z",
          finishedAt: "2026-08-27T13:15:41.000Z",
          progress: { done: 215, total: 215, unit: "firm" },
          counters: { uploaded: 214, failed: 1, skipped: 0 },
          exitCode: 0,
        }),
      ],
    },
    {
      id: "krs_scrape_free",
      record: {
        lastRunId: "free-0901",
        lastStartedAt: "2026-08-31T22:30:04.000Z",
        lastScheduledAt: "2026-08-31T22:30:04.000Z",
        lastSucceededAt: "2026-08-29T23:58:31.000Z",
      },
      runs: [
        run("free-0901", "krs_scrape_free", {
          state: "partial",
          trigger: "schedule",
          host: "cloud-run:krs-scrape-free/krs-scrape-free-x7k2p",
          startedAt: "2026-08-31T22:30:04.000Z",
          finishedAt: "2026-09-01T01:20:02.000Z",
          progress: { done: 5210, total: 6762, unit: "firm" },
          counters: {
            answered: 9874,
            empty: 412,
            failed: 3,
            upload_failed: 0,
            bulletin_fetched: 1,
            bulletin_failed: 0,
          },
          stopReason: "deadline",
          exitCode: 75,
          summaryPath:
            "gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/date=2026-09-01/free-0901.json",
        }),
        run("free-0831", "krs_scrape_free", {
          state: "succeeded",
          trigger: "schedule",
          host: "cloud-run:krs-scrape-free/krs-scrape-free-q4m8s",
          startedAt: "2026-08-29T22:30:03.000Z",
          finishedAt: "2026-08-29T23:58:31.000Z",
          progress: { done: 3120, total: 3120, unit: "firm" },
          counters: { answered: 6101, empty: 188, failed: 0, upload_failed: 0 },
          exitCode: 0,
        }),
        run("free-0830", "krs_scrape_free", {
          state: "failed",
          trigger: "schedule",
          host: "cloud-run:krs-scrape-free/krs-scrape-free-b2n9d",
          startedAt: "2026-08-28T22:30:05.000Z",
          finishedAt: "2026-08-28T22:41:50.000Z",
          progress: { done: 40, total: 3311, unit: "firm" },
          counters: { answered: 52, empty: 3, failed: 20, upload_failed: 0 },
          stopReason: "20 requests in a row failed",
          exitCode: 75,
          errors: [
            "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000327525?rejestr=P: Read timed out. (read timeout=30)",
          ],
        }),
      ],
    },
    {
      id: "krs_scrape_paid",
      record: {
        lastRunId: "paid-0828",
        lastStartedAt: "2026-08-28T14:05:00.000Z",
        lastScheduledAt: null,
        lastSucceededAt: "2026-08-28T14:31:40.000Z",
      },
      runs: [
        run("paid-0828", "krs_scrape_paid", {
          state: "succeeded",
          startedAt: "2026-08-28T14:05:00.000Z",
          finishedAt: "2026-08-28T14:31:40.000Z",
          progress: { done: 412, total: 412, unit: "zapytań" },
          counters: { bought: 398, skipped: 14, pln: 19.9, pln_planned: 20.6 },
        }),
      ],
    },
    {
      id: "krs_odpis",
      record: {
        lastRunId: "odpis-0901",
        lastStartedAt: "2026-09-01T06:22:28.000Z",
        lastScheduledAt: null,
        lastSucceededAt: "2026-09-01T06:35:57.000Z",
      },
      runs: [
        run("odpis-0901", "krs_odpis", {
          state: "succeeded",
          startedAt: "2026-09-01T06:22:28.000Z",
          finishedAt: "2026-09-01T06:35:57.000Z",
          progress: { done: 369, total: 369, unit: "firm" },
          counters: {
            fetched: 369,
            absent: 0,
            gateway: 0,
            network: 0,
            failed: 0,
          },
          exitCode: 0,
        }),
      ],
    },
    {
      id: "compressor",
      record: null,
      runs: [],
      probe: {
        kind: "compressedMirror",
        hosts: [
          {
            host: "rejestr.io",
            through: "2026-07-31",
            archivedAt: "2026-08-01T11:37:02.000Z",
            bytes: 10_136_728,
          },
          {
            host: "api-krs.ms.gov.pl",
            through: "2026-07-31",
            archivedAt: "2026-08-01T11:38:52.000Z",
            bytes: 9_175_965,
          },
        ],
      },
    },
    {
      id: "firestore_export",
      record: null,
      runs: [],
      probe: {
        kind: "firestoreExport",
        latest: {
          folder: "date=2026-09-01T02:00:08.395Z",
          startedAt: "2026-09-01T02:00:08.395Z",
          finishedAt: "2026-09-01T02:03:07.000Z",
        },
      },
    },
    {
      // On its schedule since the trial the day before, so held to 05:00.
      // That trial is still its last success: this morning's run was cut
      // short.
      id: "people_import",
      record: {
        lastRunId: "people-0901",
        lastStartedAt: "2026-09-01T03:00:04.000Z",
        lastScheduledAt: "2026-09-01T03:00:04.000Z",
        lastSucceededAt: "2026-08-31T03:41:12.000Z",
      },
      runs: [
        run("people-0901", "people_import", {
          state: "partial",
          trigger: "schedule",
          host: "cloud-run:people-import/people-import-m3v8t",
          startedAt: "2026-09-01T03:00:04.000Z",
          finishedAt: "2026-09-01T03:52:41.000Z",
          progress: { done: 1180, total: 1240, unit: "osób" },
          counters: {
            created: 0,
            updated: 412,
            unchanged: 768,
            employments_created: 96,
            unplaced: 14,
            failed: 0,
          },
          stopReason: "przerwany",
        }),
        run("people-0831", "people_import", {
          state: "succeeded",
          trigger: "schedule",
          host: "cloud-run:people-import/people-import-k9d2w",
          startedAt: "2026-08-31T03:00:03.000Z",
          finishedAt: "2026-08-31T03:41:12.000Z",
          counters: { planned: 1305 },
          stopReason: "próba - nic nie wysłano",
          exitCode: 0,
        }),
      ],
    },
    {
      id: "article_crawl",
      record: {
        lastRunId: "crawl-0831",
        lastStartedAt: "2026-08-31T18:00:00.000Z",
        lastScheduledAt: null,
        lastSucceededAt: null,
      },
      runs: [
        run("crawl-0831", "article_crawl", {
          state: "running",
          host: "mp@crawler",
          startedAt: "2026-08-31T18:00:00.000Z",
          heartbeatAt: "2026-09-01T09:58:30.000Z",
          progress: { done: 18_342, total: null, unit: "stron" },
          counters: { stored: 18_342, errors: 211 },
          phase: "partia 412",
        }),
      ],
    },
  ],
  others: [
    {
      id: "people_upload",
      record: null,
      runs: [
        run("upload-0831", "people_upload", {
          state: "succeeded",
          startedAt: "2026-08-31T07:10:00.000Z",
          finishedAt: "2026-08-31T07:24:31.000Z",
          progress: { done: 212, total: 212, unit: "osób" },
          counters: { created: 14, updated: 198 },
          exitCode: 0,
        }),
      ],
    },
  ],
};
