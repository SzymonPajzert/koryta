import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import ProcesyPage from "../../../app/pages/admin/procesy.vue";
import { NO_RUNS_YET } from "../../../app/utils/jobStyle";
import type { JobRun, JobsOverview } from "../../../shared/jobs";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: { value: { uid: "owner" } },
    isAdmin: { value: true },
    isOwner: { value: true },
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** 12:00 in Warsaw. */
const NOW = new Date("2026-10-02T10:00:00.000Z");

const run = (overrides: Partial<JobRun> & Pick<JobRun, "id" | "job">) =>
  ({
    state: "succeeded",
    trigger: null,
    host: null,
    startedAt: "2026-10-02T08:00:00.000Z",
    heartbeatAt: "2026-10-02T08:00:00.000Z",
    finishedAt: null,
    progress: null,
    counters: {},
    phase: null,
    stopReason: null,
    errors: [],
    exitCode: null,
    summaryPath: null,
    version: null,
    ...overrides,
  }) satisfies JobRun;

const overview = (): JobsOverview => ({
  generatedAt: NOW.toISOString(),
  jobs: [
    {
      id: "capture_extraction",
      record: null,
      captureStats: {
        since: "2026-09-25T10:00:00.000Z",
        byState: {
          queued: 1,
          running: 0,
          succeeded: 12,
          partial: 0,
          failed: 2,
        },
      },
      runs: [
        // Nobody has picked it up for half an hour: stuck.
        run({
          id: "c-stuck",
          job: "capture_extraction",
          state: "queued",
          trigger: "event",
          host: "rozszerzenie",
          startedAt: "2026-10-02T09:30:00.000Z",
          heartbeatAt: "2026-10-02T09:30:00.000Z",
          title: "Rada nadzorcza wymieniona",
          url: "https://example.pl/rada",
          link: null,
        }),
        run({
          id: "c-done",
          job: "capture_extraction",
          state: "succeeded",
          trigger: "event",
          host: "rozszerzenie",
          startedAt: "2026-10-02T09:00:00.000Z",
          heartbeatAt: "2026-10-02T09:02:00.000Z",
          finishedAt: "2026-10-02T09:02:00.000Z",
          counters: { facts: 3 },
          title: "Prezes spółki miejskiej",
          url: "https://example.pl/prezes",
          link: "/ekstrakcje?article=https%3A%2F%2Fexample.pl%2Fprezes",
        }),
        run({
          id: "c-error",
          job: "capture_extraction",
          state: "failed",
          trigger: "event",
          host: "wklejone na /zrodla",
          startedAt: "2026-10-02T08:00:00.000Z",
          finishedAt: "2026-10-02T08:01:00.000Z",
          errors: ["Model nie odpowiedział w 30 s"],
          title: "Wywiad z wójtem",
          url: "https://example.pl/wojt",
          link: null,
        }),
      ],
    },
    {
      // Triggered like the captures, but a run it reported itself.
      id: "company_import",
      record: {
        lastRunId: "co-run",
        lastStartedAt: "2026-10-01T13:00:00.000Z",
        lastScheduledAt: null,
        lastSucceededAt: "2026-10-01T13:04:00.000Z",
      },
      probe: null,
      runs: [
        run({
          id: "co-run",
          job: "company_import",
          state: "succeeded",
          trigger: "manual",
          host: "romb@predator",
          startedAt: "2026-10-01T13:00:00.000Z",
          heartbeatAt: "2026-10-01T13:04:00.000Z",
          finishedAt: "2026-10-01T13:04:00.000Z",
          progress: { done: 215, total: 215, unit: "firm" },
          counters: { uploaded: 214, failed: 1, skipped: 0 },
          exitCode: 0,
        }),
      ],
    },
    {
      id: "krs_scrape_free",
      record: {
        lastRunId: "k-run",
        lastStartedAt: "2026-10-01T22:30:00.000Z",
        lastScheduledAt: "2026-10-01T22:30:00.000Z",
        lastSucceededAt: "2026-09-29T01:00:00.000Z",
      },
      probe: null,
      runs: [
        run({
          id: "k-run",
          job: "krs_scrape_free",
          state: "running",
          trigger: "schedule",
          host: "cloud-run:krs-scrape-free/abc",
          startedAt: "2026-10-01T22:30:00.000Z",
          heartbeatAt: "2026-10-02T09:59:00.000Z",
          progress: { done: 1200, total: 5000, unit: "firm" },
          counters: { answered: 1100, empty: 100 },
          phase: "odpisy",
        }),
        run({
          id: "k-old",
          job: "krs_scrape_free",
          state: "partial",
          trigger: "schedule",
          host: "cloud-run:krs-scrape-free/xyz",
          startedAt: "2026-09-30T22:30:00.000Z",
          heartbeatAt: "2026-10-01T01:20:00.000Z",
          finishedAt: "2026-10-01T01:20:00.000Z",
          stopReason: "deadline",
          exitCode: 75,
        }),
      ],
    },
    {
      id: "krs_scrape_paid",
      record: {
        lastRunId: "p-run",
        lastStartedAt: "2026-10-01T15:00:00.000Z",
        lastScheduledAt: null,
        lastSucceededAt: null,
      },
      probe: null,
      runs: [
        run({
          id: "p-run",
          job: "krs_scrape_paid",
          state: "failed",
          trigger: "manual",
          host: "predator",
          startedAt: "2026-10-01T15:00:00.000Z",
          heartbeatAt: "2026-10-01T15:20:00.000Z",
          finishedAt: "2026-10-01T15:20:00.000Z",
          counters: { bought: 12, pln: 0.6, pln_planned: 2 },
          stopReason: "20 requests in a row failed",
          errors: ["HTTP 429 Too Many Requests", "HTTP 429 Too Many Requests"],
          exitCode: 75,
          summaryPath:
            "gs://koryta-pl-sharedcache/jobs/krs_scrape_paid/runs/date=2026-10-01/p-run.json",
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
            through: "2026-09-20",
            archivedAt: "2026-09-21T03:00:00.000Z",
            bytes: 123_456_789,
          },
          {
            host: "api-krs.ms.gov.pl",
            through: "2026-09-30",
            archivedAt: "2026-10-01T03:00:00.000Z",
            bytes: 1_048_576,
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
          folder: "date=2026-10-02T02:00:01_12345",
          startedAt: "2026-10-02T02:00:01.000Z",
          finishedAt: "2026-10-02T02:07:30.000Z",
        },
      },
    },
    { id: "article_crawl", record: null, runs: [], probe: null },
  ],
  others: [
    {
      id: "people_upload",
      record: null,
      runs: [
        run({
          id: "u1",
          job: "people_upload",
          state: "succeeded",
          trigger: "manual",
          host: "predator",
          startedAt: "2026-10-02T07:00:00.000Z",
          heartbeatAt: "2026-10-02T07:30:00.000Z",
          finishedAt: "2026-10-02T07:30:00.000Z",
        }),
      ],
    },
  ],
  problems: ["Nie udało się wczytać zgłoszonych uruchomień: test"],
});

type JobViewOf = JobsOverview["jobs"][number];

/** One job's view in an overview, by id: the server sends them in `JOBS`
 * order, which moves whenever a job is added. */
const viewOf = (data: JobsOverview, id: string): JobViewOf =>
  data.jobs.find((job) => job.id === id)!;

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>;

const rowOf = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-job="${id}"]`);
const isOpen = (wrapper: Wrapper, id: string) =>
  rowOf(wrapper, id).find("[data-row-panel]").exists();

let visibility: DocumentVisibilityState = "visible";
let wrapper: Wrapper | null = null;

async function mountPage() {
  wrapper = await mountSuspended(ProcesyPage);
  await flushPromises();
  return wrapper;
}

describe("/admin/procesy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Date for the health logic, the intervals for the poll and the clock;
    // timeouts stay real so the promises the page awaits still settle.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    mockAuthRequest.mockImplementation(async () => overview());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    // Back to the environment's own getter, for whatever runs next.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("asks the owner's endpoint for the overview", async () => {
    await mountPage();
    expect(mockAuthRequest).toHaveBeenCalledWith("/api/ops/jobs", {
      method: "GET",
    });
  });

  it("lists one section per kind, in order, then the unknown jobs", async () => {
    const page = await mountPage();
    const sections = page.findAll("section[data-kind]");
    expect(sections.map((s) => s.attributes("data-kind"))).toEqual([
      "triggered",
      "scheduled",
      "ongoing",
      "others",
    ]);
    const jobsIn = (kind: string) =>
      page
        .findAll(`section[data-kind="${kind}"] [data-job]`)
        .map((row) => row.attributes("data-job"));
    expect(jobsIn("triggered")).toEqual([
      "capture_extraction",
      "company_import",
      "score_import",
      "extraction_import",
    ]);
    expect(jobsIn("scheduled")).toEqual([
      "nightly",
      "krs_scrape_free",
      "krs_scrape_paid",
      "krs_odpis",
      "krs_register_owners",
      "compressor",
      "firestore_export",
      "people_import",
    ]);
    expect(jobsIn("ongoing")).toEqual(["article_crawl"]);
    expect(jobsIn("others")).toEqual(["people_upload"]);
    expect(page.get('section[data-kind="scheduled"]').text()).toContain(
      "Według harmonogramu",
    );
  });

  it("judges every job", async () => {
    const page = await mountPage();
    const health = Object.fromEntries(
      page
        .findAll("[data-job]")
        .map((row) => [
          row.attributes("data-job"),
          row.attributes("data-health"),
        ]),
    );
    expect(health).toEqual({
      capture_extraction: "stalled",
      // By its own newest run, not as captures.
      company_import: "ok",
      krs_scrape_free: "running",
      krs_scrape_paid: "failed",
      // Registered, and nothing in the overview for them.
      score_import: "never",
      extraction_import: "never",
      krs_odpis: "never",
      krs_register_owners: "never",
      nightly: "never",
      people_import: "never",
      compressor: "stale",
      firestore_export: "ok",
      article_crawl: "never",
      // Unknown, and started by hand: read like a scheduled job with no
      // schedule, so a finished run is simply done.
      people_upload: "ok",
    });
  });

  it("counts the problems in the block on top and names them", async () => {
    const page = await mountPage();
    const focus = page.get("[data-problem-count]");
    expect(focus.attributes("data-count")).toBe("3");
    expect(focus.text()).toContain("procesy wymagają uwagi");
    expect(focus.classes()).toContain("bg-ink-danger");
    // Worst first: stalled, then failed, then stale.
    expect(focus.findAll("a").map((a) => a.text())).toEqual([
      "Zapis artykułu z rozszerzenia",
      "Zapytania do rejestr.io (płatne)",
      "Kompresja lustra KRS",
    ]);
    expect(focus.get("a").attributes("href")).toBe(
      "#proces-capture_extraction",
    );

    // Number over label, two blocks: read as "count label".
    const stat = (status: string) =>
      page
        .get(`[data-stat="${status}"]`)
        .findAll("span")
        .map((part) => part.text())
        .join(" ");
    expect(stat("running")).toBe("1 w toku");
    expect(stat("ok")).toBe("3 działa");
    expect(stat("never")).toBe("7 brak raportów");
    // Only the counts that happen to be non-zero beyond the three always shown.
    expect(page.find('[data-stat="stopped"]').exists()).toBe(false);
    expect(page.find('[data-stat="partial"]').exists()).toBe(false);
    expect(page.get("[data-loaded-at]").text()).toBe("Odświeżono 12:00");
  });

  it("goes amber when the worst is a mirror falling behind, and green when nothing is", async () => {
    // Everything fixed but the compressor's mirror.
    const calmer = () => {
      const data = overview();
      const captures = viewOf(data, "capture_extraction");
      const paid = viewOf(data, "krs_scrape_paid");
      captures.runs = captures.runs.filter((r) => r.id !== "c-stuck");
      paid.runs = paid.runs.map((r) => ({ ...r, state: "succeeded" }));
      return data;
    };
    mockAuthRequest.mockImplementation(async () => calmer());
    let page = await mountPage();
    let focus = page.get("[data-problem-count]");
    expect(focus.classes()).toContain("bg-ink-warning");
    expect(focus.text()).toContain("1");
    expect(focus.text()).toContain("proces wymaga uwagi");
    page.unmount();

    mockAuthRequest.mockImplementation(async () => {
      const data = calmer();
      const mirror = viewOf(data, "compressor").probe as Extract<
        NonNullable<JobViewOf["probe"]>,
        { kind: "compressedMirror" }
      >;
      mirror.hosts[0]!.through = "2026-10-01";
      return data;
    });
    page = await mountPage();
    focus = page.get("[data-problem-count]");
    expect(focus.attributes("data-count")).toBe("0");
    expect(focus.classes()).toContain("bg-ink-success");
    expect(focus.text()).toBe("Nic nie wymaga uwagi");
    expect(page.find("[data-row-panel]").exists()).toBe(false);
  });

  it("shows what the server could not read", async () => {
    const page = await mountPage();
    expect(page.get("[data-jobs-problem]").text()).toContain(
      "Nie udało się wczytać zgłoszonych uruchomień",
    );
  });

  it("opens the rows that need a look and leaves the rest shut", async () => {
    const page = await mountPage();
    expect(isOpen(page, "capture_extraction")).toBe(true);
    expect(isOpen(page, "krs_scrape_paid")).toBe(true);
    expect(isOpen(page, "compressor")).toBe(true);
    expect(isOpen(page, "krs_scrape_free")).toBe(false);
    expect(isOpen(page, "company_import")).toBe(false);
    expect(isOpen(page, "firestore_export")).toBe(false);
    expect(isOpen(page, "article_crawl")).toBe(false);
    expect(isOpen(page, "people_upload")).toBe(false);
  });

  it("shows a running job's progress and when it runs next", async () => {
    const page = await mountPage();
    const row = rowOf(page, "krs_scrape_free");
    expect(row.get("[data-row-progress]").text()).toBe("1200/5000 firm");
    expect(row.get('[role="progressbar"]').attributes("aria-valuenow")).toBe(
      "24",
    );
    expect(row.get("[data-health-detail]").text()).toBe(
      "Trwa od 00:30 - odpisy.",
    );
    expect(row.get("[data-row-next]").text()).toBe("następne: 3.10, 00:30");

    await row.get("[data-row-toggle]").trigger("click");
    const runs = row.findAll("[data-run]").map((r) => r.attributes("data-run"));
    expect(runs).toEqual(["k-run", "k-old"]);
    const live = row.get('[data-run="k-run"]');
    expect(live.get("[data-run-chip]").text()).toBe("trwa");
    expect(live.get("[data-run-progress]").text()).toBe("1200 z 5000 firm");
    expect(live.findAll("[data-run-counter]").map((c) => c.text())).toEqual([
      "z odpowiedzią: 1100",
      "puste: 100",
    ]);
    const old = row.get('[data-run="k-old"]');
    expect(old.get("[data-run-chip]").text()).toBe("niedokończony");
    expect(old.get("[data-run-stop-reason]").text()).toBe("powód: deadline");
    expect(old.get("[data-run-exit]").text()).toBe("kod wyjścia 75");
    expect(row.text()).toContain("codziennie o 00:30 czasu warszawskiego");
    expect(row.text()).not.toContain("jeszcze nie uruchomiony");
  });

  it("lays a failed run's errors, counters and record open", async () => {
    const page = await mountPage();
    const row = rowOf(page, "krs_scrape_paid");
    expect(row.get("[data-row-unscheduled]").text()).toBe(
      "jeszcze bez harmonogramu",
    );
    expect(row.get("[data-fact-succeeded]").text()).toContain("jeszcze nigdy");
    expect(row.text()).toContain("koryta_scrape_krs_paid");
    const failed = row.get('[data-run="p-run"]');
    expect(failed.get("[data-run-chip]").text()).toBe("błąd");
    expect(failed.text()).toContain("ręcznie");
    expect(failed.findAll("[data-run-counter]").map((c) => c.text())).toEqual([
      "kupionych: 12",
      "zł: 0,60",
      "zł w planie: 2,00",
    ]);
    // The newest run failed, so its errors are what the row was opened for.
    expect(failed.findAll("[data-run-errors] li")).toHaveLength(2);
    await failed.get("[data-run-errors-toggle]").trigger("click");
    expect(failed.find("[data-run-errors]").exists()).toBe(false);
    expect(failed.get("[data-run-summary-path]").text()).toBe(
      "gs://koryta-pl-sharedcache/jobs/krs_scrape_paid/runs/date=2026-10-01/p-run.json",
    );
    // Tasks link to the owner's list, by id.
    const task = row.get("[data-job-tasks] a");
    expect(task.attributes("href")).toBe(
      "/admin/zadania#t-decide-rejestrio-budget",
    );
  });

  it("shows the stale mirror host by host, and where the state comes from", async () => {
    const page = await mountPage();
    const row = rowOf(page, "compressor");
    expect(row.get("[data-health-detail]").text()).toContain(
      "Lustro do 2026-09-20 (rejestr.io)",
    );
    const host = row.get('[data-mirror-host="rejestr.io"]').text();
    expect(host).toContain("lustro do 2026-09-20");
    expect(host).toContain("117,7 MB");
    expect(row.get("[data-no-runs]").text()).toContain("koryta-pl-compressed");
  });

  it("shows the export's copy from the bucket, and its next night", async () => {
    const page = await mountPage();
    const row = rowOf(page, "firestore_export");
    expect(row.get("[data-row-last]").text()).toBe("04:00 · 7 min");
    expect(row.get("[data-row-next]").text()).toBe("następne: 3.10, 00:00");
    await row.get("[data-row-toggle]").trigger("click");
    expect(row.get("[data-probe]").text()).toContain(
      "date=2026-10-02T02:00:01_12345",
    );
    expect(row.text()).toContain("koniec 04:07");
  });

  it("lists captures by page, with the stuck one called out", async () => {
    const page = await mountPage();
    const row = rowOf(page, "capture_extraction");
    expect(row.get("[data-health-detail]").text()).toContain("strona utknęła");
    expect(row.get("[data-capture-stats]").text()).toBe(
      "Ostatnie 7 dni: 12 udanych · 2 błędy · 0 w toku · 1 w kolejce",
    );
    expect(row.get('[data-run="c-stuck"] [data-run-chip]').text()).toBe(
      "nikt nie podjął",
    );

    const done = row.get('[data-run="c-done"]');
    const link = done.get("[data-run-url]");
    expect(link.text()).toBe("Prezes spółki miejskiej");
    expect(link.attributes("href")).toBe("https://example.pl/prezes");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
    expect(done.get("[data-run-facts]").text()).toBe("3 fakty");
    expect(done.get("[data-run-facts]").attributes("href")).toBe(
      "/ekstrakcje?article=https%3A%2F%2Fexample.pl%2Fprezes",
    );

    const failed = row.get('[data-run="c-error"]');
    expect(failed.text()).toContain("Model nie odpowiedział w 30 s");
    expect(failed.text()).toContain("wklejone na /zrodla");
  });

  it("shows a triggered import as runs it reported, not as captures", async () => {
    const page = await mountPage();
    const row = rowOf(page, "company_import");
    expect(row.get("[data-health-detail]").text()).toBe(
      "Ostatnio udane: 1.10, 15:04.",
    );
    // When it started and how long it took, where a capture says only when.
    expect(row.get("[data-row-last]").text()).toBe("1.10, 15:00 · 4 min");
    // No schedule to have, and none missing.
    expect(row.find("[data-row-next]").exists()).toBe(false);
    expect(row.find("[data-row-unscheduled]").exists()).toBe(false);

    await row.get("[data-row-toggle]").trigger("click");
    expect(row.text()).toContain("Uruchomienia");
    expect(row.text()).not.toContain("Ostatnie zapisy");
    expect(row.find("[data-capture-stats]").exists()).toBe(false);
    expect(row.get("[data-fact-succeeded]").text()).toContain("1.10, 15:04");
    expect(row.text()).toContain(
      "koryta CompaniesPayloads --output stdout | koryta_uploader --type company --submit",
    );

    const done = row.get('[data-run="co-run"]');
    expect(done.find("[data-run-url]").exists()).toBe(false);
    expect(done.get("[data-run-chip]").text()).toBe("udany");
    expect(done.text()).toContain("ręcznie");
    expect(done.get("[data-run-progress]").text()).toBe("215 z 215 firm");
    expect(done.findAll("[data-run-counter]").map((c) => c.text())).toEqual([
      "wysłanych: 214",
      "nieudane: 1",
      "pominiętych: 0",
    ]);
  });

  it("says a job that has never reported will report itself", async () => {
    const page = await mountPage();
    // An import too: "nobody has captured anything" is the captures' line.
    for (const id of ["article_crawl", "score_import"]) {
      const row = rowOf(page, id);
      await row.get("[data-row-toggle]").trigger("click");
      expect(row.get("[data-no-runs]").text(), id).toBe(NO_RUNS_YET);
    }
  });

  it("shows an unknown job under its id", async () => {
    const page = await mountPage();
    const row = rowOf(page, "people_upload");
    expect(row.get("[data-row-toggle]").text()).toContain("people_upload");
    await row.get("[data-row-toggle]").trigger("click");
    expect(row.find('[data-run="u1"]').exists()).toBe(true);
  });

  it("polls once a minute while the tab is in front, and not while hidden", async () => {
    await mountPage();
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(180_000);
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(2);

    // Back in front: at once, not at the next tick.
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(3);
  });

  it("turns a quiet run into a stalled one as the clock moves, and opens it", async () => {
    const page = await mountPage();
    expect(rowOf(page, "krs_scrape_free").attributes("data-health")).toBe(
      "running",
    );
    // The heartbeat was at 11:59 Warsaw time with fifteen minutes allowed.
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    await flushPromises();
    const row = rowOf(page, "krs_scrape_free");
    expect(row.attributes("data-health")).toBe("stalled");
    expect(isOpen(page, "krs_scrape_free")).toBe(true);
    expect(row.get("[data-health-chip]").text()).toBe("Bez sygnału");
    expect(page.get("[data-problem-count]").attributes("data-count")).toBe("4");
  });

  it("does not age a hidden tab's data into false alarms", async () => {
    const page = await mountPage();
    // Hidden, the page asks nothing, so what it has is twenty minutes old
    // by the end: judged as of when it was read, the scrape is still going.
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    await flushPromises();
    expect(rowOf(page, "krs_scrape_free").attributes("data-health")).toBe(
      "running",
    );
    expect(isOpen(page, "krs_scrape_free")).toBe(false);
  });

  it("keeps what it last knew when a refresh fails", async () => {
    const page = await mountPage();
    mockAuthRequest.mockRejectedValueOnce(new Error("offline"));
    await page.get("[data-jobs-refresh]").trigger("click");
    await flushPromises();
    expect(page.text()).toContain("Nie udało się odświeżyć procesów: offline");
    expect(page.findAll("[data-job]")).toHaveLength(14);
  });

  it("says so when the first load fails", async () => {
    mockAuthRequest.mockRejectedValue(new Error("403"));
    const page = await mountPage();
    expect(page.text()).toContain("Nie udało się wczytać procesów: 403");
    expect(page.find("[data-job]").exists()).toBe(false);
  });
});
