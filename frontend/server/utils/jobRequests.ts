/** Runs asked for on the site's pages, and single runs for their links.
 *
 * The datascience group can ask, from a company's page or a person's, for
 * what the pipelines know about it to be sent to the site now. The site does
 * not do it - it has neither the pipelines nor their data - it queues a run:
 * a `jobRuns/{id}` document in the ops database, in state `queued`, with what
 * was asked under `request`. /admin/procesy shows it at once, and the link
 * handed back (`runLink`) names it. The VM's worker takes it from there
 * (data/pipelines/src/stores/job_requests.py, whose field names these are)
 * and the job reports on the same document until it ends.
 */
import { randomUUID } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import { generateEntityUrl } from "~~/app/composables/slugs";
import {
  JOB_RUNS_COLLECTION,
  PEOPLE_REQUEST,
  captureRun,
  compareRunsNewest,
  isFinished,
  type JobRun,
  type RequestTarget,
} from "~~/shared/jobs";
import { OPS_DATABASE } from "~~/shared/tasks";
import { toArticleCapture } from "~~/server/utils/captures";
import { runFromDoc } from "~~/server/utils/jobs";
import { startRunner } from "~~/server/utils/jobRunner";
import { resolveMergedNode } from "~~/server/utils/merge";

export const jobRequestSchema = z.object({
  /** The page the button was on. */
  nodeId: z.string().min(1).max(200),
  /** Build and count; send nothing. */
  dryRun: z.boolean().optional().default(false),
});
export type JobRequestInput = z.output<typeof jobRequestSchema>;

/** Runs waiting at once, across every page. More is somebody's script, or a
 * runner that has been down for a day - either way not a queue to add to. */
export const MAX_QUEUED = 20;

const opsDb = () => getFirestore(OPS_DATABASE);
const siteDb = () => getFirestore("koryta-pl");

const refuse = (statusCode: number, message: string) =>
  createError({ statusCode, message });

/** A KRS number as the employments carry it: ten digits, zero-padded. A
 * page's `krsNumber` is whatever an editor typed. */
export function paddedKrs(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  return digits.padStart(10, "0");
}

/** The page a request names, as the run needs it. */
async function targetOf(nodeId: string): Promise<{
  id: string;
  target: RequestTarget;
  name: string;
  krs: string | null;
  rejestrIo: string | null;
  link: string;
}> {
  // Through a merge to the page that is left: a request from a stale tab on
  // a duplicate is about the person the duplicate now points at.
  const { id, snapshot } = await resolveMergedNode(siteDb(), nodeId);
  const data = snapshot?.data();
  if (!data || data.deleted === true) {
    throw refuse(404, "Nie ma takiej strony.");
  }
  const name = typeof data.name === "string" ? data.name : id;
  if (data.type === "place") {
    const krs = paddedKrs(data.krsNumber);
    if (!krs) {
      throw refuse(
        400,
        "Ta firma nie ma numeru KRS, a po nim szukamy ludzi, którzy w niej pracowali.",
      );
    }
    return {
      id,
      target: "company",
      name,
      krs,
      rejestrIo: null,
      link: generateEntityUrl("place", id, name),
    };
  }
  if (data.type === "person") {
    return {
      id,
      target: "person",
      name,
      krs: null,
      rejestrIo: typeof data.rejestrIo === "string" ? data.rejestrIo : null,
      link: generateEntityUrl("person", id, name),
    };
  }
  throw refuse(400, "Dane można wysłać tylko ze strony firmy albo osoby.");
}

/** The asked-for runs of one page, newest first. */
export async function runsForNode(
  nodeId: string,
  limit = 5,
): Promise<JobRun[]> {
  const snapshot = await opsDb()
    .collection(JOB_RUNS_COLLECTION)
    .where("request.nodeId", "==", nodeId)
    .get();
  return snapshot.docs
    .map((doc) => runFromDoc(doc.id, doc.data()))
    .filter((run): run is JobRun => run !== null && run.job === PEOPLE_REQUEST)
    .sort(compareRunsNewest)
    .slice(0, limit);
}

/** Queue a run for a page's people, and start the machine for it.
 *
 * A page with a run already waiting or going gets that run back rather than
 * a second one: two runs of the same people would only race each other to
 * the same pages. */
export async function requestPeopleRun(
  input: JobRequestInput,
  user: DecodedIdToken,
  now: Date = new Date(),
): Promise<{ run: JobRun; reused: boolean }> {
  const page = await targetOf(input.nodeId);

  const open = (await runsForNode(page.id)).find(
    (run) => !isFinished(run.state),
  );
  if (open) return { run: open, reused: true };

  const runs = opsDb().collection(JOB_RUNS_COLLECTION);
  const waiting = await runs.where("state", "==", "queued").get();
  if (waiting.size >= MAX_QUEUED) {
    throw refuse(
      429,
      `W kolejce czeka już ${waiting.size} zleceń - poczekaj, aż maszyna je zrobi (/admin/procesy).`,
    );
  }

  const id = randomUUID();
  const at = Timestamp.fromDate(now);
  const doc = {
    job: PEOPLE_REQUEST,
    state: "queued",
    trigger: "request",
    host: null,
    // When it was asked, until a job starts it and says when that was.
    startedAt: at,
    heartbeatAt: at,
    finishedAt: null,
    progress: null,
    counters: {},
    phase: null,
    stopReason: null,
    errors: [],
    exitCode: null,
    summaryPath: null,
    version: null,
    title: page.name,
    link: page.link,
    request: {
      target: page.target,
      nodeId: page.id,
      name: page.name,
      krs: page.krs,
      rejestrIo: page.rejestrIo,
      dryRun: input.dryRun,
      by: user.uid,
      byName: typeof user.name === "string" ? user.name : null,
      at,
    },
  };
  const ref = runs.doc(id);
  await ref.create(doc);

  const dispatch = await startRunner(now);
  try {
    await ref.update({
      dispatch: { ...dispatch, at: Timestamp.fromDate(new Date(dispatch.at)) },
    });
  } catch (error) {
    // The run is queued either way; only the page's note about the machine
    // is lost.
    console.error("Recording the runner's start failed", id, error);
  }

  const run = runFromDoc(id, { ...doc, dispatch });
  if (!run) throw refuse(500, "Zlecenie zapisano, ale nie da się go odczytać.");
  return { run, reused: false };
}

/** Start the machine again for a run still waiting - the first start was
 * refused, or the VM was switching off just then. */
export async function redispatch(id: string, now: Date = new Date()) {
  const ref = opsDb().collection(JOB_RUNS_COLLECTION).doc(id);
  const snapshot = await ref.get();
  const run = snapshot.exists ? runFromDoc(id, snapshot.data()!) : null;
  if (!run || run.job !== PEOPLE_REQUEST) {
    throw refuse(404, "Nie ma takiego zlecenia.");
  }
  if (run.state !== "queued") {
    throw refuse(409, "To zlecenie już ktoś podjął.");
  }
  const dispatch = await startRunner(now);
  await ref.update({
    dispatch: { ...dispatch, at: Timestamp.fromDate(new Date(dispatch.at)) },
  });
  return { ...run, dispatch };
}

/** One run, for its link: a reported or asked-for run from the ops database,
 * else a capture - which is a run under its `articlePages` id. */
export async function oneRun(id: string): Promise<JobRun | null> {
  const reported = await opsDb().collection(JOB_RUNS_COLLECTION).doc(id).get();
  if (reported.exists) return runFromDoc(id, reported.data()!);
  const page = await siteDb().collection("articlePages").doc(id).get();
  if (page.exists) return captureRun(toArticleCapture(id, page.data()!));
  return null;
}
