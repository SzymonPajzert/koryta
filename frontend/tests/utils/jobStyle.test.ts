import { describe, it, expect } from "vitest";
import {
  counterLabel,
  counterValue,
  jobHealthConfig,
  jobKindConfig,
  jobProbeConfig,
  KNOWN_COUNTERS,
  otherDefinition,
  plural,
  progressShare,
  progressText,
  runChip,
  runStateConfig,
  runTriggerConfig,
  scheduleText,
  toneClasses,
} from "../../app/utils/jobStyle";
import {
  isProblem,
  JOB_HEALTH,
  JOB_KINDS,
  RUN_STATES,
  RUN_TRIGGERS,
  WARSAW,
  scheduleIsLive,
  type JobRun,
} from "../../shared/jobs";

const run = (overrides: Partial<JobRun> = {}): JobRun => ({
  id: "r1",
  job: "krs_scrape_free",
  state: "succeeded",
  trigger: "schedule",
  host: "predator",
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
});

describe("job style tables", () => {
  // A status added to shared/jobs.ts without a row here would render an
  // empty chip and an undefined tone - the record type catches a missing
  // key only while nobody casts around it.
  it("names and colours every health status", () => {
    for (const status of JOB_HEALTH) {
      const style = jobHealthConfig[status];
      expect(style.title, status).toBeTruthy();
      expect(style.summary, status).toBeTruthy();
      expect(style.icon, status).toBeTruthy();
      expect(style.tone, status).toBeTruthy();
    }
    expect(Object.keys(jobHealthConfig).sort()).toEqual([...JOB_HEALTH].sort());
  });

  it("paints every problem red or amber, and nothing else red", () => {
    for (const status of JOB_HEALTH) {
      const tone = jobHealthConfig[status].tone;
      if (isProblem(status)) expect(["danger", "warning"]).toContain(tone);
      else expect(tone).not.toBe("danger");
    }
  });

  it("names every run state, kind and trigger", () => {
    for (const state of RUN_STATES) {
      expect(runStateConfig[state].title, state).toBeTruthy();
      expect(runStateConfig[state].tone, state).toBeTruthy();
    }
    for (const kind of JOB_KINDS) {
      expect(jobKindConfig[kind].title, kind).toBeTruthy();
      expect(jobKindConfig[kind].info, kind).toBeTruthy();
      expect(jobKindConfig[kind].icon, kind).toBeTruthy();
    }
    for (const trigger of RUN_TRIGGERS) {
      expect(runTriggerConfig[trigger].title, trigger).toBeTruthy();
    }
    expect(jobProbeConfig.compressedMirror.source).toContain(
      "koryta-pl-compressed",
    );
    expect(jobProbeConfig.firestoreExport.source).toContain(
      "koryta-pl-crawled",
    );
  });

  it("uses the spec's words", () => {
    expect(jobHealthConfig.stalled.title).toBe("Bez sygnału");
    expect(jobHealthConfig.late.title).toBe("Nie wystartował");
    expect(jobHealthConfig.never.title).toBe("Brak raportów");
    expect(runStateConfig.partial.title).toBe("niedokończony");
    expect(jobKindConfig.scheduled.title).toBe("Według harmonogramu");
    expect(runTriggerConfig.manual.title).toBe("ręcznie");
  });
});

describe("counterLabel", () => {
  it("names the counters the jobs write, and shows the rest as they are", () => {
    expect(counterLabel("bulletin_failed")).toBe(
      "dni biuletynu bez odpowiedzi",
    );
    expect(counterLabel("pln")).toBe("zł");
    expect(counterLabel("something_new")).toBe("something_new");
  });

  it("keeps the grosze on money and groups the rest", () => {
    expect(counterValue("pln", 0.6)).toBe("0,60");
    expect(counterValue("answered", 12345)).toBe("12\u00a0345");
  });
});

describe("plural", () => {
  it.each([
    [1, "fakt"],
    [2, "fakty"],
    [4, "fakty"],
    [5, "faktów"],
    [12, "faktów"],
    [14, "faktów"],
    [22, "fakty"],
    [0, "faktów"],
  ])("%i -> %s", (count, word) => {
    expect(plural(count, "fakt", "fakty", "faktów")).toBe(word);
  });
});

describe("counters", () => {
  it("reads every counter the jobs write in Polish", () => {
    // What data/pipelines/src/jobs write: krs_scrape_free, krs_scrape_paid,
    // krs_odpis, krs_register_owners and the crawl; and the captures' facts.
    const written = [
      ...["answered", "empty", "failed", "upload_failed"],
      ...["bulletin_fetched", "bulletin_failed"],
      ...["bought", "skipped", "pln", "pln_planned"],
      ...["fetched", "absent", "gateway", "network"],
      ...["ok", "struck_off", "not_found", "logged"],
      ...["stored", "not_html", "errors", "rate_limited", "discovered"],
      "facts",
    ];
    for (const key of written) {
      expect(KNOWN_COUNTERS, key).toContain(key);
      expect(counterLabel(key), key).not.toBe(key);
    }
    expect(counterLabel("something_new")).toBe("something_new");
  });

  it("keeps the grosze on money, planned or spent", () => {
    expect(counterValue("pln", 20.6)).toBe("20,60");
    expect(counterValue("pln_planned", 3)).toBe("3,00");
  });
});

describe("progress", () => {
  it("says how far, short in the header and long in the run list", () => {
    const progress = { done: 1200, total: 5000, unit: "firm" };
    expect(progressText(progress, "short")).toBe("1200/5000 firm");
    expect(progressText(progress)).toBe("1200 z 5000 firm");
    expect(progressShare(progress)).toBeCloseTo(0.24);
  });

  it("is a count when there is no total", () => {
    const progress = { done: 15000, total: null, unit: "stron" };
    expect(progressText(progress, "short")).toBe("stron: 15\u00a0000");
    expect(progressShare(progress)).toBeNull();
  });

  it("never runs the bar past either end", () => {
    expect(progressShare({ done: 7, total: 5, unit: "" })).toBe(1);
    expect(progressShare({ done: 0, total: 0, unit: "" })).toBe(0);
  });
});

describe("runChip", () => {
  const now = new Date("2026-10-02T10:00:00.000Z");
  const definition = { heartbeatMinutes: 15, queuedMinutes: 10 };

  it("is the state while the run keeps saying it is going", () => {
    const chip = runChip(
      run({ state: "running", heartbeatAt: "2026-10-02T09:55:00.000Z" }),
      definition,
      now,
    );
    expect(chip.title).toBe("trwa");
    expect(chip.stalled).toBe(false);
  });

  it("says a quiet run has gone quiet, and a stuck queue was never picked up", () => {
    expect(
      runChip(
        run({ state: "running", heartbeatAt: "2026-10-02T09:00:00.000Z" }),
        definition,
        now,
      ),
    ).toMatchObject({ title: "bez sygnału", tone: "danger", stalled: true });
    expect(
      runChip(
        run({ state: "queued", heartbeatAt: "2026-10-02T09:45:00.000Z" }),
        definition,
        now,
      ),
    ).toMatchObject({ title: "nikt nie podjął", stalled: true });
  });

  it("never calls a finished run quiet", () => {
    expect(
      runChip(
        run({ state: "failed", heartbeatAt: "2026-09-01T00:00:00.000Z" }),
        definition,
        now,
      ).title,
    ).toBe("błąd");
  });
});

describe("schedules", () => {
  const schedule = { dailyAt: "00:30", timeZone: WARSAW };
  const record = {
    lastRunId: null,
    lastStartedAt: null,
    lastScheduledAt: null,
    lastSucceededAt: null,
  };

  it("counts a schedule once the job has run on it", () => {
    expect(scheduleIsLive({ schedule }, null)).toBe(false);
    expect(scheduleIsLive({ schedule }, record)).toBe(false);
    expect(
      scheduleIsLive(
        { schedule },
        { ...record, lastScheduledAt: "2026-10-01T22:30:00.000Z" },
      ),
    ).toBe(true);
    expect(scheduleIsLive({}, { ...record, lastScheduledAt: "x" })).toBe(false);
  });

  it("takes a probe job's schedule as live: it never reports, but is held to it", () => {
    expect(scheduleIsLive({ schedule, probe: "firestoreExport" }, null)).toBe(
      true,
    );
  });

  it("reads Warsaw time as the owner says it", () => {
    expect(scheduleText({ schedule })).toBe(
      "codziennie o 00:30 czasu warszawskiego",
    );
    expect(scheduleText({})).toBeNull();
  });
});

describe("otherDefinition", () => {
  it("makes a row out of nothing but runs", () => {
    const definition = otherDefinition({
      id: "people_upload",
      runs: [run({ job: "people_upload", trigger: "manual" })],
      record: null,
    });
    expect(definition).toMatchObject({
      id: "people_upload",
      title: "people_upload",
      kind: "scheduled",
      heartbeatMinutes: 15,
      runsOn: "predator",
    });
  });

  it("guesses the kind from how the newest run started", () => {
    const kindOf = (trigger: JobRun["trigger"]) =>
      otherDefinition({ id: "x", runs: [run({ trigger })], record: null }).kind;
    expect(kindOf("schedule")).toBe("scheduled");
    expect(kindOf("event")).toBe("triggered");
    expect(kindOf("manual")).toBe("scheduled");
    expect(kindOf(null)).toBe("scheduled");
    expect(otherDefinition({ id: "x", runs: [], record: null }).kind).toBe(
      "scheduled",
    );
  });
});

describe("toneClasses", () => {
  it("pairs neutral with the muted surface, like the rows do", () => {
    expect(toneClasses("neutral")).toBe("bg-surface-muted text-ink-neutral");
    expect(toneClasses("danger")).toBe("bg-surface-danger text-ink-danger");
  });
});
