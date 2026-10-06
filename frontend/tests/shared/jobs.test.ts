// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  JOBS,
  JOB_KINDS,
  RUN_ERRORS_KEPT,
  RUN_ERROR_CHARS,
  WARSAW,
  captureRun,
  compareRunsNewest,
  formatDuration,
  isProblem,
  isStalled,
  jobDefinition,
  jobHealth,
  jobRunFromData,
  lagDays,
  mirrorWrites,
  missedSlot,
  nextSlot,
  previousSlot,
  runAnchor,
  runLink,
  scheduleIsLive,
  shortWarsawTime,
  taskLink,
  zoneOffsetMinutes,
  zonedDay,
  zonedTime,
  type JobDefinition,
  type JobRecord,
  type JobRun,
  type JobSchedule,
  type ProbeResult,
} from "../../shared/jobs";
import type { ArticleCapture } from "../../shared/capture";

/** Every instant here is spelled out: the logic is about wall clocks in
 * Warsaw, and a test that read the real clock would pass or fail by season. */
const at = (iso: string) => new Date(iso);
const isoOf = (date: Date | null) => date?.toISOString() ?? null;

const NIGHTLY: JobSchedule = { dailyAt: "00:30", timeZone: WARSAW };
const MORNING: JobSchedule = { dailyAt: "04:00", timeZone: WARSAW };

function definition(fields: Partial<JobDefinition> = {}): JobDefinition {
  return {
    id: "nightly",
    kind: "scheduled",
    title: "Nocny",
    summary: "",
    runsOn: "",
    schedule: NIGHTLY,
    heartbeatMinutes: 15,
    graceMinutes: 60,
    ...fields,
  };
}

function run(
  fields: Partial<JobRun> & Pick<JobRun, "state" | "startedAt">,
): JobRun {
  return {
    id: `run-${fields.startedAt}`,
    job: "nightly",
    trigger: "schedule",
    host: "cloud-run:krs-scrape-free/abc",
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

const LIVE: JobRecord = {
  lastRunId: null,
  lastStartedAt: null,
  lastScheduledAt: "2026-09-30T22:30:00.000Z",
  lastSucceededAt: null,
};

describe("zoneOffsetMinutes", () => {
  it("is two hours in a Warsaw summer and one in its winter", () => {
    expect(zoneOffsetMinutes(at("2026-07-15T12:00:00Z"), WARSAW)).toBe(120);
    expect(zoneOffsetMinutes(at("2026-01-15T12:00:00Z"), WARSAW)).toBe(60);
    expect(zoneOffsetMinutes(at("2026-07-15T12:00:00.999Z"), WARSAW)).toBe(120);
    expect(zoneOffsetMinutes(at("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("changes at 01:00 UTC on the last Sundays of March and October", () => {
    expect(zoneOffsetMinutes(at("2026-10-25T00:59:59Z"), WARSAW)).toBe(120);
    expect(zoneOffsetMinutes(at("2026-10-25T01:00:00Z"), WARSAW)).toBe(60);
    expect(zoneOffsetMinutes(at("2026-03-29T00:59:59Z"), WARSAW)).toBe(60);
    expect(zoneOffsetMinutes(at("2026-03-29T01:00:00Z"), WARSAW)).toBe(120);
  });
});

describe("zonedTime", () => {
  it("turns a Warsaw wall-clock time into its instant, summer and winter", () => {
    expect(isoOf(zonedTime("2026-07-15", "00:30", WARSAW))).toBe(
      "2026-07-14T22:30:00.000Z",
    );
    expect(isoOf(zonedTime("2026-01-15", "04:00", WARSAW))).toBe(
      "2026-01-15T03:00:00.000Z",
    );
    // Already the next day in Warsaw while UTC is still on the previous one.
    expect(isoOf(zonedTime("2026-10-03", "00:15", WARSAW))).toBe(
      "2026-10-02T22:15:00.000Z",
    );
  });

  it("uses the offset in force at the answer on the days the clocks change", () => {
    // 25 October: 00:30 is still summer time, 04:00 already winter time.
    expect(isoOf(zonedTime("2026-10-25", "00:30", WARSAW))).toBe(
      "2026-10-24T22:30:00.000Z",
    );
    expect(isoOf(zonedTime("2026-10-25", "04:00", WARSAW))).toBe(
      "2026-10-25T03:00:00.000Z",
    );
    expect(isoOf(zonedTime("2026-10-26", "00:30", WARSAW))).toBe(
      "2026-10-25T23:30:00.000Z",
    );
    // 29 March: 00:30 is still winter time, 04:00 already summer time.
    expect(isoOf(zonedTime("2026-03-29", "00:30", WARSAW))).toBe(
      "2026-03-28T23:30:00.000Z",
    );
    expect(isoOf(zonedTime("2026-03-29", "04:00", WARSAW))).toBe(
      "2026-03-29T02:00:00.000Z",
    );
  });

  it("names the Warsaw calendar day of an instant", () => {
    expect(zonedDay(at("2026-10-02T21:59:59Z"), WARSAW)).toBe("2026-10-02");
    expect(zonedDay(at("2026-10-02T22:15:00Z"), WARSAW)).toBe("2026-10-03");
    expect(zonedDay(at("2026-01-15T23:00:00Z"), WARSAW)).toBe("2026-01-16");
  });
});

describe("previousSlot / nextSlot", () => {
  const slots = (schedule: JobSchedule, now: string) => [
    isoOf(previousSlot(schedule, at(now))),
    isoOf(nextSlot(schedule, at(now))),
  ];

  it("counts a slot as passed from its very minute", () => {
    // 00:30 in Warsaw on 3 October is 22:30 UTC on the 2nd.
    expect(slots(NIGHTLY, "2026-10-02T22:30:00Z")).toEqual([
      "2026-10-02T22:30:00.000Z",
      "2026-10-03T22:30:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-10-02T22:29:59Z")).toEqual([
      "2026-10-01T22:30:00.000Z",
      "2026-10-02T22:30:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-10-02T22:30:01Z")).toEqual([
      "2026-10-02T22:30:00.000Z",
      "2026-10-03T22:30:00.000Z",
    ]);
    expect(slots(MORNING, "2026-10-02T02:00:00Z")).toEqual([
      "2026-10-02T02:00:00.000Z",
      "2026-10-03T02:00:00.000Z",
    ]);
    expect(slots(MORNING, "2026-10-02T01:59:59Z")).toEqual([
      "2026-10-01T02:00:00.000Z",
      "2026-10-02T02:00:00.000Z",
    ]);
    expect(slots(MORNING, "2026-10-02T02:00:01Z")).toEqual([
      "2026-10-02T02:00:00.000Z",
      "2026-10-03T02:00:00.000Z",
    ]);
  });

  it("goes by the Warsaw day around UTC midnight", () => {
    // 00:15 in Warsaw on the 3rd: tonight's 00:30 is still to come.
    expect(slots(NIGHTLY, "2026-10-02T22:15:00Z")).toEqual([
      "2026-10-01T22:30:00.000Z",
      "2026-10-02T22:30:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-10-02T23:59:00Z")).toEqual([
      "2026-10-02T22:30:00.000Z",
      "2026-10-03T22:30:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-10-03T00:01:00Z")).toEqual([
      "2026-10-02T22:30:00.000Z",
      "2026-10-03T22:30:00.000Z",
    ]);
    // 01:00 in Warsaw on the 3rd: that day's 04:00 is still to come.
    expect(slots(MORNING, "2026-10-02T23:00:00Z")).toEqual([
      "2026-10-02T02:00:00.000Z",
      "2026-10-03T02:00:00.000Z",
    ]);
  });

  it("keeps the wall-clock time across the clock changes", () => {
    expect(slots(MORNING, "2026-10-24T12:00:00Z")).toEqual([
      "2026-10-24T02:00:00.000Z",
      "2026-10-25T03:00:00.000Z",
    ]);
    expect(slots(MORNING, "2026-10-25T12:00:00Z")).toEqual([
      "2026-10-25T03:00:00.000Z",
      "2026-10-26T03:00:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-10-25T12:00:00Z")).toEqual([
      "2026-10-24T22:30:00.000Z",
      "2026-10-25T23:30:00.000Z",
    ]);
    // Inside the hour that happens twice, on either side of it.
    for (const now of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]) {
      expect(slots(MORNING, now)).toEqual([
        "2026-10-24T02:00:00.000Z",
        "2026-10-25T03:00:00.000Z",
      ]);
    }
    expect(slots(MORNING, "2026-03-29T12:00:00Z")).toEqual([
      "2026-03-29T02:00:00.000Z",
      "2026-03-30T02:00:00.000Z",
    ]);
    expect(slots(NIGHTLY, "2026-03-29T12:00:00Z")).toEqual([
      "2026-03-28T23:30:00.000Z",
      "2026-03-29T22:30:00.000Z",
    ]);
  });
});

describe("missedSlot", () => {
  const missed = (
    lastStart: string | null,
    now: string,
    grace: number | undefined = 60,
  ) => isoOf(missedSlot(NIGHTLY, grace, lastStart, at(now)));

  it("names the due slot when nothing has ever run", () => {
    // 02:00 in Warsaw on the 3rd: the 00:30 slot's hour of grace is over.
    expect(missed(null, "2026-10-03T00:00:00Z")).toBe(
      "2026-10-02T22:30:00.000Z",
    );
  });

  it("waits out the grace before calling tonight's slot missed", () => {
    const lastNight = "2026-10-01T22:30:00Z";
    expect(missed(lastNight, "2026-10-02T23:00:00Z")).toBeNull();
    expect(missed(lastNight, "2026-10-02T23:29:59Z")).toBeNull();
    expect(missed(lastNight, "2026-10-02T23:30:00Z")).toBe(
      "2026-10-02T22:30:00.000Z",
    );
    // Within the grace the slot that is due is still yesterday's.
    expect(missed(null, "2026-10-02T23:00:00Z")).toBe(
      "2026-10-01T22:30:00.000Z",
    );
  });

  it("counts a run started up to an hour early, or late", () => {
    const now = "2026-10-03T00:00:00Z";
    expect(missed("2026-10-02T21:40:00Z", now)).toBeNull(); // 50 min early
    expect(missed("2026-10-02T21:30:00Z", now)).toBeNull(); // 60 min early
    expect(missed("2026-10-02T23:15:00Z", now)).toBeNull(); // 45 min late
    expect(missed("2026-10-02T21:29:00Z", now)).toBe(
      "2026-10-02T22:30:00.000Z",
    );
  });

  it("does not count last night's run for tonight", () => {
    expect(missed("2026-10-01T22:31:00Z", "2026-10-03T00:00:00Z")).toBe(
      "2026-10-02T22:30:00.000Z",
    );
  });

  it("uses an hour of grace when the job names none", () => {
    const lastNight = "2026-10-01T22:30:00Z";
    expect(missed(lastNight, "2026-10-02T23:29:00Z", undefined)).toBeNull();
    expect(missed(lastNight, "2026-10-02T23:31:00Z", undefined)).toBe(
      "2026-10-02T22:30:00.000Z",
    );
    expect(missed(lastNight, "2026-10-02T23:01:00Z", 30)).toBe(
      "2026-10-02T22:30:00.000Z",
    );
  });

  it("finds the slot across the October clock change", () => {
    // 00:30 on the 25th is still summer time: 22:30 UTC on the 24th.
    expect(missed("2026-10-24T22:31:00Z", "2026-10-25T12:00:00Z")).toBeNull();
    expect(missed("2026-10-23T22:30:00Z", "2026-10-25T12:00:00Z")).toBe(
      "2026-10-24T22:30:00.000Z",
    );
  });
});

describe("isStalled", () => {
  const limits = { heartbeatMinutes: 35, queuedMinutes: 15 };
  const now = at("2026-10-02T12:00:00Z");
  const stalled = (
    state: JobRun["state"],
    heartbeatAt: string,
    definition: Pick<
      JobDefinition,
      "heartbeatMinutes" | "queuedMinutes"
    > = limits,
  ) => isStalled({ state, heartbeatAt }, definition, now);

  it("gives a queued run the queue's allowance", () => {
    expect(stalled("queued", "2026-10-02T11:44:00Z")).toBe(true);
    expect(stalled("queued", "2026-10-02T11:46:00Z")).toBe(false);
  });

  it("gives a running one the heartbeat's", () => {
    expect(stalled("running", "2026-10-02T11:44:00Z")).toBe(false);
    expect(stalled("running", "2026-10-02T11:25:00Z")).toBe(false);
    expect(stalled("running", "2026-10-02T11:24:00Z")).toBe(true);
  });

  it("falls back to the heartbeat for a queue with no allowance of its own", () => {
    expect(
      stalled("queued", "2026-10-02T11:44:00Z", { heartbeatMinutes: 35 }),
    ).toBe(false);
  });

  it("never calls a finished run stalled", () => {
    for (const state of ["succeeded", "partial", "failed"] as const) {
      expect(stalled(state, "2026-09-01T00:00:00Z")).toBe(false);
    }
  });
});

describe("lagDays", () => {
  it("counts whole UTC days, whatever the hour in Warsaw", () => {
    expect(lagDays("2026-10-02", at("2026-10-02T12:00:00Z"))).toBe(0);
    expect(lagDays("2026-10-01", at("2026-10-02T00:00:00Z"))).toBe(1);
    // Already the 3rd in Warsaw; the compressor's days are UTC days.
    expect(lagDays("2026-10-01", at("2026-10-02T23:59:00Z"))).toBe(1);
    expect(lagDays("2026-09-28", at("2026-10-02T12:00:00Z"))).toBe(4);
    expect(lagDays("2026-10-24", at("2026-10-26T00:30:00Z"))).toBe(2);
  });
});

describe("formatDuration", () => {
  it("rounds to minutes, then hours and minutes, then days", () => {
    const MIN = 60_000;
    expect(formatDuration(-5 * MIN)).toBe("< 1 min");
    expect(formatDuration(0)).toBe("< 1 min");
    expect(formatDuration(29_999)).toBe("< 1 min");
    expect(formatDuration(30_000)).toBe("1 min");
    expect(formatDuration(59 * MIN)).toBe("59 min");
    expect(formatDuration(59.5 * MIN)).toBe("1 h");
    expect(formatDuration(60 * MIN)).toBe("1 h");
    expect(formatDuration(125 * MIN)).toBe("2 h 5 min");
    expect(formatDuration((47 * 60 + 59) * MIN)).toBe("47 h 59 min");
    expect(formatDuration(48 * 60 * MIN)).toBe("2 dni");
    expect(formatDuration((71 * 60 + 59) * MIN)).toBe("2 dni");
    expect(formatDuration(72 * 60 * MIN)).toBe("3 dni");
  });
});

describe("shortWarsawTime", () => {
  const now = at("2026-10-02T10:00:00Z");

  it("says only the time on the same Warsaw day", () => {
    expect(shortWarsawTime("2026-10-02T12:05:00Z", now)).toBe("14:05");
    // The previous UTC day, but already the 2nd in Warsaw.
    expect(shortWarsawTime("2026-10-01T22:30:00Z", now)).toBe("00:30");
    expect(
      shortWarsawTime("2026-12-02T03:00:00Z", at("2026-12-02T10:00:00Z")),
    ).toBe("04:00");
  });

  it("adds the day on any other", () => {
    expect(shortWarsawTime("2026-10-01T12:05:00Z", now)).toBe("1.10, 14:05");
    // Still the 2nd in UTC, already the 3rd in Warsaw.
    expect(shortWarsawTime("2026-10-02T22:15:00Z", now)).toBe("3.10, 00:15");
  });
});

describe("jobRunFromData", () => {
  const complete = {
    job: "krs_scrape_free",
    state: "running",
    trigger: "schedule",
    host: "cloud-run:krs-scrape-free/exec-1",
    startedAt: "2026-10-02T22:30:00.000Z",
    heartbeatAt: "2026-10-02T22:41:00.000Z",
    finishedAt: null,
    progress: { done: 120, total: 400, unit: "firm" },
    counters: { answered: 118, empty: 2 },
    phase: "odpisy",
    stopReason: null,
    errors: [],
    exitCode: null,
    summaryPath: "gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/x.json",
    version: "abc123",
  };

  it("reads a complete document", () => {
    expect(jobRunFromData("r1", complete)).toEqual({
      id: "r1",
      ...complete,
    });
  });

  it("rejects a run it cannot place: no job, state or start", () => {
    const without = (field: string, value?: unknown) => ({
      ...complete,
      [field]: value,
    });
    expect(jobRunFromData("r", null)).toBeNull();
    expect(jobRunFromData("r", "running")).toBeNull();
    expect(jobRunFromData("r", without("job"))).toBeNull();
    expect(jobRunFromData("r", without("job", ""))).toBeNull();
    expect(jobRunFromData("r", without("state"))).toBeNull();
    expect(jobRunFromData("r", without("state", "done"))).toBeNull();
    expect(jobRunFromData("r", without("startedAt"))).toBeNull();
    expect(jobRunFromData("r", without("startedAt", ""))).toBeNull();
    // A Timestamp the server forgot to convert.
    expect(
      jobRunFromData("r", without("startedAt", { _seconds: 1 })),
    ).toBeNull();
  });

  it("drops a bad optional field rather than the run", () => {
    const parsed = jobRunFromData("r", {
      job: "krs_scrape_free",
      state: "failed",
      startedAt: "2026-10-02T22:30:00.000Z",
      trigger: "cron",
      host: 7,
      progress: { done: -1, total: 3, unit: "firm" },
      counters: "lots",
      phase: { name: "odpisy" },
      stopReason: 75,
      errors: "one big string",
      exitCode: 1.5,
      summaryPath: false,
      version: 3,
      unexpected: "ignored",
    });
    expect(parsed).toEqual({
      id: "r",
      job: "krs_scrape_free",
      state: "failed",
      trigger: null,
      host: null,
      startedAt: "2026-10-02T22:30:00.000Z",
      heartbeatAt: "2026-10-02T22:30:00.000Z",
      finishedAt: null,
      progress: null,
      counters: {},
      phase: null,
      stopReason: null,
      errors: [],
      exitCode: null,
      summaryPath: null,
      version: null,
    });
  });

  it("fills in a progress with no total or unit", () => {
    expect(
      jobRunFromData("r", { ...complete, progress: { done: 3 } })!.progress,
    ).toEqual({ done: 3, total: null, unit: "" });
  });

  it("keeps only the counters that are numbers", () => {
    const parsed = jobRunFromData("r", {
      ...complete,
      counters: {
        answered: 3,
        pln: 0.15,
        text: "4",
        missing: null,
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        nested: { a: 1 },
      },
    });
    expect(parsed!.counters).toEqual({ answered: 3, pln: 0.15 });
  });

  it("caps the errors it keeps, and their length", () => {
    const errors = [
      { not: "a string" },
      ...Array.from({ length: 30 }, (_, i) => `${i}:${"x".repeat(600)}`),
    ];
    const parsed = jobRunFromData("r", { ...complete, errors })!;
    expect(parsed.errors).toHaveLength(RUN_ERRORS_KEPT);
    expect(parsed.errors[0]!.startsWith("0:")).toBe(true);
    expect(
      parsed.errors.every((error) => error.length === RUN_ERROR_CHARS),
    ).toBe(true);
  });

  it("takes the last sign of life from the finish, then the start", () => {
    const finished = jobRunFromData("r", {
      ...complete,
      state: "succeeded",
      heartbeatAt: null,
      finishedAt: "2026-10-03T00:10:00.000Z",
    })!;
    expect(finished.heartbeatAt).toBe("2026-10-03T00:10:00.000Z");
    const silent = jobRunFromData("r", {
      ...complete,
      heartbeatAt: undefined,
      finishedAt: undefined,
    })!;
    expect(silent.heartbeatAt).toBe(complete.startedAt);
    expect(silent.finishedAt).toBeNull();
  });

  it("treats a time it cannot read as missing, so no status line breaks on it", () => {
    const parsed = jobRunFromData("r", {
      ...complete,
      state: "succeeded",
      heartbeatAt: "soon",
      finishedAt: "",
    })!;
    expect(parsed.heartbeatAt).toBe(complete.startedAt);
    expect(parsed.finishedAt).toBeNull();
    expect(jobRunFromData("r", { ...complete, startedAt: "today" })).toBeNull();
    // What used to throw "Invalid time value" out of the page's health line.
    expect(() =>
      jobHealth(
        definition(),
        { runs: [parsed], record: null },
        at("2026-10-03T10:00:00Z"),
      ),
    ).not.toThrow();
  });

  it("reads a parseable time in another spelling as the same instant", () => {
    const parsed = jobRunFromData("r", {
      ...complete,
      startedAt: "2026-10-02T22:30:00+00:00",
    })!;
    expect(parsed.startedAt).toBe("2026-10-02T22:30:00.000Z");
  });
});

describe("jobRunFromData: a run asked for on a page", () => {
  const asked = {
    job: "people_request",
    state: "queued",
    trigger: "request",
    startedAt: "2026-10-06T10:00:00.000Z",
    title: "Wodociągi Miejskie",
    link: "/instytucja/wodociagi-miejskie-place1",
    request: {
      target: "company",
      nodeId: "place1",
      name: "Wodociągi Miejskie",
      krs: "0000000001",
      dryRun: true,
      by: "analyst",
      at: "2026-10-06T10:00:00Z",
    },
    dispatch: {
      mode: "vm",
      at: "2026-10-06T10:00:01Z",
      ok: false,
      error: "403",
    },
  };

  it("keeps what was asked, by whom, and what came of starting the VM", () => {
    expect(jobRunFromData("r1", asked)).toMatchObject({
      trigger: "request",
      title: "Wodociągi Miejskie",
      link: "/instytucja/wodociagi-miejskie-place1",
      request: {
        target: "company",
        nodeId: "place1",
        krs: "0000000001",
        rejestrIo: null,
        dryRun: true,
        by: "analyst",
        byName: null,
        at: "2026-10-06T10:00:00.000Z",
      },
      dispatch: {
        mode: "vm",
        at: "2026-10-06T10:00:01.000Z",
        ok: false,
        error: "403",
      },
    });
  });

  it("drops a request it cannot read rather than the run", () => {
    const run = jobRunFromData("r1", {
      ...asked,
      request: { target: "region", nodeId: "x" },
      dispatch: "soon",
    });
    expect(run?.state).toBe("queued");
    expect(run).not.toHaveProperty("request");
    expect(run).not.toHaveProperty("dispatch");
  });

  it("links every run by the same anchor", () => {
    expect(runAnchor("r1")).toBe("przebieg-r1");
    expect(runLink("r1")).toBe("/admin/procesy#przebieg-r1");
  });
});

describe("compareRunsNewest", () => {
  it("puts the newest start first, and breaks ties by id", () => {
    const runs = [
      run({ id: "a", state: "succeeded", startedAt: "2026-10-01T22:30:00Z" }),
      run({ id: "b", state: "running", startedAt: "2026-10-02T22:30:00Z" }),
      run({ id: "0199a", state: "failed", startedAt: "2026-09-30T22:30:00Z" }),
      run({ id: "0199b", state: "failed", startedAt: "2026-09-30T22:30:00Z" }),
    ];
    expect(runs.sort(compareRunsNewest).map((r) => r.id)).toEqual([
      "b",
      "a",
      "0199b",
      "0199a",
    ]);
  });
});

describe("captureRun", () => {
  const URL = "https://example.pl/artykuł?id=1&x=2";

  function capture(fields: Partial<ArticleCapture> = {}): ArticleCapture {
    return {
      id: "page-1",
      url: URL,
      normalizedUrl: "example.pl/artykuł?id=1&x=2",
      domain: "example.pl",
      title: "Nowy prezes spółki",
      storagePath: "gs://koryta-pl-crawled/hostname=example.pl/x.tar.gz",
      htmlSha256: "0".repeat(64),
      htmlBytes: 1024,
      source: "extension",
      status: "stored",
      capturedBy: "kasia",
      capturedAt: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      ...fields,
    };
  }

  it("is queued while stored and nothing has read it", () => {
    expect(captureRun(capture())).toEqual({
      id: "page-1",
      job: "capture_extraction",
      state: "queued",
      trigger: "event",
      host: "rozszerzenie",
      startedAt: "2026-10-02T10:00:00.000Z",
      heartbeatAt: "2026-10-02T10:00:00.000Z",
      finishedAt: null,
      progress: null,
      counters: {},
      phase: null,
      stopReason: null,
      errors: [],
      exitCode: null,
      summaryPath: null,
      version: null,
      title: "Nowy prezes spółki",
      url: URL,
      link: null,
    });
  });

  it("is running while the extractor has it", () => {
    const mapped = captureRun(
      capture({
        status: "extracting",
        updatedAt: "2026-10-02T10:01:00.000Z",
        extraction: { tag: "capture_v1", startedAt: "2026-10-02T10:01:00Z" },
      }),
    );
    expect(mapped).toMatchObject({
      state: "running",
      phase: "ekstrakcja",
      heartbeatAt: "2026-10-02T10:01:00.000Z",
      finishedAt: null,
      version: "capture_v1",
    });
  });

  it("succeeds when done, linking to the facts only when there are some", () => {
    const done = captureRun(
      capture({
        status: "done",
        updatedAt: "2026-10-02T10:03:00.000Z",
        extraction: {
          tag: "capture_v1",
          model: "gemini-2.5-flash",
          factCount: 3,
          finishedAt: "2026-10-02T10:02:30.000Z",
        },
      }),
    );
    expect(done).toMatchObject({
      state: "succeeded",
      finishedAt: "2026-10-02T10:02:30.000Z",
      counters: { facts: 3 },
      version: "gemini-2.5-flash",
      link: `/ekstrakcje?article=${encodeURIComponent(URL)}`,
    });
    const empty = captureRun(
      capture({
        status: "done",
        updatedAt: "2026-10-02T10:03:00.000Z",
        extraction: { tag: "capture_v1", factCount: 0 },
      }),
    );
    expect(empty).toMatchObject({
      state: "succeeded",
      finishedAt: "2026-10-02T10:03:00.000Z",
      counters: { facts: 0 },
      link: null,
    });
  });

  it("fails with the extractor's error, cut to length", () => {
    const failed = captureRun(
      capture({
        status: "error",
        updatedAt: "2026-10-02T10:04:00.000Z",
        extraction: { tag: "capture_v1", error: "e".repeat(800) },
      }),
    );
    expect(failed.state).toBe("failed");
    expect(failed.finishedAt).toBe("2026-10-02T10:04:00.000Z");
    expect(failed.errors).toEqual(["e".repeat(RUN_ERROR_CHARS)]);
    expect(failed.link).toBeNull();
  });

  it("says where it came from, and falls back to the domain for a title", () => {
    const pasted = captureRun(
      capture({ source: "paste", title: null, updatedAt: "" }),
    );
    expect(pasted.host).toBe("wklejone na /zrodla");
    expect(pasted.title).toBe("example.pl");
    expect(pasted.heartbeatAt).toBe("2026-10-02T10:00:00.000Z");
  });
});

describe("jobHealth", () => {
  // 12:00 in Warsaw on 3 October; tonight's 00:30 slot was 22:30 UTC on the 2nd.
  const now = at("2026-10-03T10:00:00Z");
  const health = (
    def: JobDefinition,
    runs: JobRun[],
    record: JobRecord | null = null,
    probe: ProbeResult | null = null,
    when = now,
  ) => jobHealth(def, { runs, record, probe }, when);

  const captures = definition({
    id: "capture_extraction",
    kind: "triggered",
    captures: true,
    schedule: undefined,
    heartbeatMinutes: 35,
    queuedMinutes: 15,
  });

  describe("captures", () => {
    const done = run({
      state: "succeeded",
      startedAt: "2026-10-03T08:00:00.000Z",
      finishedAt: "2026-10-03T08:01:00.000Z",
    });
    const going = run({
      state: "running",
      startedAt: "2026-10-03T09:50:00.000Z",
      heartbeatAt: "2026-10-03T09:51:00.000Z",
    });
    const stuck = run({
      state: "queued",
      startedAt: "2026-10-03T09:40:00.000Z",
    });

    it("is never with no captures at all", () => {
      expect(health(captures, []).status).toBe("never");
    });

    it("is ok when everything has finished, failures included", () => {
      const failed = run({
        state: "failed",
        startedAt: "2026-10-03T07:00:00.000Z",
        finishedAt: "2026-10-03T07:00:30.000Z",
      });
      expect(health(captures, [done, failed])).toEqual({
        status: "ok",
        detail: "Ostatni zapis: 10:00.",
      });
    });

    it("is running while one is in the extractor", () => {
      expect(health(captures, [going, done])).toEqual({
        status: "running",
        detail: "1 w toku.",
      });
    });

    it("is stalled once one has waited too long, whatever else is going", () => {
      expect(health(captures, [going, stuck, done])).toEqual({
        status: "stalled",
        detail: "1 strona utknęła - nic jej już nie podejmie.",
      });
    });

    it("lets a capture stuck for over a week drop out of the judgement", () => {
      // Still among the twenty newest - captures are rare - but stuck since
      // long before the week the server counts.
      const forgotten = run({
        id: "forgotten",
        state: "running",
        startedAt: "2026-09-10T08:00:00.000Z",
      });
      expect(health(captures, [done, forgotten])).toEqual({
        status: "ok",
        detail: "Ostatni zapis: 10:00.",
      });
    });

    it("counts the stuck ones in Polish", () => {
      const stuckN = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          run({
            id: `stuck-${i}`,
            state: "queued",
            startedAt: "2026-10-03T09:00:00.000Z",
          }),
        );
      expect(health(captures, stuckN(2)).detail).toMatch(/^2 strony utknęły /);
      expect(health(captures, stuckN(5)).detail).toMatch(/^5 stron utknęło /);
      expect(health(captures, stuckN(12)).detail).toMatch(/^12 stron utknęło /);
      expect(health(captures, stuckN(22)).detail).toMatch(
        /^22 strony utknęły /,
      );
    });
  });

  describe("triggered, not captures", () => {
    // An import someone starts by hand: one run per request, like a capture,
    // but judged by its newest run, with no clock to miss.
    const imports = definition({
      id: "company_import",
      kind: "triggered",
      schedule: undefined,
      graceMinutes: undefined,
      heartbeatMinutes: 15,
    });
    const upload = (
      fields: Partial<JobRun> & Pick<JobRun, "state" | "startedAt">,
    ) => run({ job: "company_import", trigger: "manual", ...fields });
    const ended = (
      state: "succeeded" | "partial" | "failed",
      stopReason: string | null = null,
    ) =>
      upload({
        state,
        startedAt: "2026-10-02T13:00:00.000Z",
        finishedAt: "2026-10-02T13:04:00.000Z",
        stopReason,
      });

    it("is never before its first report", () => {
      expect(health(imports, [])).toEqual({
        status: "never",
        detail: "Ten job jeszcze nic nie zgłosił.",
      });
    });

    it("is running while the heartbeat is fresh", () => {
      const going = upload({
        state: "running",
        startedAt: "2026-10-03T09:50:00.000Z",
        heartbeatAt: "2026-10-03T09:58:00.000Z",
        phase: "wysyłanie",
      });
      expect(health(imports, [going])).toEqual({
        status: "running",
        detail: "Trwa od 11:50 - wysyłanie.",
      });
    });

    it("is stalled once the heartbeat is older than the allowance", () => {
      const quiet = upload({
        state: "running",
        startedAt: "2026-10-03T09:00:00.000Z",
        heartbeatAt: "2026-10-03T09:40:00.000Z",
      });
      expect(health(imports, [quiet])).toEqual({
        status: "stalled",
        detail: "Brak sygnału od 20 min (ostatni o 11:40).",
      });
    });

    it("says how the newest run ended", () => {
      expect(health(imports, [ended("succeeded")])).toEqual({
        status: "ok",
        detail: "Ostatnio udane: 2.10, 15:04.",
      });
      expect(health(imports, [ended("partial", "przerwany")])).toEqual({
        status: "partial",
        detail: "Przerwane z zaległościami: 2.10, 15:04 (przerwany).",
      });
      expect(health(imports, [ended("failed", "HTTP 500")])).toEqual({
        status: "failed",
        detail: "Błąd: 2.10, 15:04 (HTTP 500).",
      });
    });

    it("goes by the newest run alone, not by a week of them as captures do", () => {
      const stuckBefore = upload({
        id: "stuck",
        state: "running",
        startedAt: "2026-10-03T08:00:00.000Z",
        heartbeatAt: "2026-10-03T08:01:00.000Z",
      });
      const okAfter = upload({
        id: "ok",
        state: "succeeded",
        startedAt: "2026-10-03T09:00:00.000Z",
        finishedAt: "2026-10-03T09:05:00.000Z",
      });
      expect(health(imports, [okAfter, stuckBefore]).status).toBe("ok");
      expect(health(captures, [okAfter, stuckBefore]).status).toBe("stalled");
      const failedBefore = { ...stuckBefore, state: "failed" as const };
      expect(health(imports, [okAfter, failedBefore]).status).toBe("ok");
    });

    it("is never late, however long since it last ran", () => {
      const longAgo = upload({
        state: "succeeded",
        startedAt: "2026-09-01T13:00:00.000Z",
        finishedAt: "2026-09-01T13:04:00.000Z",
      });
      expect(health(imports, [longAgo], LIVE)).toEqual({
        status: "ok",
        detail: "Ostatnio udane: 1.09, 15:04.",
      });
    });
  });

  describe("scheduled", () => {
    const nightly = definition();

    it("is never before its first report", () => {
      expect(health(nightly, [])).toEqual({
        status: "never",
        detail: "Ten job jeszcze nic nie zgłosił.",
      });
      expect(health(nightly, [], LIVE).status).toBe("never");
    });

    it("is unknown, not never, when its runs could not be read", () => {
      const view = { runs: [], record: null, probe: null, unavailable: true };
      expect(jobHealth(nightly, view, now).status).toBe("unknown");
      // The same goes for the captures, and for an import.
      expect(jobHealth(captures, view, now).status).toBe("unknown");
      const imports = definition({
        id: "company_import",
        kind: "triggered",
        schedule: undefined,
      });
      expect(jobHealth(imports, view, now).status).toBe("unknown");
      // A probe still has something to say.
      const mirror = definition({
        id: "compressor",
        schedule: undefined,
        probe: "compressedMirror",
        mirrorHosts: ["rejestr.io"],
        maxLagDays: 2,
      });
      const probe: ProbeResult = {
        kind: "compressedMirror",
        hosts: [
          {
            host: "rejestr.io",
            through: "2026-10-02",
            archivedAt: "2026-10-03T00:40:00.000Z",
            bytes: 1,
          },
        ],
      };
      expect(jobHealth(mirror, { ...view, probe }, now).status).toBe("ok");
    });

    it("is running while the heartbeat is fresh", () => {
      const going = run({
        state: "running",
        startedAt: "2026-10-03T09:00:00.000Z",
        heartbeatAt: "2026-10-03T09:55:00.000Z",
        phase: "odpisy",
      });
      expect(health(nightly, [going], LIVE)).toEqual({
        status: "running",
        detail: "Trwa od 11:00 - odpisy.",
      });
    });

    it("is stalled once the heartbeat is older than the allowance", () => {
      const quiet = run({
        state: "running",
        startedAt: "2026-10-03T09:00:00.000Z",
        heartbeatAt: "2026-10-03T09:40:00.000Z",
      });
      expect(health(nightly, [quiet])).toEqual({
        status: "stalled",
        detail: "Brak sygnału od 20 min (ostatni o 11:40).",
      });
    });

    it("says how the newest finished run ended", () => {
      const ended = (
        state: "succeeded" | "partial" | "failed",
        stopReason: string | null = null,
      ) =>
        run({
          state,
          startedAt: "2026-10-02T22:30:00.000Z",
          finishedAt: "2026-10-03T00:10:00.000Z",
          stopReason,
        });
      expect(health(nightly, [ended("succeeded")], LIVE)).toEqual({
        status: "ok",
        detail: "Ostatnio udane: 02:10.",
      });
      expect(health(nightly, [ended("partial", "deadline")], LIVE)).toEqual({
        status: "partial",
        detail: "Przerwane z zaległościami: 02:10 (deadline).",
      });
      expect(health(nightly, [ended("failed", "HTTP 429")], LIVE)).toEqual({
        status: "failed",
        detail: "Błąd: 02:10 (HTTP 429).",
      });
    });

    it("names a success's reason, so a trial does not pass for the real thing", () => {
      const trial = run({
        state: "succeeded",
        startedAt: "2026-10-02T22:30:00.000Z",
        finishedAt: "2026-10-03T00:10:00.000Z",
        stopReason: "próba - nic nie wysłano",
        counters: { planned: 1305 },
      });
      expect(health(nightly, [trial], LIVE)).toEqual({
        status: "ok",
        detail: "Ostatnio udane: 02:10 (próba - nic nie wysłano).",
      });
    });

    it("looks only at the newest run", () => {
      const failedBefore = run({
        state: "failed",
        startedAt: "2026-10-01T22:30:00.000Z",
        finishedAt: "2026-10-01T22:35:00.000Z",
      });
      const okNow = run({
        state: "succeeded",
        startedAt: "2026-10-02T22:30:00.000Z",
        finishedAt: "2026-10-03T00:10:00.000Z",
      });
      expect(health(nightly, [okNow, failedBefore]).status).toBe("ok");
    });

    describe("late", () => {
      const lastNight = run({
        state: "succeeded",
        startedAt: "2026-10-01T22:30:00.000Z",
        finishedAt: "2026-10-01T23:30:00.000Z",
      });

      it("is late once its schedule is live and the due slot has no run", () => {
        expect(health(nightly, [lastNight], LIVE)).toEqual({
          status: "late",
          detail: "Nie wystartował o 00:30.",
        });
      });

      it("is not late while its schedule is only a plan", () => {
        expect(health(nightly, [lastNight]).status).toBe("ok");
        expect(
          health(nightly, [lastNight], { ...LIVE, lastScheduledAt: null })
            .status,
        ).toBe("ok");
        expect(
          health(definition({ schedule: undefined }), [lastNight], LIVE).status,
        ).toBe("ok");
      });

      it("is not late within the grace", () => {
        // 01:15 in Warsaw: 45 minutes past the slot.
        expect(
          health(nightly, [lastNight], LIVE, null, at("2026-10-02T23:15:00Z"))
            .status,
        ).toBe("ok");
      });

      it("is never late while a run is going, however old", () => {
        const sinceYesterday = run({
          state: "running",
          startedAt: "2026-10-02T12:00:00.000Z",
          heartbeatAt: "2026-10-03T09:59:00.000Z",
        });
        expect(health(nightly, [sinceYesterday], LIVE).status).toBe("running");
        const quiet = { ...sinceYesterday, heartbeatAt: lastNight.startedAt };
        expect(health(nightly, [quiet], LIVE).status).toBe("stalled");
      });

      it("ranks against how the last run ended", () => {
        const failed = { ...lastNight, state: "failed" as const };
        expect(health(nightly, [failed], LIVE).status).toBe("failed");
        const partial = { ...lastNight, state: "partial" as const };
        expect(health(nightly, [partial], LIVE).status).toBe("late");
      });
    });
  });

  describe("ongoing", () => {
    const crawl = definition({
      id: "article_crawl",
      kind: "ongoing",
      schedule: undefined,
    });

    it("is stopped once its run has finished without failing", () => {
      const ended = run({
        state: "partial",
        startedAt: "2026-10-01T08:00:00.000Z",
        finishedAt: "2026-10-02T12:00:00.000Z",
        stopReason: "kolejka pusta",
      });
      expect(health(crawl, [ended])).toEqual({
        status: "stopped",
        detail: "Zatrzymany 2.10, 14:00 (kolejka pusta).",
      });
      expect(
        health(crawl, [{ ...ended, state: "succeeded", stopReason: null }]),
      ).toEqual({ status: "stopped", detail: "Zatrzymany 2.10, 14:00." });
      expect(health(crawl, [{ ...ended, state: "failed" }]).status).toBe(
        "failed",
      );
    });

    it("is running, then stalled, like any other", () => {
      const going = run({
        state: "running",
        startedAt: "2026-10-01T08:00:00.000Z",
        heartbeatAt: "2026-10-03T09:58:00.000Z",
      });
      expect(health(crawl, [going]).status).toBe("running");
      expect(
        health(crawl, [{ ...going, heartbeatAt: "2026-10-03T09:00:00.000Z" }])
          .status,
      ).toBe("stalled");
    });
  });

  describe("compressed mirror probe", () => {
    const compressor = definition({
      id: "compressor",
      schedule: undefined,
      scheduleNote: "Pora do ustalenia",
      probe: "compressedMirror",
      mirrorHosts: ["rejestr.io", "api-krs.ms.gov.pl"],
      maxLagDays: 2,
    });
    const mirror = (...through: (string | null)[]): ProbeResult => ({
      kind: "compressedMirror",
      hosts: through.map((day, i) => ({
        host: compressor.mirrorHosts![i]!,
        through: day,
        archivedAt: day ? `${day}T23:00:00.000Z` : null,
        bytes: day ? 1000 : null,
      })),
    });

    it("is ok while the stalest host is within the allowed lag", () => {
      expect(
        health(compressor, [], null, mirror("2026-10-02", "2026-10-01")),
      ).toEqual({
        status: "ok",
        detail: "Lustro do 2026-10-01 (api-krs.ms.gov.pl), 2 dni temu",
      });
      expect(
        health(compressor, [], null, mirror("2026-10-02", "2026-10-02")).detail,
      ).toBe("Lustro do 2026-10-02 (rejestr.io), 1 dzień temu");
    });

    it("is stale once the stalest host is further behind", () => {
      expect(
        health(compressor, [], null, mirror("2026-10-02", "2026-09-30")),
      ).toEqual({
        status: "stale",
        detail: "Lustro do 2026-09-30 (api-krs.ms.gov.pl), 3 dni temu",
      });
    });

    it("is stale when a host has no archive at all", () => {
      expect(health(compressor, [], null, mirror("2026-10-02", null))).toEqual({
        status: "stale",
        detail:
          "Lustro do 2026-10-02 (rejestr.io), 1 dzień temu; 1 bez archiwum",
      });
      expect(health(compressor, [], null, mirror(null, null)).status).toBe(
        "never",
      );
    });

    it("is not behind for a host nothing has written to since", () => {
      // rejestr.io is written only by the paid job, run by hand: a week
      // without it leaves nothing for the compressor to archive.
      const quiet = mirror("2026-09-25", "2026-10-02");
      if ("hosts" in quiet) quiet.hosts[0]!.newerData = null;
      expect(health(compressor, [], null, quiet)).toEqual({
        status: "ok",
        detail:
          "Lustro do 2026-09-25 (rejestr.io), 8 dni temu - nic nowszego do spakowania",
      });
    });

    it("is behind once data newer than the archive has waited too long", () => {
      const waiting = (day: string) => {
        const probe = mirror("2026-09-25", "2026-10-02");
        if ("hosts" in probe) probe.hosts[0]!.newerData = day;
        return probe;
      };
      expect(health(compressor, [], null, waiting("2026-09-29"))).toEqual({
        status: "stale",
        detail:
          "Lustro do 2026-09-25 (rejestr.io), 8 dni temu; nowsze dane od 2026-09-29",
      });
      // Written yesterday: tonight's run takes it.
      expect(health(compressor, [], null, waiting("2026-10-02")).status).toBe(
        "ok",
      );
    });

    it("is unknown when the bucket could not be read", () => {
      expect(
        health(compressor, [], null, {
          kind: "compressedMirror",
          error: "brak dostępu do zasobnika",
        }),
      ).toEqual({
        status: "unknown",
        detail: "Nie udało się sprawdzić: brak dostępu do zasobnika",
      });
    });

    it("lets whichever of the run and the probe is worse decide", () => {
      const ok = run({
        state: "succeeded",
        startedAt: "2026-10-03T01:00:00.000Z",
        finishedAt: "2026-10-03T01:30:00.000Z",
      });
      const stale = mirror("2026-10-02", "2026-09-28");
      expect(health(compressor, [ok], null, stale).status).toBe("stale");
      expect(
        health(compressor, [{ ...ok, state: "failed" }], null, stale).status,
      ).toBe("failed");
      expect(
        health(compressor, [ok], null, {
          kind: "compressedMirror",
          error: "x",
        }).status,
      ).toBe("ok");
    });
  });

  describe("firestore export probe", () => {
    const exporter = definition({
      id: "firestore_export",
      schedule: MORNING,
      heartbeatMinutes: 120,
      graceMinutes: 60,
      probe: "firestoreExport",
    });
    const exported = (
      startedAt: string,
      finishedAt: string | null,
    ): ProbeResult => ({
      kind: "firestoreExport",
      latest: { folder: `date=${startedAt}`, startedAt, finishedAt },
    });
    const today = exported(
      "2026-10-02T02:00:05.000Z",
      "2026-10-02T02:06:05.000Z",
    );
    const yesterday = exported(
      "2026-10-01T02:00:05.000Z",
      "2026-10-01T02:06:05.000Z",
    );
    const exportHealth = (probe: ProbeResult, when: string) =>
      health(exporter, [], null, probe, at(when));

    it("is ok when today's export has its marker", () => {
      expect(exportHealth(today, "2026-10-02T10:00:00Z")).toEqual({
        status: "ok",
        detail: "Ostatnia kopia z 04:00, gotowa po 6 min.",
      });
    });

    it("is late when there is none from today after 05:00 in Warsaw", () => {
      expect(exportHealth(yesterday, "2026-10-02T02:59:00Z").status).toBe("ok");
      expect(exportHealth(yesterday, "2026-10-02T03:00:00Z")).toEqual({
        status: "late",
        detail: "Brak kopii z 04:00.",
      });
      expect(
        exportHealth(
          { kind: "firestoreExport", latest: null },
          "2026-10-02T10:00:00Z",
        ).status,
      ).toBe("late");
      // Winter: 04:00 in Warsaw is 03:00 UTC, so 05:00 is 04:00 UTC.
      const december = exported(
        "2026-12-01T03:00:05.000Z",
        "2026-12-01T03:06:05.000Z",
      );
      expect(exportHealth(december, "2026-12-02T03:59:00Z").status).toBe("ok");
      expect(exportHealth(december, "2026-12-02T04:00:00Z").status).toBe(
        "late",
      );
    });

    it("is running while a folder without its marker is young", () => {
      expect(
        exportHealth(
          exported("2026-10-02T02:00:05.000Z", null),
          "2026-10-02T03:00:00Z",
        ),
      ).toEqual({ status: "running", detail: "Eksport trwa od 04:00." });
    });

    it("is failed once a folder has gone without its marker too long", () => {
      expect(
        exportHealth(
          exported("2026-10-02T02:00:05.000Z", null),
          "2026-10-02T04:30:00Z",
        ),
      ).toEqual({
        status: "failed",
        detail: "Eksport z 04:00 nie ma pliku końcowego.",
      });
    });
  });
});

describe("isProblem", () => {
  it("is what needs someone to look", () => {
    const problems = ["stalled", "failed", "late", "stale"] as const;
    const fine = [
      "partial",
      "stopped",
      "running",
      "ok",
      "never",
      "unknown",
    ] as const;
    for (const status of problems) expect(isProblem(status)).toBe(true);
    for (const status of fine) expect(isProblem(status)).toBe(false);
  });
});

describe("scheduleIsLive / taskLink", () => {
  it("is live once the job has run on its schedule", () => {
    const schedule = { dailyAt: "00:30", timeZone: WARSAW };
    expect(scheduleIsLive({ schedule }, null)).toBe(false);
    expect(
      scheduleIsLive({ schedule }, { ...LIVE, lastScheduledAt: null }),
    ).toBe(false);
    expect(scheduleIsLive({ schedule }, LIVE)).toBe(true);
    // No schedule, nothing to be live.
    expect(scheduleIsLive({}, LIVE)).toBe(false);
    // A probe job is watched because it already runs.
    expect(scheduleIsLive({ schedule, probe: "firestoreExport" }, null)).toBe(
      true,
    );
    expect(taskLink("merge-krs-free-nightly")).toBe(
      "/admin/zadania#t-merge-krs-free-nightly",
    );
  });
});

describe("mirrorWrites", () => {
  const host = (name: string, through: string | null) => ({
    host: name,
    through,
    archivedAt: null,
    bytes: null,
  });
  const writers = {
    "rejestr.io": ["krs_scrape_paid"],
    "api-krs.ms.gov.pl": ["krs_scrape_free"],
  };
  const paid = (startedAt: string, state: JobRun["state"] = "succeeded") =>
    run({ id: startedAt, job: "krs_scrape_paid", state, startedAt });

  it("finds the oldest write since the newest archive, in Warsaw days", () => {
    const [rejestr] = mirrorWrites(
      [host("rejestr.io", "2026-09-25")],
      writers,
      (job) =>
        job === "krs_scrape_paid"
          ? [
              paid("2026-10-01T09:00:00.000Z"),
              // 23:30 UTC on the 27th is already the 28th in Warsaw.
              paid("2026-09-27T23:30:00.000Z"),
              paid("2026-09-20T09:00:00.000Z"),
            ]
          : [],
    );
    expect(rejestr!.newerData).toBe("2026-09-28");
  });

  it("says nothing new when every write predates the archive", () => {
    const [rejestr] = mirrorWrites(
      [host("rejestr.io", "2026-09-25")],
      writers,
      () => [paid("2026-09-20T09:00:00.000Z")],
    );
    expect(rejestr!.newerData).toBeNull();
  });

  it("does not count a failed run, and leaves a host with no reports alone", () => {
    const [rejestr, krs] = mirrorWrites(
      [
        host("rejestr.io", "2026-09-25"),
        host("api-krs.ms.gov.pl", "2026-09-25"),
      ],
      writers,
      (job) =>
        job === "krs_scrape_paid"
          ? [paid("2026-10-01T09:00:00.000Z", "failed")]
          : [],
    );
    expect(rejestr!.newerData).toBeNull();
    expect(krs).not.toHaveProperty("newerData");
  });
});

describe("JOBS", () => {
  it("has unique ids and a valid kind for every job", () => {
    const ids = JOBS.map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const job of JOBS) {
      expect(JOB_KINDS).toContain(job.kind);
      expect(job.title, job.id).toBeTruthy();
      expect(job.summary, job.id).toBeTruthy();
      expect(job.runsOn, job.id).toBeTruthy();
      expect(job.heartbeatMinutes, job.id).toBeGreaterThan(0);
    }
  });

  it("gives every scheduled job a time, or says why it has none", () => {
    for (const job of JOBS.filter((job) => job.kind === "scheduled")) {
      expect(Boolean(job.schedule || job.scheduleNote), job.id).toBe(true);
    }
  });

  it("spells every time as a real HH:MM in a real zone", () => {
    for (const job of JOBS) {
      if (!job.schedule) continue;
      expect(job.schedule.dailyAt, job.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(() => zonedDay(new Date(0), job.schedule!.timeZone)).not.toThrow();
    }
  });

  it("names the hosts a mirror probe checks", () => {
    for (const job of JOBS.filter((job) => job.probe === "compressedMirror")) {
      expect(job.mirrorHosts?.length, job.id).toBeGreaterThan(0);
    }
  });

  it("marks only the extension's captures as captures", () => {
    // The server hangs every capture on whichever job says so: a second one
    // would list the same pages twice, and an import marked by mistake would
    // lose its reported runs to them.
    expect(JOBS.filter((job) => job.captures).map((job) => job.id)).toEqual([
      "capture_extraction",
    ]);
    for (const job of JOBS.filter((job) => job.captures)) {
      expect(job.kind, job.id).toBe("triggered");
    }
  });

  it("gives the captures a queue allowance", () => {
    for (const job of JOBS.filter((job) => job.captures)) {
      expect(job.queuedMinutes, job.id).toBeGreaterThan(0);
    }
  });

  it("holds no triggered job to a clock", () => {
    for (const job of JOBS.filter((job) => job.kind === "triggered")) {
      expect(job.schedule, job.id).toBeUndefined();
      expect(job.graceMinutes, job.id).toBeUndefined();
    }
  });

  it("starts the night after the export it compares the people against", () => {
    const exported = jobDefinition("firestore_export")!.schedule!;
    const night = jobDefinition("nightly")!.schedule!;
    expect(night.timeZone).toBe(exported.timeZone);
    expect(night.dailyAt > exported.dailyAt).toBe(true);
    // A step of the night, so it has no slot of its own to miss.
    expect(jobDefinition("people_import")!.schedule).toBeUndefined();
  });
});
