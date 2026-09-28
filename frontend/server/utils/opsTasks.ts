import {
  Timestamp,
  getFirestore,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  OPS_DATABASE,
  TASKS_COLLECTION,
  applyTaskPatch,
  dependencyProblem,
  newTask,
  patchedDependsOn,
  taskFromData,
  taskSlug,
  uniqueTaskId,
} from "~~/shared/tasks";
import type {
  Task,
  TaskActor,
  taskCreateSchema,
  taskPatchSchema,
} from "~~/shared/tasks";
import type { z } from "zod";

/** The owner's task list (`shared/tasks.ts`), as /admin/zadania reads and
 * changes it. The MCP tools write the same documents over REST
 * (`scripts/mcp/ops-store.ts`); both keep the times as Timestamps. */

export const opsDb = (): Firestore => getFirestore(OPS_DATABASE);

/** Timestamps as the ISO strings `Task` holds them in. */
const plainTime = (value: unknown) =>
  value instanceof Timestamp ? value.toDate().toISOString() : value;

export function fromDoc(id: string, data: DocumentData): Task {
  return taskFromData(id, {
    ...data,
    createdAt: plainTime(data.createdAt),
    updatedAt: plainTime(data.updatedAt),
    closedAt: plainTime(data.closedAt),
    log: Array.isArray(data.log)
      ? data.log.map((entry: DocumentData | null) => ({
          ...entry,
          at: plainTime(entry?.at),
        }))
      : data.log,
  });
}

const stamp = (value: string) => Timestamp.fromDate(new Date(value));

/** A task as a document. `id` is the document's name, not a field. */
export function toDoc(task: Task): DocumentData {
  const { id: _id, createdAt, updatedAt, closedAt, log, ...rest } = task;
  const doc: Record<string, unknown> = {
    ...rest,
    createdAt: stamp(createdAt),
    updatedAt: stamp(updatedAt),
    closedAt: closedAt ? stamp(closedAt) : undefined,
    log: log.map((entry) => ({ ...entry, at: stamp(entry.at) })),
  };
  // Firestore refuses `undefined`; an unset field is left out instead.
  return Object.fromEntries(
    Object.entries(doc).filter(([, value]) => value !== undefined),
  );
}

export async function listTasks(db = opsDb()): Promise<Task[]> {
  const snap = await db.collection(TASKS_COLLECTION).get();
  return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
}

/** Refused with the reason in words, which the page shows as it is. */
const refuse = (message: string, statusCode = 400) =>
  createError({ statusCode, message });

export async function createTask(
  input: z.output<typeof taskCreateSchema>,
  by: TaskActor,
  db = opsDb(),
): Promise<Task> {
  const collection = db.collection(TASKS_COLLECTION);
  // Read everything in the transaction: the id and the dependencies are
  // judged against the list as it is when the task is written.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(collection);
    const tasks = snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
    const taken = new Set(tasks.map((task) => task.id));
    if (input.id && taken.has(input.id)) {
      throw refuse(`Jest już zadanie ${input.id}.`, 409);
    }
    const id = input.id ?? uniqueTaskId(taskSlug(input.title), taken);
    const problem = dependencyProblem(tasks, id, input.dependsOn);
    if (problem) throw refuse(problem);
    const task = newTask(input, id, by, new Date().toISOString());
    tx.create(collection.doc(id), toDoc(task));
    return task;
  });
}

export async function updateTask(
  id: string,
  patch: z.output<typeof taskPatchSchema>,
  by: TaskActor,
  db = opsDb(),
): Promise<Task> {
  const collection = db.collection(TASKS_COLLECTION);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(collection);
    const tasks = snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
    const current = tasks.find((task) => task.id === id);
    if (!current) throw refuse(`Nie ma zadania ${id}.`, 404);
    const problem = dependencyProblem(
      tasks,
      id,
      patchedDependsOn(current.dependsOn, patch),
      current.dependsOn,
    );
    if (problem) throw refuse(problem);
    const { task } = applyTaskPatch(
      current,
      patch,
      by,
      new Date().toISOString(),
    );
    tx.set(collection.doc(id), toDoc(task));
    return task;
  });
}
