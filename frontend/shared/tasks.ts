/** The owner's own to-do list: what is left to deploy, run, decide or build,
 * and what has to happen before what.
 *
 * It lives in its own Firestore database, `agent-tasks`, next to the site's
 * `koryta-pl` rather than in it. Agents write to it (through the `koryta` MCP
 * server) and they may only read the site's data, and IAM can be narrowed to
 * a database but not to a collection. It also keeps the list out of the
 * nightly export that every pipeline and agent reads: an entry may name a
 * rules hole or research about a person.
 *
 * Everything here is plain data and pure functions, shared by the page
 * (/admin/zadania), the server routes behind it and the MCP tools, so that the
 * three agree on what "ready" means and on which dependencies are refused.
 */
import { z } from "zod";

/** Not `ops`: Firestore refuses database ids shorter than four characters. */
export const OPS_DATABASE = "agent-tasks";
export const TASKS_COLLECTION = "tasks";

/** What sort of thing is to be done.
 * - `action`: a step on production or infrastructure - deploy, upload, run a
 *   migration, grant a role, merge a branch.
 * - `task`: work in a checkout - code, a pipeline, research.
 * - `decision`: a question only the owner can answer.
 * - `idea`: worth doing some day, nobody committed to it. */
export const TASK_KINDS = ["action", "task", "decision", "idea"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Who can do it: the owner (his credentials, access or judgement) or an agent
 * on the dev box, end to end. */
export const TASK_WHO = ["owner", "agent"] as const;
export type TaskWho = (typeof TASK_WHO)[number];

export const TASK_STATUSES = [
  "open",
  "doing",
  "parked",
  "done",
  "dropped",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Closed means nobody has to act on it again, either way. A task depending on
 * a dropped one is not held up by it: whatever it waited for is not coming, so
 * it is for whoever reads it to decide what that means. */
export const CLOSED_STATUSES: readonly TaskStatus[] = ["done", "dropped"];

export const isClosed = (task: Pick<Task, "status">) =>
  CLOSED_STATUSES.includes(task.status);

/** Who made a change: the owner on the page, or an agent through the MCP
 * server, optionally with a label saying which (a session id, say). */
export type TaskActor = "owner" | "agent" | `agent:${string}`;

export type TaskLogEntry = {
  /** ISO timestamp. */
  at: string;
  by: TaskActor;
  text: string;
};

export type Task = {
  /** A slug made from the first title, never changed - it is what
   * `dependsOn` and the links (`/admin/zadania#t-<id>`) point at. */
  id: string;
  title: string;
  /** Context and the exact commands, as plain text. */
  body: string;
  kind: TaskKind;
  who: TaskWho;
  status: TaskStatus;
  /** Ids of the tasks that have to be closed before this one can start. */
  dependsOn: string[];
  tags: string[];
  /** Links, `#fb-` report links, file paths - anything to open. */
  links: string[];
  /** Branches (bookmarks) the task is about, by name - which lets something
   * later notice when one of them lands on main. */
  branches: string[];
  /** Hand-set order within a list: lower comes first; unset sorts after. */
  rank?: number;
  /** Where the task came from: a session, a memory note, a report. */
  source?: string;
  createdAt: string;
  updatedAt: string;
  /** When it was closed, if it is. */
  closedAt?: string;
  createdBy: TaskActor;
  log: TaskLogEntry[];
};

const isoTime = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const oneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
  fallback: T,
): T => (values.includes(value as T) ? (value as T) : fallback);

/** A stored task, from its document's data with the times as ISO strings.
 * Fills in what an older or hand-edited document lacks, and replaces values
 * it does not know, rather than failing: one odd document should not take
 * the whole list down. */
export function taskFromData(id: string, data: Record<string, unknown>): Task {
  const epoch = new Date(0).toISOString();
  const actor = (value: unknown): TaskActor =>
    typeof value === "string" && /^(owner|agent)(:|$)/.test(value)
      ? (value as TaskActor)
      : "agent";
  const task: Task = {
    id,
    title: typeof data.title === "string" && data.title ? data.title : id,
    body: typeof data.body === "string" ? data.body : "",
    kind: oneOf(TASK_KINDS, data.kind, "task"),
    who: oneOf(TASK_WHO, data.who, "owner"),
    status: oneOf(TASK_STATUSES, data.status, "open"),
    dependsOn: stringList(data.dependsOn),
    tags: stringList(data.tags),
    links: stringList(data.links),
    branches: stringList(data.branches),
    createdAt: isoTime(data.createdAt) ?? epoch,
    updatedAt: isoTime(data.updatedAt) ?? epoch,
    createdBy: actor(data.createdBy),
    log: Array.isArray(data.log)
      ? (data.log as unknown[]).map((raw) => {
          const entry = (raw ?? {}) as Record<string, unknown>;
          return {
            at: isoTime(entry.at) ?? epoch,
            by: actor(entry.by),
            text: String(entry.text ?? ""),
          };
        })
      : [],
  };
  if (typeof data.rank === "number") task.rank = data.rank;
  if (typeof data.source === "string") task.source = data.source;
  const closedAt = isoTime(data.closedAt);
  if (closedAt) task.closedAt = closedAt;
  return task;
}

export const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TASK_ID_MAX = 80;
/** How much history one task keeps. A task is one document, and a document
 * has a size limit; the oldest entries go first. */
export const LOG_KEEP = 200;

const id = z
  .string()
  .max(TASK_ID_MAX)
  .regex(TASK_ID_PATTERN, "an id is lowercase words joined by hyphens");
const title = z.string().trim().min(1).max(200);
const body = z.string().max(20_000);
const tags = z.array(z.string().trim().min(1).max(40)).max(12);
const links = z.array(z.string().trim().min(1).max(500)).max(30);
const branches = z.array(z.string().trim().min(1).max(100)).max(20);
const dependsOn = z.array(id).max(50);

export const taskCreateSchema = z.object({
  /** A slug to use instead of one made from the title. */
  id: id.optional(),
  title,
  body: body.default(""),
  kind: z.enum(TASK_KINDS).default("task"),
  who: z.enum(TASK_WHO).default("owner"),
  status: z.enum(TASK_STATUSES).default("open"),
  dependsOn: dependsOn.default([]),
  tags: tags.default([]),
  links: links.default([]),
  branches: branches.default([]),
  rank: z.number().finite().optional(),
  source: z.string().max(500).optional(),
});
export type TaskCreate = z.input<typeof taskCreateSchema>;

export const taskPatchSchema = z
  .object({
    title: title.optional(),
    body: body.optional(),
    kind: z.enum(TASK_KINDS).optional(),
    who: z.enum(TASK_WHO).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    tags: tags.optional(),
    links: links.optional(),
    branches: branches.optional(),
    /** `null` takes the task out of the hand-set order. */
    rank: z.number().finite().nullable().optional(),
    /** The whole list, as the page's editor has it. */
    dependsOn: dependsOn.optional(),
    /** Or changes to it, as an agent says "this also waits for that". */
    addDependsOn: dependsOn.optional(),
    removeDependsOn: dependsOn.optional(),
    /** A line for the task's history. */
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .refine(
    (patch) =>
      Object.values(patch as Record<string, unknown>).some(
        (value) => value !== undefined,
      ),
    { message: "nothing to change" },
  );
export type TaskPatch = z.input<typeof taskPatchSchema>;

const POLISH_LETTERS: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/** Lowercase ASCII words, with Polish letters folded rather than dropped
 * (`ł` has no decomposition, so NFKD alone would lose it). */
export function foldWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (letter) => POLISH_LETTERS[letter]!)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** An id for a new task, from its title: the first words, cut at a word so
 * that it stays readable in a link. */
export function taskSlug(text: string, max = 60): string {
  let slug = "";
  for (const word of foldWords(text)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > max) break;
    slug = next;
  }
  return slug || foldWords(text).join("").slice(0, max) || "zadanie";
}

/** `base`, or `base-2`, `base-3`… if that is taken. */
export function uniqueTaskId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, TASK_ID_MAX - `-${n}`.length)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What a task is waiting on right now.
 * - `ready`: open or in progress, and everything it depends on is closed.
 * - `blocked`: open or in progress, with something it depends on still open.
 * - `parked`: put aside on purpose, whatever its dependencies.
 * - `closed`: done or dropped. */
export type Readiness = "ready" | "blocked" | "parked" | "closed";

export type TaskState = {
  readiness: Readiness;
  /** What it waits for that is not closed yet. */
  blockers: Task[];
  /** Dependencies naming no task that exists. Ignored for readiness - a task
   * waiting on nothing that can ever close would wait forever. */
  missing: string[];
  /** The tasks that wait for this one. */
  dependents: Task[];
};

export function taskStates(tasks: readonly Task[]): Map<string, TaskState> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dependents = new Map<string, Task[]>();
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task);
    }
  }
  const states = new Map<string, TaskState>();
  for (const task of tasks) {
    const known = task.dependsOn.flatMap((dep) => byId.get(dep) ?? []);
    const blockers = known.filter((dep) => !isClosed(dep));
    let readiness: Readiness;
    if (isClosed(task)) readiness = "closed";
    else if (task.status === "parked") readiness = "parked";
    else readiness = blockers.length > 0 ? "blocked" : "ready";
    states.set(task.id, {
      readiness,
      blockers,
      missing: task.dependsOn.filter((dep) => !byId.has(dep)),
      dependents: dependents.get(task.id) ?? [],
    });
  }
  return states;
}

/** The chain of ids that `task` depending on `dependsOn` would close into a
 * loop, from the task back to itself, or null if there is none. A loop would
 * leave every task on it waiting for the others for good. */
export function dependencyCycle(
  tasks: readonly Pick<Task, "id" | "dependsOn">[],
  taskId: string,
  dependsOn: readonly string[],
): string[] | null {
  const edges = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  edges.set(taskId, [...dependsOn]);
  // Walk what the new dependencies depend on, and so on; reaching the task
  // again is the loop. Depth first, so the path is the one that got there.
  const seen = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === taskId) return [taskId, ...path];
    if (seen.has(id)) return null;
    seen.add(id);
    for (const next of edges.get(id) ?? []) {
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  for (const dep of dependsOn) {
    const found = walk(dep, [dep]);
    if (found) return found;
  }
  return null;
}

/** Why `dependsOn` cannot be the dependency list of `taskId`, in words for
 * whoever asked, or null when it can.
 *
 * Only what is added to `before` is judged: taking a dependency away never
 * makes a loop, and a list that already names a task nobody can find should
 * not stop every other edit of the task. */
export function dependencyProblem(
  tasks: readonly Pick<Task, "id" | "dependsOn">[],
  taskId: string,
  dependsOn: readonly string[],
  before: readonly string[] = [],
): string | null {
  const added = dependsOn.filter((dep) => !before.includes(dep));
  if (added.length === 0) return null;
  if (added.includes(taskId)) return "Zadanie nie może czekać na siebie.";
  const known = new Set(tasks.map((task) => task.id));
  const unknown = added.filter((dep) => !known.has(dep));
  if (unknown.length > 0) return `Nie ma takich zadań: ${unknown.join(", ")}.`;
  const cycle = dependencyCycle(tasks, taskId, dependsOn);
  if (cycle) {
    return (
      "To zamknęłoby pętlę - każde zadanie w niej czekałoby na pozostałe: " +
      cycle.join(" → ") +
      "."
    );
  }
  return null;
}

const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** The dependency list a patch asks for, from the task's current one. */
export function patchedDependsOn(
  current: readonly string[],
  patch: Pick<TaskPatch, "dependsOn" | "addDependsOn" | "removeDependsOn">,
): string[] {
  const base = patch.dependsOn ?? current;
  const removed = new Set(patch.removeDependsOn ?? []);
  return unique([...base, ...(patch.addDependsOn ?? [])]).filter(
    (dep) => !removed.has(dep),
  );
}

/** A new dependency list as what to add and what to take away, rather than
 * the list itself. The page may be showing a task as it was minutes ago; sent
 * whole, its list would quietly undo a dependency an agent has added since. */
export function dependencyChange(
  before: readonly string[],
  after: readonly string[],
): Pick<TaskPatch, "addDependsOn" | "removeDependsOn"> {
  const add = after.filter((dep) => !before.includes(dep));
  const remove = before.filter((dep) => !after.includes(dep));
  return {
    ...(add.length > 0 && { addDependsOn: add }),
    ...(remove.length > 0 && { removeDependsOn: remove }),
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export type TaskEdit = Pick<
  Task,
  | "title"
  | "body"
  | "kind"
  | "who"
  | "dependsOn"
  | "tags"
  | "links"
  | "branches"
>;

/** What an edit of `task` changed, and nothing else - so that saving a form
 * opened on an older copy leaves alone the fields somebody else changed
 * meanwhile. Null when nothing changed. */
export function taskEditPatch(task: Task, edited: TaskEdit): TaskPatch | null {
  const patch: TaskPatch = dependencyChange(task.dependsOn, edited.dependsOn);
  for (const key of ["title", "body", "kind", "who"] as const) {
    if (edited[key] !== task[key]) {
      (patch as Record<string, unknown>)[key] = edited[key];
    }
  }
  for (const key of ["tags", "links", "branches"] as const) {
    if (!sameList(edited[key], task[key])) patch[key] = [...edited[key]];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  open: "otwarte",
  doing: "w toku",
  parked: "odłożone",
  done: "zrobione",
  dropped: "porzucone",
};

/** The task a patch makes, and the lines it adds to the history. Pure: the
 * callers read the task, apply this and write back what changed. */
export function applyTaskPatch(
  task: Task,
  patch: z.output<typeof taskPatchSchema>,
  by: TaskActor,
  now: string,
): { task: Task; logged: TaskLogEntry[] } {
  const next: Task = { ...task, updatedAt: now };
  const logged: TaskLogEntry[] = [];
  const log = (text: string) => logged.push({ at: now, by, text });

  for (const key of ["title", "body", "kind", "who"] as const) {
    if (patch[key] !== undefined)
      (next as Record<string, unknown>)[key] = patch[key];
  }
  for (const key of ["tags", "links", "branches"] as const) {
    if (patch[key] !== undefined) next[key] = unique(patch[key]);
  }
  if (patch.title !== undefined && patch.title !== task.title) {
    log(`Tytuł: „${task.title}” → „${patch.title}”.`);
  }
  if (patch.rank !== undefined) {
    if (patch.rank === null) delete next.rank;
    else next.rank = patch.rank;
  }
  if (patch.status !== undefined && patch.status !== task.status) {
    next.status = patch.status;
    log(
      `Status: ${STATUS_WORDS[task.status]} → ${STATUS_WORDS[patch.status]}.`,
    );
    if (isClosed(next)) next.closedAt = now;
    else delete next.closedAt;
  }
  const deps = patchedDependsOn(task.dependsOn, patch);
  const added = deps.filter((dep) => !task.dependsOn.includes(dep));
  const removed = task.dependsOn.filter((dep) => !deps.includes(dep));
  if (added.length > 0 || removed.length > 0) {
    next.dependsOn = deps;
    if (added.length > 0) log(`Czeka też na: ${added.join(", ")}.`);
    if (removed.length > 0) log(`Już nie czeka na: ${removed.join(", ")}.`);
  }
  if (patch.note !== undefined) log(patch.note);
  next.log = [...task.log, ...logged].slice(-LOG_KEEP);
  return { task: next, logged };
}

/** A new task from a validated request. */
export function newTask(
  input: z.output<typeof taskCreateSchema>,
  taskId: string,
  by: TaskActor,
  now: string,
): Task {
  const task: Task = {
    id: taskId,
    title: input.title,
    body: input.body,
    kind: input.kind,
    who: input.who,
    status: input.status,
    dependsOn: unique(input.dependsOn),
    tags: unique(input.tags),
    links: unique(input.links),
    branches: unique(input.branches),
    createdAt: now,
    updatedAt: now,
    createdBy: by,
    log: [],
  };
  if (input.rank !== undefined) task.rank = input.rank;
  if (input.source !== undefined) task.source = input.source;
  if (isClosed(task)) task.closedAt = now;
  return task;
}

/** Words too common in task titles to say two of them are about one thing. */
const COMMON_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "into",
  "onto",
  "after",
  "before",
  "that",
  "this",
  "run",
  "add",
  "make",
  "fix",
  "prod",
  "main",
  "merge",
  "deploy",
  "decide",
  "whether",
  "not",
  "all",
  "its",
  "their",
  "they",
  "when",
  "only",
]);

const titleWords = (text: string) =>
  new Set(foldWords(text).filter((w) => w.length > 2 && !COMMON_WORDS.has(w)));

/** Open tasks that look like the one about to be added: most of the telling
 * words of the titles in common, or a branch in common. An agent that finds
 * one should add to it rather than file the same thing twice. */
export function similarTasks(
  tasks: readonly Task[],
  candidate: Pick<Task, "title"> & Partial<Pick<Task, "branches">>,
  limit = 5,
): Task[] {
  const words = titleWords(candidate.title);
  const branchSet = new Set(candidate.branches ?? []);
  const scored = tasks
    .filter((task) => !isClosed(task))
    .map((task) => {
      const other = titleWords(task.title);
      const shared = [...words].filter((w) => other.has(w)).length;
      const union = new Set([...words, ...other]).size || 1;
      const branchHit = task.branches.some((b) => branchSet.has(b));
      return { task, score: shared / union + (branchHit ? 0.5 : 0) };
    })
    .filter(({ score }) => score >= 0.5);
  scored.sort(
    (a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id),
  );
  return scored.slice(0, limit).map(({ task }) => task);
}

/** Hand-set rank first, then the older task - so a list reads the same way
 * on every load. */
export function compareTasks(a: Task, b: Task): number {
  const rank = (a.rank ?? Infinity) - (b.rank ?? Infinity);
  if (rank !== 0 && !Number.isNaN(rank)) return rank;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export type TaskSection =
  "mine" | "agents" | "blocked" | "ideas" | "parked" | "closed";

/** Which list a task is shown in on /admin/zadania. Ideas get their own list
 * whatever they wait for: nobody committed to them, so they should not crowd
 * the lists of what is to be done. */
export function taskSection(task: Task, state: TaskState): TaskSection {
  if (state.readiness === "closed") return "closed";
  if (state.readiness === "parked") return "parked";
  if (task.kind === "idea") return "ideas";
  if (state.readiness === "blocked") return "blocked";
  return task.who === "owner" ? "mine" : "agents";
}

/** Where a task is on the page, for a link to point at. */
export const taskAnchor = (taskId: string) => `t-${taskId}`;
export const taskUrl = (taskId: string, origin = "https://koryta.pl") =>
  `${origin}/admin/zadania#${taskAnchor(taskId)}`;
