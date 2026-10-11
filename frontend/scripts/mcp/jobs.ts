/** How the jobs are doing, for agents: the answer /admin/procesy gives the
 * owner, without a browser - for a morning check that wants to know whether
 * the night ran, what the free KRS scrape fetched, or why the upload was held.
 *
 * Judged by `jobHealth` in shared/jobs.ts, on the runs the page judges: the
 * newest `RECENT_RUNS`, and each record's last run when that is older
 * (`lastRunsMissing`), grouped by `runsByJob` - so the tool and the page say
 * the same thing about the same job.
 *
 * The page reads three things besides the ops database, and this does not:
 * the extension's captures are `articlePages` in the site's database, and the
 * compressor and the Firestore export are watched through their buckets. All
 * three are outside `ops-writer`'s grant, so those rows say they were not read
 * rather than read as "never reported".
 */
import {
  JOBS,
  JOB_HEALTH,
  JOB_KINDS,
  RECENT_RUNS,
  RUNS_SHOWN,
  WARSAW,
  isFinished,
  isProblem,
  isStalled,
  jobDefinition,
  jobHealth,
  jobRecordFromData,
  jobRunFromData,
  lastRunsMissing,
  otherDefinition,
  runAnchor,
  runsByJob,
  taskLink,
  zonedDay,
  type JobDefinition,
  type JobHealth,
  type JobHealthStatus,
  type JobKind,
  type JobRecord,
  type JobRun,
  type RunProgress,
  type RunRequest,
} from "../../shared/jobs";
import type { Doc } from "./firestore-reader";
import type { JobReports } from "./ops-store";

const SITE = "https://koryta.pl";

export const runUrl = (id: string) => `${SITE}/admin/procesy#${runAnchor(id)}`;
/** The page's row for a job (`jobAnchor` in app/utils/jobStyle.ts). */
export const jobUrl = (id: string) => `${SITE}/admin/procesy#proces-${id}`;

/** A job id, from the id or from a link to its row. */
export const jobIdFrom = (ref: string): string =>
  ref.trim().replace(/^.*#proces-/, "");

/** A run id, from the id, its document path or a link to it. */
export const runIdFrom = (ref: string): string =>
  ref
    .trim()
    .replace(/^.*#przebieg-/, "")
    .replace(/^jobRuns\//, "");

/** What the page judges a job by that this tool cannot read, if anything. */
function unreadSource(definition: JobDefinition): string | null {
  if (definition.captures) {
    return "its runs are the extension's captures, articlePages in the site's database";
  }
  if (definition.probe === "compressedMirror") {
    return "the page reads its state from the newest archives in gs://koryta-pl-compressed";
  }
  if (definition.probe === "firestoreExport") {
    return "the page reads its state from the export's completion marker in gs://koryta-pl-crawled";
  }
  return null;
}

const KIND_TITLES: Record<JobKind, string> = {
  triggered:
    "Triggered - a run per request; fails by breaking or getting stuck",
  scheduled:
    "Scheduled - at a set time; fails by breaking, or silently by not starting",
  ongoing: "Ongoing - a long run draining a queue; fails by going quiet",
};

const OTHERS_TITLE =
  "Unlisted - reported under an id JOBS in frontend/shared/jobs.ts does not list";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: WARSAW,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `2026-10-10 04:30`, Warsaw time: the page's clock, with the day always
 * there, since an agent reads it without the page's "today". */
export function warsawStamp(iso: string): string {
  const at = new Date(iso);
  return `${zonedDay(at, WARSAW)} ${clock.format(at)}`;
}

/** `under a minute`, `12 min`, `2 h 5 min`, `3 days`. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} days`;
}

/** `1200/5000 firm`; with no total, `stron: 18342` - the unit is a Polish
 * genitive plural, which reads after "z 5000" but not after a bare count. */
function progressText({ done, total, unit }: RunProgress): string {
  if (total === null) return unit ? `${unit}: ${done}` : String(done);
  return `${done}/${total}${unit ? ` ${unit}` : ""}`;
}

/** The run's state as the page's chip has it: a run that says it is going
 * and has gone quiet is stalled, and the night's `partial` held steps back. */
function stateText(run: JobRun, definition: JobDefinition, now: Date) {
  const trigger = run.trigger ? ` (${run.trigger})` : "";
  if (isStalled(run, definition, now)) {
    return run.state === "queued"
      ? `queued${trigger}, nobody took it - stalled`
      : `${run.state}${trigger}, gone quiet - stalled`;
  }
  if (run.state === "partial" && definition.partialIsHeld) {
    return `partial${trigger}, held steps back`;
  }
  if (run.state === "queued" && run.waitingFor) {
    return `queued${trigger}, waiting for ${run.waitingFor === "export" ? "today's export" : "the night to end"}`;
  }
  return `${run.state}${trigger}`;
}

function timing(run: JobRun, now: Date): string {
  const start = Date.parse(run.startedAt);
  if (run.state === "queued") {
    return `waiting since ${warsawStamp(run.startedAt)}, ${duration(now.getTime() - start)}`;
  }
  const started = `started ${warsawStamp(run.startedAt)}`;
  if (isFinished(run.state)) {
    return run.finishedAt
      ? `${started}, took ${duration(Date.parse(run.finishedAt) - start)}`
      : started;
  }
  return (
    `${started}, going for ${duration(now.getTime() - start)}, ` +
    `last heard from ${duration(now.getTime() - Date.parse(run.heartbeatAt))} ago`
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** What a run says about itself, a phrase each: the newest run on a job's
 * line, or a whole line in a job's list (`full`), with where it ran, its
 * counters and its first error. */
function runFacts(
  run: JobRun,
  definition: JobDefinition,
  now: Date,
  full: boolean,
): string[] {
  // By name: Firestore hands a map's keys back in no fixed order, and two
  // runs' counters are easier to compare in the same one.
  const counters = Object.entries(run.counters).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const firstError = run.errors[0];
  return [
    stateText(run, definition, now),
    full && run.host ? `on ${run.host}` : "",
    timing(run, now),
    !isFinished(run.state) && run.phase ? `phase ${run.phase}` : "",
    run.progress ? `progress ${progressText(run.progress)}` : "",
    full && run.title ? `about ${run.title}` : "",
    full && counters.length > 0
      ? `counters: ${counters.map(([key, value]) => `${key} ${value}`).join(", ")}`
      : "",
    run.stopReason ? `stop reason: ${run.stopReason}` : "",
    run.errors.length > 0 ? plural(run.errors.length, "error", "errors") : "",
    full && firstError
      ? `first error: ${firstError.length > 200 ? `${firstError.slice(0, 200)}…` : firstError}`
      : "",
  ].filter(Boolean);
}

type Judged = {
  definition: JobDefinition;
  runs: JobRun[];
  record: JobRecord | null;
  /** Null when what the page judges the job by is not read here. */
  health: JobHealth | null;
  unread: string | null;
};

/** A job judged as the page judges it - or not at all, when the page goes by
 * something outside the ops database. A probe job that does report runs is
 * judged by them alone, and says what else the page looks at. */
function judge(
  definition: JobDefinition,
  runs: JobRun[],
  record: JobRecord | null,
  now: Date,
): Judged {
  const unread = unreadSource(definition);
  if (definition.captures || (unread && runs.length === 0)) {
    return { definition, runs, record, health: null, unread };
  }
  const health = jobHealth(definition, { runs, record }, now);
  return { definition, runs, record, health, unread };
}

function jobLine(job: Judged, now: Date): string {
  const id = job.definition.id;
  if (!job.health) {
    return `- ${id} · not read here · ${job.unread}, outside ops-writer's grant - see ${jobUrl(id)}`;
  }
  const newest = job.runs[0];
  return [
    `- ${id} · ${job.health.status} · ${job.health.detail}`,
    ...(newest
      ? [
          `newest run ${newest.id}: ${runFacts(newest, job.definition, now, false).join(", ")}`,
        ]
      : []),
    ...(job.unread ? [`not read here: ${job.unread}`] : []),
  ].join(" · ");
}

const runOf = (doc: Doc) => jobRunFromData(doc.id, doc.data);

/** The runs and records the page reads, read the way it reads them. */
async function readReported(store: JobReports) {
  const [recentDocs, recordDocs] = await Promise.all([
    store.recentRuns(RECENT_RUNS),
    store.records(),
  ]);
  const recent = recentDocs.map(runOf);
  const records = new Map(
    recordDocs.map((doc) => [doc.id, jobRecordFromData(doc.data)]),
  );
  const older = await store.runs(lastRunsMissing(records.values(), recent));
  return { runs: runsByJob([...recent, ...older.map(runOf)]), records };
}

const header = (store: JobReports, what: string, now: Date) =>
  `${what}, read from ${store.source} at ${now.toISOString()}.`;

/** Every job, one line each, in the page's sections and order. */
async function overview(store: JobReports, now: Date): Promise<string> {
  const { runs, records } = await readReported(store);
  const listed = JOBS.map((definition) =>
    judge(
      definition,
      runs.get(definition.id) ?? [],
      records.get(definition.id) ?? null,
      now,
    ),
  );
  const known = new Set(JOBS.map((job) => job.id));
  const others = [...new Set([...runs.keys(), ...records.keys()])]
    .filter((id) => !known.has(id))
    .sort()
    .map((id) => {
      const jobRuns = runs.get(id) ?? [];
      return judge(
        otherDefinition({ id, runs: jobRuns }),
        jobRuns,
        records.get(id) ?? null,
        now,
      );
    });
  const all = [...listed, ...others];

  const rank = (status: JobHealthStatus) => JOB_HEALTH.indexOf(status);
  const problems = all
    .filter((job) => job.health && isProblem(job.health.status))
    .sort((a, b) => rank(a.health!.status) - rank(b.health!.status));
  const rest = JOB_HEALTH.filter((status) => !isProblem(status))
    .map((status) => ({
      status,
      count: all.filter((job) => job.health?.status === status).length,
    }))
    .filter(({ count }) => count > 0);
  const unread = all.filter((job) => !job.health);

  const section = (title: string, jobs: Judged[]) =>
    jobs.length > 0
      ? ["", `## ${title}`, ...jobs.map((job) => jobLine(job, now))]
      : [];

  return [
    header(
      store,
      `Jobs as /admin/procesy judges them (frontend/shared/jobs.ts), on the newest ${RECENT_RUNS} runs and every job's record`,
      now,
    ),
    problems.length > 0
      ? `Needs a look: ${problems.length} - ${problems
          .map((job) => `${job.definition.id} (${job.health!.status})`)
          .join(", ")}.`
      : "Nothing needs a look.",
    `The rest: ${rest.map(({ status, count }) => `${status} ${count}`).join(", ") || "none"}.` +
      (unread.length > 0
        ? ` Not read here: ${unread.map((job) => job.definition.id).join(", ")} - see /admin/procesy.`
        : ""),
    "Times are Warsaw time. `job` lists a job's newest runs with their " +
      "counters; `run` gives one run whole. Link a run as " +
      `${runUrl("<id>")}.`,
    ...JOB_KINDS.flatMap((kind) =>
      section(
        KIND_TITLES[kind],
        listed.filter((job) => job.definition.kind === kind),
      ),
    ),
    ...section(OTHERS_TITLE, others),
  ].join("\n");
}

/** One job: its health, what it is, its record and its newest runs. */
async function jobDetail(
  store: JobReports,
  id: string,
  shown: number,
  now: Date,
): Promise<string> {
  const [docs, recordDocs] = await Promise.all([
    store.runsOf(id),
    store.records(),
  ]);
  const runs = runsByJob(docs.map(runOf)).get(id) ?? [];
  const recordDoc = recordDocs.find((doc) => doc.id === id);
  const record = recordDoc ? jobRecordFromData(recordDoc.data) : null;
  const registered = jobDefinition(id);
  if (!registered && runs.length === 0 && !record) {
    throw new Error(
      `There is no job ${id}: JOBS in frontend/shared/jobs.ts does not list ` +
        `it and nothing has reported under it. The jobs: ` +
        `${JOBS.map((job) => job.id).join(", ")}.`,
    );
  }
  const definition = registered ?? otherDefinition({ id, runs });
  const job = judge(definition, runs, record, now);

  const schedule = definition.schedule
    ? `daily at ${definition.schedule.dailyAt} ${definition.schedule.timeZone}` +
      (definition.probe || record?.lastScheduledAt
        ? ""
        : " - not yet run on it, so not held to it")
    : (definition.scheduleNote ?? "none");
  const recordText = record
    ? [
        record.lastRunId &&
          `last run ${record.lastRunId}` +
            (record.lastStartedAt
              ? `, started ${warsawStamp(record.lastStartedAt)}`
              : ""),
        record.lastScheduledAt &&
          `last on its schedule ${warsawStamp(record.lastScheduledAt)}`,
        record.lastSucceededAt &&
          `last succeeded ${warsawStamp(record.lastSucceededAt)}`,
      ]
        .filter(Boolean)
        .join("; ") || "empty"
    : "none";
  const health = job.health
    ? `${job.health.status} - ${job.health.detail}` +
      (job.unread ? ` Not read here: ${job.unread}.` : "")
    : `not read here - ${job.unread}, outside ops-writer's grant; see ${jobUrl(id)}`;
  const listedRuns = runs.slice(0, shown);

  return [
    header(
      store,
      `${id} as /admin/procesy judges it, on the ${plural(runs.length, "run", "runs")} reported under it`,
      now,
    ),
    `${definition.title}${registered ? "" : " (not in JOBS)"}: ${definition.summary}`,
    `Runs on: ${definition.runsOn}.` +
      (definition.command ? ` Command: ${definition.command}.` : "") +
      ` Schedule: ${schedule}.`,
    `Health: ${health}`,
    `Record (jobs/${id}): ${recordText}.`,
    ...(definition.tasks?.length
      ? [
          `Tasks: ${definition.tasks.map((task) => `${SITE}${taskLink(task)}`).join(", ")}`,
        ]
      : []),
    "Times are Warsaw time; `run` gives one run whole.",
    "",
    listedRuns.length > 0
      ? `## Newest ${plural(listedRuns.length, "run", "runs")}`
      : "## No runs reported",
    ...listedRuns.map(
      (run) =>
        `- ${run.id} · ${runFacts(run, definition, now, true).join(" · ")}`,
    ),
  ].join("\n");
}

/** Who asked for a run, by the name the page shows: the uid stays in the
 * database, as the feedback tools keep reporters' uids there. */
const withoutUid = ({ by: _uid, ...shown }: RunRequest) => shown;

/** A document as stored, with the same uid cut out of its request: one the
 * page cannot read is handed on whole, and a request the site wrote names
 * who asked (`requestPeopleRun` in server/utils/jobRequests.ts). */
function storedWithoutUid(data: Record<string, unknown>) {
  const { request } = data;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return data;
  }
  const { by: _uid, ...shown } = request as Record<string, unknown>;
  return { ...data, request: shown };
}

/** One run, everything it reported. */
async function runDetail(
  store: JobReports,
  id: string,
  now: Date,
): Promise<string> {
  const [doc] = await store.runs([id]);
  if (!doc) {
    return (
      `There is no run ${id} in jobRuns (${store.source}). A capture from ` +
      `the extension is a run under its articlePages id, which this tool ` +
      `does not read; ${runUrl(id)} shows it.`
    );
  }
  const run = runOf(doc);
  if (!run) {
    return JSON.stringify(
      {
        source: store.source,
        readAt: now.toISOString(),
        problem:
          "This document has no job, state or start time that can be read, " +
          "so /admin/procesy does not show it either.",
        id,
        data: storedWithoutUid(doc.data),
      },
      null,
      2,
    );
  }
  const definition =
    jobDefinition(run.job) ?? otherDefinition({ id: run.job, runs: [run] });
  const { request, ...rest } = run;
  return JSON.stringify(
    {
      source: store.source,
      readAt: now.toISOString(),
      run: {
        runLink: runUrl(run.id),
        jobTitle: definition.title,
        ...rest,
        request: request ? withoutUid(request) : undefined,
        status: stateText(run, definition, now),
        stalled: isStalled(run, definition, now),
        timing: timing(run, now),
      },
    },
    null,
    2,
  );
}

export type StatusArgs = {
  /** A job's id or row link: its newest runs. */
  job?: string;
  /** With `job`: how many runs. */
  runs?: number;
  /** A run's id, document path or link: the whole run. */
  run?: string;
};

/** The jobs on /admin/procesy, one job, or one run. */
export async function jobsStatus(
  store: JobReports,
  args: StatusArgs = {},
  now = new Date(),
): Promise<string> {
  if (args.job && args.run) {
    throw new Error("Give `job` or `run`, not both.");
  }
  if (args.run) return runDetail(store, runIdFrom(args.run), now);
  if (args.job) {
    return jobDetail(store, jobIdFrom(args.job), args.runs ?? RUNS_SHOWN, now);
  }
  return overview(store, now);
}
