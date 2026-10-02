import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { OPS_DATABASE } from "~~/shared/tasks";
import {
  JOBS,
  JOBS_COLLECTION,
  JOB_RUNS_COLLECTION,
  CAPTURE_WINDOW_DAYS,
  RUNS_SHOWN,
  RUN_STATES,
  captureRun,
  compareRunsNewest,
  jobRunFromData,
  mirrorWrites,
} from "~~/shared/jobs";
import type {
  CaptureStats,
  ExportState,
  JobDefinition,
  JobProbe,
  JobRecord,
  JobRun,
  JobView,
  JobsOverview,
  MirrorHostState,
  ProbeResult,
  RunState,
} from "~~/shared/jobs";
import type { CaptureStatus } from "~~/shared/capture";
import { toArticleCapture } from "~~/server/utils/captures";
import { CRAWLED_BUCKET } from "~~/server/utils/crawledBucket";

/** What /admin/procesy reads (shared/jobs.ts): the runs the jobs report, the
 * captures for the one job marked `captures`, and the two buckets that say
 * how the silent jobs are doing. */

export const COMPRESSED_BUCKET = "koryta-pl-compressed";

/** Reported runs read per request. Runs are documents per run, not per
 * heartbeat, so this is a few months of nightly jobs; a job whose newest run
 * is older still comes back through its `jobs/{id}` record. */
const RECENT_RUNS = 300;

/** Newest captures shown; older ones still waiting or running are added on
 * top of these, since those are the ones that need looking at. */
const CAPTURES_SHOWN = 20;
const OPEN_CAPTURES = 20;

const iso = (value: unknown): unknown =>
  value instanceof Timestamp ? value.toDate().toISOString() : value;

const isoOrNull = (value: unknown): string | null => {
  const plain = iso(value);
  return typeof plain === "string" && plain ? plain : null;
};

/** A run document's data with its times as ISO strings. */
export function runFromDoc(id: string, data: DocumentData): JobRun | null {
  return jobRunFromData(id, {
    ...data,
    startedAt: iso(data.startedAt),
    heartbeatAt: iso(data.heartbeatAt),
    finishedAt: iso(data.finishedAt),
  });
}

export function recordFromDoc(data: DocumentData): JobRecord {
  return {
    lastRunId: typeof data.lastRunId === "string" ? data.lastRunId : null,
    lastStartedAt: isoOrNull(data.lastStartedAt),
    lastScheduledAt: isoOrNull(data.lastScheduledAt),
    lastSucceededAt: isoOrNull(data.lastSucceededAt),
  };
}

const opsDb = () => getFirestore(OPS_DATABASE);

/** Every job's newest reported runs, newest first, and its record. */
export async function reportedRuns(): Promise<{
  runs: Map<string, JobRun[]>;
  records: Map<string, JobRecord>;
}> {
  const db = opsDb();
  const [runSnapshot, recordSnapshot] = await Promise.all([
    db
      .collection(JOB_RUNS_COLLECTION)
      .orderBy("startedAt", "desc")
      .limit(RECENT_RUNS)
      .get(),
    db.collection(JOBS_COLLECTION).get(),
  ]);

  const runs = new Map<string, JobRun[]>();
  const add = (run: JobRun | null) => {
    if (!run) return;
    const list = runs.get(run.job) ?? [];
    if (list.some((known) => known.id === run.id)) return;
    list.push(run);
    runs.set(run.job, list);
  };
  for (const doc of runSnapshot.docs) add(runFromDoc(doc.id, doc.data()));

  const records = new Map<string, JobRecord>();
  for (const doc of recordSnapshot.docs) {
    records.set(doc.id, recordFromDoc(doc.data()));
  }

  // A job that has not run lately has fallen out of the recent window; its
  // record still names its newest run.
  const missing = [...records.entries()]
    .filter(
      ([job, record]) =>
        record.lastRunId &&
        !runs.get(job)?.some((run) => run.id === record.lastRunId),
    )
    .map(([, record]) =>
      db.collection(JOB_RUNS_COLLECTION).doc(record.lastRunId!),
    );
  if (missing.length) {
    for (const doc of await db.getAll(...missing)) {
      if (doc.exists) add(runFromDoc(doc.id, doc.data()!));
    }
  }

  for (const list of runs.values()) list.sort(compareRunsNewest);
  return { runs, records };
}

/** The newest captures and any older ones still open, as runs, with a week's
 * counts per state.
 *
 * Every query orders by `capturedAt` descending, as the (status ASC,
 * capturedAt DESC) index the capture list already has does: a range on
 * `capturedAt` with no order of its own would ask for an ascending index,
 * which does not exist. The counts are read apart from the lists, so a count
 * that fails costs the week's numbers and not the captures themselves. */
export async function captureRuns(now: Date): Promise<{
  runs: JobRun[];
  stats: CaptureStats | null;
  statsError?: string;
}> {
  const pages = getFirestore("koryta-pl").collection("articlePages");
  const since = new Date(now.getTime() - CAPTURE_WINDOW_DAYS * 86_400_000);
  const statuses: CaptureStatus[] = ["stored", "extracting", "done", "error"];
  const lastWeek = (status: CaptureStatus) =>
    pages
      .where("status", "==", status)
      .where("capturedAt", ">=", Timestamp.fromDate(since))
      .orderBy("capturedAt", "desc");

  const counting = Promise.all(
    statuses.map((status) => lastWeek(status).count().get()),
  );
  const [recent, ...open] = await Promise.all([
    pages.orderBy("capturedAt", "desc").limit(CAPTURES_SHOWN).get(),
    // Open ones from the last week only: older ones are just as stuck, but a
    // capture nothing has picked up for a week is a fact about last week,
    // and would keep the row red for good.
    ...(["stored", "extracting"] as const).map((status) =>
      lastWeek(status).limit(OPEN_CAPTURES).get(),
    ),
  ]);

  const seen = new Set<string>();
  const runs: JobRun[] = [];
  for (const snapshot of [recent!, ...open]) {
    for (const doc of snapshot.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      runs.push(captureRun(toArticleCapture(doc.id, doc.data())));
    }
  }
  runs.sort(compareRunsNewest);

  const stateOf: Record<CaptureStatus, RunState> = {
    stored: "queued",
    extracting: "running",
    done: "succeeded",
    error: "failed",
  };
  try {
    const counts = await counting;
    const byState = Object.fromEntries(
      RUN_STATES.map((state) => [state, 0]),
    ) as Record<RunState, number>;
    statuses.forEach((status, index) => {
      byState[stateOf[status]] += counts[index]!.data().count;
    });
    return { runs, stats: { since: since.toISOString(), byState } };
  } catch (error) {
    console.error("Counting captures failed", error);
    return { runs, stats: null, statsError: describeError(error) };
  }
}

/** The newest archive per host in the compressed mirror. Each host holds a
 * handful of objects - one per compressor run - so listing it is cheap. */
export async function compressedMirror(
  hosts: string[],
): Promise<MirrorHostState[]> {
  const bucket = getStorage(getApp()).bucket(COMPRESSED_BUCKET);
  return Promise.all(
    hosts.map(async (host) => {
      const [files] = await bucket.getFiles({ prefix: `hostname=${host}/` });
      const archives = files.flatMap((file) => {
        // hostname=<h>/from=<a>/date=<b>.tar.gz, or .../total/date=<b>.tar.gz
        const match = /\/date=(\d{4}-\d{2}-\d{2})\.tar\.gz$/.exec(file.name);
        return match
          ? [{ file, through: match[1]!, total: file.name.includes("/total/") }]
          : [];
      });
      // A host with a total/ snapshot is read from the newest one alone and
      // its deltas are ignored (`_pick_archives` in
      // data/pipelines/src/stores/download.py), so a delta newer than the
      // snapshot is not what any pipeline gets.
      const read = archives.some((archive) => archive.total)
        ? archives.filter((archive) => archive.total)
        : archives;
      let newest: MirrorHostState = {
        host,
        through: null,
        archivedAt: null,
        bytes: null,
      };
      for (const { file, through } of read) {
        if (newest.through && newest.through >= through) continue;
        newest = {
          host,
          through,
          archivedAt: file.metadata.timeCreated ?? null,
          bytes:
            file.metadata.size === undefined
              ? null
              : Number(file.metadata.size),
        };
      }
      return newest;
    }),
  );
}

const EXPORT_PREFIX = "hostname=koryta.pl/";

/** The newest Firestore export from the last two UTC days.
 *
 * The export writes `hostname=koryta.pl/date=<UTC ISO timestamp>/`, and the
 * last thing it writes is `<folder>/<folder>.overall_export_metadata`. A
 * delimiter listing per day returns only the folders, not the thousands of
 * objects inside them. */
export async function latestFirestoreExport(
  now: Date,
): Promise<ExportState | null> {
  const bucket = getStorage(getApp()).bucket(CRAWLED_BUCKET);
  const days = [0, 1].map((back) =>
    new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10),
  );
  for (const day of days) {
    const [, , response] = await bucket.getFiles({
      prefix: `${EXPORT_PREFIX}date=${day}`,
      delimiter: "/",
      autoPaginate: false,
    });
    const folders = (
      (response as { prefixes?: string[] } | undefined)?.prefixes ?? []
    )
      .map((prefix) => prefix.slice(EXPORT_PREFIX.length).replace(/\/$/, ""))
      // Only an export's folder carries a time. A bare `date=<day>/` is the
      // crawl layout, which a capture of a koryta.pl page writes under this
      // same prefix (crawlArchivePath); read as an export it would have no
      // marker, and two hours later the page would call the export failed.
      .filter(
        (folder) =>
          /^date=\d{4}-\d{2}-\d{2}T/.test(folder) &&
          !Number.isNaN(Date.parse(folder.slice("date=".length))),
      )
      .sort();
    const folder = folders.at(-1);
    if (!folder) continue;
    const startedAt = new Date(folder.slice("date=".length));
    let finishedAt: string | null = null;
    try {
      const [metadata] = await bucket
        .file(`${EXPORT_PREFIX}${folder}/${folder}.overall_export_metadata`)
        .getMetadata();
      finishedAt = metadata.timeCreated ?? null;
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw error;
    }
    return { folder, startedAt: startedAt.toISOString(), finishedAt };
  }
  return null;
}

/** Bucket probes cost a listing each, and the page refreshes every minute
 * while it is open; the answers change once a night. */
const PROBE_TTL_MS = 5 * 60_000;
const probeCache = new Map<string, { at: number; value: ProbeResult }>();

export function clearProbeCache() {
  probeCache.clear();
}

function describeError(error: unknown): string {
  const code = (error as { code?: number | string }).code;
  if (code === 403 || code === 401) return "brak dostępu do zasobnika";
  return error instanceof Error ? error.message : String(error);
}

async function probe(
  definition: JobDefinition,
  now: Date,
): Promise<ProbeResult | null> {
  const kind = definition.probe;
  if (!kind) return null;
  // The emulators have no buckets to list, and the real ones are
  // production's. `FIRESTORE_EMULATOR_HOST` as well as `USE_EMULATORS`:
  // dev:build sets USE_EMULATORS for the build alone, and the server it then
  // serves only has the emulator host the firebase plugin sets at start.
  if (
    process.env.USE_EMULATORS === "true" ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  ) {
    return { kind, error: "lokalnie zasobniki nie są sprawdzane" };
  }
  const cached = probeCache.get(definition.id);
  if (cached && now.getTime() - cached.at < PROBE_TTL_MS) return cached.value;

  let value: ProbeResult;
  try {
    value =
      kind === "compressedMirror"
        ? {
            kind,
            hosts: await compressedMirror(definition.mirrorHosts ?? []),
          }
        : { kind, latest: await latestFirestoreExport(now) };
  } catch (error) {
    console.warn(`Job probe ${definition.id} failed`, error);
    value = { kind: kind as JobProbe, error: describeError(error) };
  }
  probeCache.set(definition.id, { at: now.getTime(), value });
  return value;
}

/** A mirror probe with what its hosts' writers have done since each newest
 * archive. Per request and on a copy: the probe itself is cached for minutes,
 * the runs are read fresh. */
function withWrites(
  probe: ProbeResult | null,
  definition: JobDefinition,
  reported: Awaited<ReturnType<typeof reportedRuns>> | null,
): ProbeResult | null {
  if (!probe || !reported || probe.kind !== "compressedMirror") return probe;
  if (!("hosts" in probe)) return probe;
  return {
    ...probe,
    hosts: mirrorWrites(
      probe.hosts,
      definition.mirrorWriters,
      (job) => reported.runs.get(job) ?? [],
    ),
  };
}

/** Everything /admin/procesy shows, in one request. Each source is read on
 * its own, and a source that fails is named in `problems` instead of failing
 * the page. */
export async function jobsOverview(now = new Date()): Promise<JobsOverview> {
  const problems: string[] = [];
  const [reported, captures, probes] = await Promise.all([
    reportedRuns().catch((error) => {
      console.error("Reading job runs failed", error);
      problems.push(
        `Nie udało się wczytać zgłoszonych uruchomień: ${describeError(error)}`,
      );
      return null;
    }),
    captureRuns(now).catch((error) => {
      console.error("Reading captures failed", error);
      problems.push(
        `Nie udało się wczytać zapisanych artykułów: ${describeError(error)}`,
      );
      return null;
    }),
    Promise.all(JOBS.map((job) => probe(job, now))),
  ]);
  if (captures?.statsError) {
    problems.push(
      `Nie udało się policzyć zapisów z ostatniego tygodnia: ${captures.statsError}`,
    );
  }

  const jobs: JobView[] = JOBS.map((definition, index) => {
    // Only the captures job's runs are captures. The imports are triggered
    // too, but they report their runs like every other job.
    if (definition.captures) {
      return {
        id: definition.id,
        runs: captures?.runs ?? [],
        record: null,
        captureStats: captures?.stats ?? null,
        ...(captures ? {} : { unavailable: true }),
      };
    }
    return {
      id: definition.id,
      runs: (reported?.runs.get(definition.id) ?? []).slice(0, RUNS_SHOWN),
      record: reported?.records.get(definition.id) ?? null,
      probe: withWrites(probes[index] ?? null, definition, reported),
      ...(reported ? {} : { unavailable: true }),
    };
  });

  const known = new Set(JOBS.map((job) => job.id));
  const others: JobView[] = [];
  if (reported) {
    const ids = new Set([...reported.runs.keys(), ...reported.records.keys()]);
    for (const id of [...ids].sort()) {
      if (known.has(id)) continue;
      others.push({
        id,
        runs: (reported.runs.get(id) ?? []).slice(0, RUNS_SHOWN),
        record: reported.records.get(id) ?? null,
      });
    }
  }

  return { generatedAt: now.toISOString(), jobs, others, problems };
}
