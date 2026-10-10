// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  duration,
  jobIdFrom,
  jobsStatus,
  runIdFrom,
  warsawStamp,
} from "../../scripts/mcp/jobs";
import {
  opsConnection,
  restJobReports,
  type JobReports,
} from "../../scripts/mcp/ops-store";
import type { Doc } from "../../scripts/mcp/firestore-reader";
import {
  jobDefinition,
  jobHealth,
  jobRunFromData,
  type JobRun,
} from "../../shared/jobs";

/** 09:00 in Warsaw: the night started at 04:30 and is over. */
const NOW = new Date("2026-10-10T07:00:00.000Z");

/** A run document as the REST API hands it back: times to the microsecond. */
function runDoc(
  id: string,
  job: string,
  startedAt: string,
  fields: Record<string, unknown> = {},
): Doc {
  const finishedAt = "finishedAt" in fields ? fields.finishedAt : startedAt;
  return {
    id,
    data: {
      job,
      state: "succeeded",
      trigger: "schedule",
      host: "koryta@koryta-nightly",
      startedAt,
      heartbeatAt: finishedAt ?? startedAt,
      finishedAt,
      progress: null,
      counters: {},
      phase: null,
      stopReason: null,
      errors: [],
      exitCode: 0,
      summaryPath: null,
      version: null,
      ...fields,
    },
  };
}

const recordDoc = (id: string, fields: Record<string, unknown>): Doc => ({
  id,
  data: fields,
});

/** The ops database in memory, answering as Firestore would, and noting
 * what it was asked. */
function memoryReports(runs: Doc[], records: Doc[] = []) {
  const calls: string[] = [];
  const reports: JobReports = {
    source: "memory",
    async recentRuns(limit) {
      calls.push(`recent ${limit}`);
      return [...runs]
        .sort((a, b) =>
          String(b.data.startedAt).localeCompare(String(a.data.startedAt)),
        )
        .slice(0, limit);
    },
    async runsOf(job) {
      calls.push(`runsOf ${job}`);
      return runs.filter((doc) => doc.data.job === job);
    },
    async runs(ids) {
      if (ids.length === 0) return [];
      calls.push(`runs ${ids.join(",")}`);
      return runs.filter((doc) => ids.includes(doc.id));
    },
    async records() {
      calls.push("records");
      return records;
    },
  };
  return { reports, calls };
}

const night = runDoc("night-1", "nightly", "2026-10-10T02:30:08.240123Z", {
  state: "partial",
  finishedAt: "2026-10-10T04:48:13.762456Z",
  progress: { done: 13, total: 13, unit: "kroków" },
  stopReason: "outputs: partial - 8 nie przechodzi",
  errors: [
    "outputs: partial - 8 nie przechodzi",
    "people: held - test, który przechodził, dziś nie przechodzi",
  ],
});

function aNight() {
  return memoryReports(
    [
      night,
      // Last night's free scrape, and none tonight: late.
      runDoc("free-1", "krs_scrape_free", "2026-10-09T02:32:00Z", {
        progress: { done: 71, total: 71, unit: "firm" },
      }),
      runDoc("paid-1", "krs_scrape_paid", "2026-10-10T03:05:00Z", {
        state: "failed",
        stopReason: "konto odmówiło: 402",
        errors: ["402 Payment Required"],
      }),
      runDoc("people-1", "people_import", "2026-10-10T04:40:00Z", {
        state: "running",
        finishedAt: null,
        heartbeatAt: "2026-10-10T06:55:00Z",
        phase: "wysyłka",
        progress: { done: 40, total: 100, unit: "osób" },
      }),
      runDoc("stray-1", "zz_stray", "2026-10-09T12:00:00Z", {
        trigger: "manual",
        host: "predator",
      }),
    ],
    [
      recordDoc("krs_scrape_free", {
        lastRunId: "free-1",
        lastScheduledAt: "2026-10-09T02:32:00.000001Z",
      }),
      recordDoc("krs_scrape_paid", {
        lastRunId: "paid-1",
        lastScheduledAt: "2026-10-10T03:05:00Z",
      }),
    ],
  );
}

describe("jobsStatus: every job", () => {
  it("judges each job as the page does, one line each, worst first at the top", async () => {
    const { reports } = aNight();
    const text = await jobsStatus(reports, {}, NOW);

    expect(text).toContain(
      "Needs a look: 3 - krs_scrape_paid (failed), krs_scrape_free (late), nightly (held).",
    );
    // The night's line carries jobHealth's own words, so it cannot drift
    // from the page's.
    const page = jobHealth(
      jobDefinition("nightly")!,
      { runs: [jobRunFromData(night.id, night.data) as JobRun], record: null },
      NOW,
    );
    expect(page.status).toBe("held");
    expect(text).toContain(`- nightly · held · ${page.detail} · newest run`);
    expect(text).toContain(
      "newest run night-1: partial (schedule), held steps back, started 2026-10-10 04:30, took 2 h 18 min, progress 13/13 kroków, stop reason: outputs: partial - 8 nie przechodzi, 2 errors",
    );
    expect(text).toContain(
      "- krs_scrape_free · late · Nie wystartował o 04:30. · newest run free-1: succeeded (schedule), started 2026-10-09 04:32",
    );
    expect(text).toContain(
      "- people_import · running · Trwa od 06:40 - wysyłka. · newest run people-1: running (schedule), started 2026-10-10 06:40, going for 2 h 20 min, last heard from 5 min ago, phase wysyłka, progress 40/100 osób",
    );
    expect(text).toContain("- company_import · never · ");
  });

  it("says what it did not read rather than calling it never reported", async () => {
    const { reports } = aNight();
    const text = await jobsStatus(reports, {}, NOW);
    expect(text).toContain(
      "Not read here: capture_extraction, compressor, firestore_export",
    );
    expect(text).toMatch(
      /- capture_extraction · not read here · .*articlePages.*outside ops-writer's grant/,
    );
    expect(text).toMatch(
      /- compressor · not read here · .*gs:\/\/koryta-pl-compressed/,
    );
    expect(text).toMatch(
      /- firestore_export · not read here · .*gs:\/\/koryta-pl-crawled/,
    );
    expect(text).not.toMatch(/- compressor · never/);
  });

  it("lists jobs JOBS does not know under their own heading, as the page does", async () => {
    const { reports } = aNight();
    const text = await jobsStatus(reports, {}, NOW);
    const [, unlisted] = text.split("## Unlisted");
    expect(unlisted).toContain(
      "- zz_stray · ok · Ostatnio udane: 9.10, 14:00.",
    );
  });

  it("reads a job's last run through its record once it has left the window", async () => {
    const chatty = Array.from({ length: 300 }, (_, i) =>
      runDoc(
        `chatty-${String(i).padStart(3, "0")}`,
        "chatty",
        new Date(NOW.getTime() - i * 60_000).toISOString(),
      ),
    );
    const old = runDoc("old-odpis", "krs_odpis", "2026-09-01T10:00:00Z", {
      state: "partial",
      stopReason: "wyszukiwarka zwalnia",
    });
    const { reports, calls } = memoryReports(
      [...chatty, old],
      [recordDoc("krs_odpis", { lastRunId: "old-odpis" })],
    );
    const text = await jobsStatus(reports, {}, NOW);
    expect(calls).toEqual(["recent 300", "records", "runs old-odpis"]);
    expect(text).toContain(
      "- krs_odpis · partial · Przerwane z zaległościami: 1.09, 12:00 (wyszukiwarka zwalnia). · newest run old-odpis",
    );
  });
});

describe("jobsStatus: one job", () => {
  it("lists its newest runs with counters, and its record", async () => {
    const runs = [
      runDoc("free-3", "krs_scrape_free", "2026-10-10T02:32:00Z", {
        finishedAt: "2026-10-10T02:42:00Z",
        counters: { failed: 0, answered: 93, empty: 2 },
      }),
      runDoc("free-2", "krs_scrape_free", "2026-10-09T19:00:00Z", {
        state: "running",
        trigger: "manual",
        finishedAt: null,
        heartbeatAt: "2026-10-09T19:05:00Z",
        phase: "kolejka",
      }),
      runDoc("free-1", "krs_scrape_free", "2026-10-09T02:32:00Z"),
      runDoc("other", "krs_scrape_paid", "2026-10-10T03:05:00Z"),
    ];
    const { reports, calls } = memoryReports(runs, [
      recordDoc("krs_scrape_free", {
        lastRunId: "free-3",
        lastStartedAt: "2026-10-10T02:32:00.000000Z",
        lastScheduledAt: "2026-10-10T02:32:00Z",
        lastSucceededAt: "2026-10-10T02:42:00Z",
      }),
    ]);
    const text = await jobsStatus(
      reports,
      {
        job: "https://koryta.pl/admin/procesy#proces-krs_scrape_free",
        runs: 2,
      },
      NOW,
    );
    expect(calls).toEqual(["runsOf krs_scrape_free", "records"]);
    expect(text).toContain("on the 3 runs reported under it");
    expect(text).toContain("Health: ok - Ostatnio udane: 04:42.");
    expect(text).toContain(
      "Record (jobs/krs_scrape_free): last run free-3, started 2026-10-10 04:32; last on its schedule 2026-10-10 04:32; last succeeded 2026-10-10 04:42.",
    );
    expect(text).toContain("## Newest 2 runs");
    expect(text).toContain(
      "- free-3 · succeeded (schedule) · on koryta@koryta-nightly · started 2026-10-10 04:32, took 10 min · counters: answered 93, empty 2, failed 0",
    );
    expect(text).toContain(
      "- free-2 · running (manual), gone quiet - stalled · on koryta@koryta-nightly · started 2026-10-09 21:00, going for 12 h, last heard from 11 h 55 min ago · phase kolejka",
    );
    expect(text).not.toContain("free-1 ·");
    expect(text).not.toContain("- other");
  });

  it("refuses a job nobody knows, and names the ones there are", async () => {
    const { reports } = memoryReports([]);
    await expect(jobsStatus(reports, { job: "nope" }, NOW)).rejects.toThrow(
      /There is no job nope: .* The jobs: capture_extraction, company_import/,
    );
  });
});

describe("jobsStatus: one run", () => {
  it("gives the run whole, without the uid of whoever asked for it", async () => {
    const asked = runDoc("req-1", "people_request", "2026-10-10T12:05:00Z", {
      trigger: "request",
      finishedAt: "2026-10-10T12:09:30Z",
      counters: { matched: 65, created: 38 },
      errors: ["one", "two"],
      title: "KARKONOSKA AGENCJA ROZWOJU REGIONALNEGO",
      request: {
        target: "company",
        nodeId: "abc",
        name: "KARKONOSKA AGENCJA ROZWOJU REGIONALNEGO",
        krs: "0000012345",
        dryRun: false,
        by: "uid-of-the-owner",
        byName: "Szymon",
        at: "2026-10-10T12:04:59.123456Z",
      },
    });
    const { reports } = memoryReports([asked]);
    const answer = JSON.parse(
      await jobsStatus(
        reports,
        { run: "https://koryta.pl/admin/procesy#przebieg-req-1" },
        NOW,
      ),
    );
    expect(answer.run).toMatchObject({
      runLink: "https://koryta.pl/admin/procesy#przebieg-req-1",
      jobTitle: "Wysyłka osób na żądanie",
      id: "req-1",
      state: "succeeded",
      counters: { matched: 65, created: 38 },
      errors: ["one", "two"],
      status: "succeeded (request)",
      stalled: false,
      timing: "started 2026-10-10 14:05, took 5 min",
      request: { byName: "Szymon", at: "2026-10-10T12:04:59.123Z" },
    });
    expect(JSON.stringify(answer)).not.toContain("uid-of-the-owner");
  });

  it("says so when there is no such run, or it cannot be read", async () => {
    const { reports } = memoryReports([
      { id: "junk", data: { state: "running" } },
    ]);
    expect(await jobsStatus(reports, { run: "jobRuns/nope" }, NOW)).toMatch(
      /^There is no run nope in jobRuns \(memory\)\./,
    );
    const junk = JSON.parse(await jobsStatus(reports, { run: "junk" }, NOW));
    expect(junk.problem).toMatch(/no job, state or start time/);
    expect(junk.data).toEqual({ state: "running" });
  });

  it("keeps the uid out of a run it cannot read, too", async () => {
    // A request the site queued, whose start time a job overwrote with
    // something Date cannot read: handed on as stored, minus who asked.
    const { reports } = memoryReports([
      {
        id: "req-junk",
        data: {
          job: "people_request",
          state: "queued",
          startedAt: "soon",
          request: { nodeId: "abc", by: "uid-of-the-owner", byName: "Szymon" },
        },
      },
    ]);
    const text = await jobsStatus(reports, { run: "req-junk" }, NOW);
    expect(text).not.toContain("uid-of-the-owner");
    expect(JSON.parse(text).data.request).toEqual({
      nodeId: "abc",
      byName: "Szymon",
    });
  });

  it("takes a job or a run, not both", async () => {
    const { reports } = memoryReports([]);
    await expect(
      jobsStatus(reports, { job: "nightly", run: "x" }, NOW),
    ).rejects.toThrow("Give `job` or `run`, not both.");
  });
});

describe("helpers", () => {
  it("reads ids out of the page's links", () => {
    expect(jobIdFrom(" https://koryta.pl/admin/procesy#proces-nightly ")).toBe(
      "nightly",
    );
    expect(runIdFrom("/admin/procesy#przebieg-06ac9a33")).toBe("06ac9a33");
    expect(runIdFrom("jobRuns/06ac9a33")).toBe("06ac9a33");
  });

  it("writes Warsaw time with its day, and durations in English", () => {
    expect(warsawStamp("2026-10-09T22:30:00Z")).toBe("2026-10-10 00:30");
    expect(warsawStamp("2026-12-01T03:30:00Z")).toBe("2026-12-01 04:30");
    expect(duration(20_000)).toBe("under a minute");
    expect(duration(12 * 60_000)).toBe("12 min");
    expect(duration(125 * 60_000)).toBe("2 h 5 min");
    expect(duration(72 * 3_600_000)).toBe("3 days");
  });
});

describe("restJobReports", () => {
  const DOCUMENTS = "projects/koryta-pl/databases/agent-tasks/documents";

  function fakeFetch(
    reply: (url: string) => { status?: number; body: unknown },
  ) {
    const calls: { url: string; body: unknown }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const { status = 200, body } = reply(url);
      return new Response(JSON.stringify(body), { status });
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
  }

  const reports = (fetch: typeof globalThis.fetch) =>
    restJobReports({
      origin: "https://firestore.test",
      token: async () => "t0k3n",
      source: "the test database",
      fetch,
    });

  const stored = {
    name: `${DOCUMENTS}/jobRuns/r1`,
    fields: {
      job: { stringValue: "nightly" },
      startedAt: { timestampValue: "2026-10-10T02:30:08.240123Z" },
      counters: { mapValue: { fields: { udane: { integerValue: "9" } } } },
    },
  };

  it("reads the newest runs, newest first by start", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: [{ document: stored }, { readTime: "2026-10-10T07:00:00Z" }],
    }));
    expect(await reports(fetch).recentRuns(300)).toEqual([
      {
        id: "r1",
        data: {
          job: "nightly",
          startedAt: "2026-10-10T02:30:08.240123Z",
          counters: { udane: 9 },
        },
      },
    ]);
    expect(calls[0]!.url).toBe(
      `https://firestore.test/v1/${DOCUMENTS}:runQuery`,
    );
    expect(calls[0]!.body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "jobRuns" }],
        orderBy: [
          { field: { fieldPath: "startedAt" }, direction: "DESCENDING" },
        ],
        limit: 300,
      },
    });
  });

  it("reads one job's runs by equality alone, which needs no composite index", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    await reports(fetch).runsOf("krs_scrape_free");
    expect(calls[0]!.body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "jobRuns" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "job" },
            op: "EQUAL",
            value: { stringValue: "krs_scrape_free" },
          },
        },
      },
    });
  });

  it("reads runs by id, and every record", async () => {
    const { fetch, calls } = fakeFetch((url) => ({
      body: url.endsWith(":batchGet")
        ? [{ found: stored }, { missing: `${DOCUMENTS}/jobRuns/gone` }]
        : [],
    }));
    const store = reports(fetch);
    expect(await store.runs([])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await store.runs(["r1", "gone"])).map((doc) => doc.id)).toEqual([
      "r1",
    ]);
    expect(calls[0]!.body).toEqual({
      documents: [`${DOCUMENTS}/jobRuns/r1`, `${DOCUMENTS}/jobRuns/gone`],
    });
    await store.records();
    expect(calls[1]!.body).toEqual({
      structuredQuery: { from: [{ collectionId: "jobs" }] },
    });
    await expect(store.runs(["../tasks/x"])).rejects.toThrow(
      'Not a run id: "../tasks/x"',
    );
  });

  it("says what to do when the account cannot read", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 403,
      body: { error: { message: "Missing or insufficient permissions" } },
    }));
    await expect(reports(fetch).records()).rejects.toThrow(
      /403: Missing or insufficient permissions\..*Agent tools/,
    );
  });

  it("shares one connection with the tasks, and goes to the emulator when one is named", () => {
    const connection = opsConnection({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    expect(restJobReports(connection).source).toBe(
      "the Firestore emulator at 127.0.0.1:8080 (database agent-tasks)",
    );
  });
});
