/** The owner's task list (`shared/tasks.ts`), read and written by agents.
 *
 * The one place agent tooling may write to production, and only here: the
 * list lives in its own database, `agent-tasks`, and the account the writes
 * go out as, `ops-writer`, holds `roles/datastore.user` on that database
 * alone - an IAM condition on the database name - so it cannot touch the
 * site's data whatever the code here asks for. As with `firestore-reader`,
 * gcloud impersonates it and no key file exists. The one-time setup is in
 * frontend/README.md, "Agent tools".
 *
 * REST, for the reason firestore-reader.ts gives. A change is made in a
 * transaction that reads the whole list, so what it checks - that a new
 * dependency closes no loop, that an id is free - still holds when it is
 * written. Two agents joining two tasks in opposite directions at once cannot
 * both succeed: the second transaction is aborted, reads again and is refused.
 *
 * The jobs report their runs to the same database (`jobRuns`, `jobs`; see
 * shared/jobs.ts), so the same account reads those for `jobs_status` - and
 * only reads them: nothing here writes a run.
 *
 * With FIRESTORE_EMULATOR_HOST set it uses that emulator instead.
 */
import { JOBS_COLLECTION, JOB_RUNS_COLLECTION } from "../../shared/jobs";
import {
  OPS_DATABASE,
  TASKS_COLLECTION,
  taskFromData,
  type Task,
} from "../../shared/tasks";
import {
  decodeFields,
  impersonatedToken,
  type Doc,
  type RestValue,
} from "./firestore-reader";

const PROJECT = "koryta-pl";
const DOCUMENTS = `projects/${PROJECT}/databases/${OPS_DATABASE}/documents`;

export const DEFAULT_WRITER = `ops-writer@${PROJECT}.iam.gserviceaccount.com`;

const SETUP_HINT =
  'The ops database and the ops-writer account are set up once, as in frontend/README.md, "Agent tools".';

/** Writes queued inside a transaction, made when it commits. */
export type TaskWrites = {
  create(task: Task): void;
  replace(task: Task): void;
};

export type TaskStore = {
  /** Where the tasks are, for the answers to say. */
  source: string;
  /** Every task. The list is the owner's to-do list, a few hundred at most. */
  list(): Promise<Task[]>;
  /** Writes a new task on its own; false when the id is taken. */
  create(task: Task): Promise<boolean>;
  /** Runs `work` on the whole list and makes the writes it queues, all or
   * none. When another writer got in first the transaction is aborted and
   * `work` runs again on a fresh read - so it may run more than once, and
   * must not do anything but read and queue. */
  transaction<T>(
    work: (tasks: Task[], writes: TaskWrites) => T | Promise<T>,
  ): Promise<T>;
};

type RestDocument = {
  name: string;
  fields?: Record<string, RestValue>;
  updateTime?: string;
};

/** The fields stored as timestamps rather than strings, so that the admin SDK
 * on the server reads them as the Timestamps it writes. */
const TIMESTAMPS = new Set(["createdAt", "updatedAt", "closedAt"]);

function encodeValue(value: unknown, timestamp = false): RestValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (timestamp && typeof value === "string") return { timestampValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeValue(item)) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, encodeValue(v, k === "at")]),
        ),
      },
    };
  }
  throw new Error(`Cannot store ${typeof value}`);
}

/** A task as REST fields. `id` is the document's name, not a field. */
export function encodeTask(task: Task): Record<string, RestValue> {
  const { id: _id, ...fields } = task;
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeValue(value, TIMESTAMPS.has(key))]),
  );
}

/** A stored document as a task. Timestamps come back as ISO strings, to the
 * microsecond; `taskFromData` evens them out to the millisecond the rest of
 * the code writes. */
export const decodeTask = (doc: RestDocument): Task =>
  taskFromData(
    doc.name.slice(doc.name.lastIndexOf("/") + 1),
    decodeFields(doc.fields),
  );

/** Firestore's own message for a failed call, with what to do about the ones
 * that mean the setup is missing. */
async function failure(response: Response, source: string): Promise<Error> {
  const body = await response.text();
  let message = body.trim();
  try {
    const parsed = JSON.parse(body);
    message =
      (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message ?? message;
  } catch {
    // Not JSON - keep the body as it came.
  }
  const hint =
    response.status === 403 || response.status === 404
      ? ` ${source} is not reachable yet. ${SETUP_HINT}`
      : "";
  return new Error(`Firestore answered ${response.status}: ${message}.${hint}`);
}

/** What Firestore says when a write lost to another: a transaction aborted
 * by a conflicting one, or a create whose id was taken meanwhile. A 400 is
 * also what a malformed write gets, so the status alone does not say. */
const LOST_RACE = /ABORTED|ALREADY_EXISTS|FAILED_PRECONDITION/;

/** How many times a transaction is tried before giving up. */
const ATTEMPTS = 5;

/** Where the ops database is and how to reach it. */
export type OpsConnection = {
  /** `https://firestore.googleapis.com`, or the emulator's `http://host:port`. */
  origin: string;
  token: () => Promise<string>;
  source: string;
  fetch?: typeof fetch;
};

/** A POST to the database's documents: `:runQuery`, `:commit` and so on. */
function poster(options: OpsConnection) {
  const send = options.fetch ?? fetch;
  return async (path: string, body: unknown) =>
    send(`${options.origin}/v1/${DOCUMENTS}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await options.token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
}

export function restTaskStore(options: OpsConnection): TaskStore {
  const post = poster(options);

  /** The response when it succeeded, null when it lost a race. */
  async function attempt(path: string, body: unknown) {
    const response = await post(path, body);
    if (response.ok) return response;
    if (
      (response.status === 409 || response.status === 400) &&
      LOST_RACE.test(await response.clone().text())
    ) {
      return null;
    }
    throw await failure(response, options.source);
  }

  async function list(transaction?: string): Promise<Task[]> {
    const response = await post(":runQuery", {
      structuredQuery: { from: [{ collectionId: TASKS_COLLECTION }] },
      ...(transaction && { transaction }),
    });
    if (!response.ok) throw await failure(response, options.source);
    const rows = (await response.json()) as { document?: RestDocument }[];
    return rows.flatMap((row) =>
      row.document ? [decodeTask(row.document)] : [],
    );
  }

  const name = (id: string) => `${DOCUMENTS}/${TASKS_COLLECTION}/${id}`;
  const createWrite = (task: Task) => ({
    update: { name: name(task.id), fields: encodeTask(task) },
    currentDocument: { exists: false },
  });
  const replaceWrite = (task: Task) => ({
    update: { name: name(task.id), fields: encodeTask(task) },
    currentDocument: { exists: true },
  });

  return {
    source: options.source,

    list: () => list(),

    async create(task) {
      return (
        (await attempt(":commit", { writes: [createWrite(task)] })) !== null
      );
    },

    async transaction(work) {
      for (let tries = 0; tries < ATTEMPTS; tries++) {
        const begun = await post(":beginTransaction", {});
        if (!begun.ok) throw await failure(begun, options.source);
        const { transaction } = (await begun.json()) as { transaction: string };
        const queued: unknown[] = [];
        let result;
        try {
          result = await work(await list(transaction), {
            create: (task) => queued.push(createWrite(task)),
            replace: (task) => queued.push(replaceWrite(task)),
          });
        } catch (error) {
          // Let go of what the transaction read before saying why.
          await post(":rollback", { transaction }).catch(() => undefined);
          throw error;
        }
        if (queued.length === 0) {
          await post(":rollback", { transaction }).catch(() => undefined);
          return result;
        }
        if (await attempt(":commit", { writes: queued, transaction })) {
          return result;
        }
      }
      throw new Error(
        "The task list kept changing under this change; read it again and retry.",
      );
    },
  };
}

/** What the jobs have reported (shared/jobs.ts), as stored: times are the
 * REST API's ISO strings, and nothing is parsed yet. */
export type JobReports = {
  source: string;
  /** The newest runs of every job, newest first by start. */
  recentRuns(limit: number): Promise<Doc[]>;
  /** Every run of one job, in no particular order. An equality filter alone
   * is answered by the index Firestore keeps on every field; ordered by start
   * as well, it would want a composite index the ops database does not have.
   * A job reports a run or two a night, so all of them is a few hundred. */
  runsOf(job: string): Promise<Doc[]>;
  /** Those of `ids` that exist, in no particular order. */
  runs(ids: readonly string[]): Promise<Doc[]>;
  /** Every job's `jobs/{id}` record. */
  records(): Promise<Doc[]>;
};

const toDoc = (doc: RestDocument): Doc => ({
  id: doc.name.slice(doc.name.lastIndexOf("/") + 1),
  data: decodeFields(doc.fields),
});

export function restJobReports(options: OpsConnection): JobReports {
  const post = poster(options);

  async function query(structuredQuery: unknown): Promise<Doc[]> {
    const response = await post(":runQuery", { structuredQuery });
    if (!response.ok) throw await failure(response, options.source);
    const rows = (await response.json()) as { document?: RestDocument }[];
    return rows.flatMap((row) => (row.document ? [toDoc(row.document)] : []));
  }

  return {
    source: options.source,

    recentRuns: (limit) =>
      query({
        from: [{ collectionId: JOB_RUNS_COLLECTION }],
        orderBy: [
          { field: { fieldPath: "startedAt" }, direction: "DESCENDING" },
        ],
        limit,
      }),

    runsOf: (job) =>
      query({
        from: [{ collectionId: JOB_RUNS_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: "job" },
            op: "EQUAL",
            value: { stringValue: job },
          },
        },
      }),

    async runs(ids) {
      if (ids.length === 0) return [];
      // An id is one path segment. Anything else would name a document in
      // some other collection.
      const bad = ids.find((id) => !/^[^/]+$/.test(id));
      if (bad !== undefined) throw new Error(`Not a run id: "${bad}"`);
      const response = await post(":batchGet", {
        documents: ids.map((id) => `${DOCUMENTS}/${JOB_RUNS_COLLECTION}/${id}`),
      });
      if (!response.ok) throw await failure(response, options.source);
      const rows = (await response.json()) as { found?: RestDocument }[];
      return rows.flatMap((row) => (row.found ? [toDoc(row.found)] : []));
    },

    records: () => query({ from: [{ collectionId: JOBS_COLLECTION }] }),
  };
}

/** The ops database: in production as `ops-writer`, or in the emulator. One
 * connection serves the tasks and the job reports alike, so that they share
 * the token gcloud mints. */
export function opsConnection(
  env: NodeJS.ProcessEnv = process.env,
): OpsConnection {
  const emulator = env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    return {
      origin: `http://${emulator}`,
      token: async () => "owner",
      source: `the Firestore emulator at ${emulator} (database ${OPS_DATABASE})`,
    };
  }
  const account = env.KORYTA_OPS_WRITER || DEFAULT_WRITER;
  return {
    origin: "https://firestore.googleapis.com",
    token: impersonatedToken(account),
    source: `production (${PROJECT}/${OPS_DATABASE}) as ${account}`,
  };
}

export const connectTasks = (env: NodeJS.ProcessEnv = process.env): TaskStore =>
  restTaskStore(opsConnection(env));
