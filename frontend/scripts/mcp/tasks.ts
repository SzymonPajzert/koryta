/** The owner's task list from /admin/zadania, for agents: what is left to do,
 * and a way to add to it what a session leaves behind - "deploy the indexes
 * once this merges" - instead of burying it in a memory note nobody reads
 * from the laptop.
 *
 * Answers go by the rules in `shared/tasks.ts`, the ones the page uses, so an
 * agent and the owner see the same "ready" and the same refusals.
 */
import { basename } from "node:path";
import { z } from "zod";
import {
  applyTaskPatch,
  compareTasks,
  dependencyProblem,
  isClosed,
  newTask,
  patchedDependsOn,
  similarTasks,
  taskCreateSchema,
  taskPatchSchema,
  taskSection,
  taskSlug,
  taskStates,
  taskUrl,
  uniqueTaskId,
  type Task,
  type TaskActor,
  type TaskSection,
  type TaskState,
} from "../../shared/tasks";
import type { TaskStore } from "./ops-store";

/** Who the history says made a change: an agent, and which session's
 * workspace it ran in - the workspace directory is named after the session,
 * which is what finds the transcript later. */
export function agentActor(env: NodeJS.ProcessEnv = process.env): TaskActor {
  const dir = env.CLAUDE_PROJECT_DIR || process.cwd();
  const name = basename(dir).replace(/[^A-Za-z0-9_.-]/g, "");
  return name ? `agent:${name}` : "agent";
}

/** A task id, from the id or from a link to the task on /admin/zadania. */
export const taskIdFrom = (ref: string): string =>
  ref.trim().replace(/^.*#t-/, "");

const SECTION_TITLES: Record<TaskSection, string> = {
  mine: "Ready - for the owner",
  agents: "Ready - for an agent",
  blocked: "Blocked - waiting on another task",
  ideas: "Ideas - nobody committed to them",
  parked: "Parked - put aside on purpose",
  closed: "Closed - done or dropped",
};

export type ListView =
  | "open"
  | "ready"
  | "mine"
  | "agents"
  | "blocked"
  | "ideas"
  | "parked"
  | "closed"
  | "all";

const VIEW_SECTIONS: Record<ListView, readonly TaskSection[]> = {
  open: ["mine", "agents", "blocked", "ideas", "parked"],
  ready: ["mine", "agents"],
  mine: ["mine"],
  agents: ["agents"],
  blocked: ["blocked"],
  ideas: ["ideas"],
  parked: ["parked"],
  closed: ["closed"],
  all: ["mine", "agents", "blocked", "ideas", "parked", "closed"],
};

export type ListArgs = {
  view?: ListView;
  /** Only tasks with this tag. */
  tag?: string;
  /** Only tasks whose id, title, body or branches mention this. */
  search?: string;
};

function line(task: Task, state: TaskState): string {
  const tags = task.tags.length > 0 ? ` [${task.tags.join(", ")}]` : "";
  const waits =
    state.blockers.length > 0
      ? ` - waits on: ${state.blockers.map((b) => b.id).join(", ")}`
      : "";
  const blocks =
    state.dependents.length > 0 && state.readiness !== "closed"
      ? ` - then: ${state.dependents.map((d) => d.id).join(", ")}`
      : "";
  const status = task.status === "doing" ? " (in progress)" : "";
  return `- ${task.id} · ${task.kind}/${task.who}${status} · ${task.title}${tags}${waits}${blocks}`;
}

const matches = (task: Task, args: ListArgs) => {
  if (args.tag && !task.tags.includes(args.tag)) return false;
  if (!args.search) return true;
  const needle = args.search.toLowerCase();
  return [task.id, task.title, task.body, ...task.branches].some((text) =>
    text.toLowerCase().includes(needle),
  );
};

/** The lists of /admin/zadania, one line per task. */
export async function tasksList(
  store: TaskStore,
  args: ListArgs = {},
): Promise<string> {
  const tasks = await store.list();
  const states = taskStates(tasks);
  const view = args.view ?? "open";
  const bySection = new Map<TaskSection, Task[]>();
  for (const task of [...tasks].sort(compareTasks)) {
    const section = taskSection(task, states.get(task.id)!);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(task);
  }
  const count = (section: TaskSection) => bySection.get(section)?.length ?? 0;
  const filters = [
    args.tag && `tag ${args.tag}`,
    args.search && `"${args.search}"`,
  ].filter(Boolean);

  const lists = VIEW_SECTIONS[view].flatMap((section) => {
    const shown = (bySection.get(section) ?? []).filter((task) =>
      matches(task, args),
    );
    if (shown.length === 0) return [];
    return [
      "",
      `## ${SECTION_TITLES[section]}: ${shown.length}`,
      ...shown.map((task) => line(task, states.get(task.id)!)),
    ];
  });

  return [
    `The owner's tasks, read from ${store.source} at ${new Date().toISOString()}.`,
    `Open: ready for the owner ${count("mine")}, ready for an agent ${count("agents")},` +
      ` blocked ${count("blocked")}, ideas ${count("ideas")}, parked ${count("parked")}.` +
      ` Closed: ${count("closed")}.`,
    `Link a task as ${taskUrl("<id>")}. task_get has the whole of one.` +
      (filters.length > 0 ? ` Showing only ${filters.join(", ")}.` : ""),
    ...(lists.length > 0 ? lists : ["", "Nothing on these lists."]),
  ].join("\n");
}

function describe(task: Task, states: Map<string, TaskState>) {
  const state = states.get(task.id)!;
  const brief = (t: Task) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    readiness: states.get(t.id)!.readiness,
  });
  return {
    ...task,
    link: taskUrl(task.id),
    readiness: state.readiness,
    waitsOn: state.blockers.map(brief),
    dependsOnMissing: state.missing.length > 0 ? state.missing : undefined,
    thenUnblocks: state.dependents.map(brief),
  };
}

/** Whole tasks, with what they wait on and what waits on them. */
export async function taskGet(
  store: TaskStore,
  refs: readonly string[],
): Promise<string> {
  const tasks = await store.list();
  const states = taskStates(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ids = [...new Set(refs.map(taskIdFrom))];
  const notFound = ids.filter((id) => !byId.has(id));
  return JSON.stringify(
    {
      source: store.source,
      readAt: new Date().toISOString(),
      tasks: ids.flatMap((id) => {
        const task = byId.get(id);
        return task ? [describe(task, states)] : [];
      }),
      notFound: notFound.length > 0 ? notFound : undefined,
    },
    null,
    2,
  );
}

export const taskAddArgs = taskCreateSchema.extend({
  /** Add even when an open task looks like the same thing. */
  force: z.boolean().default(false),
});

/** Adds a task - unless an open one already looks like it, in which case the
 * agent is shown those and has to say `force` to add it anyway. */
export async function taskAdd(
  store: TaskStore,
  input: z.input<typeof taskAddArgs>,
  by: TaskActor,
  now = () => new Date().toISOString(),
): Promise<string> {
  const { force, ...args } = taskAddArgs.parse(input);

  // In one transaction with the read, so two agents adding the same title at
  // once do not both take one id: the second is aborted, reads the list with
  // the first one's task on it and takes the next number.
  return store.transaction((tasks, writes) => {
    if (!force) {
      const similar = similarTasks(tasks, args);
      if (similar.length > 0) {
        const states = taskStates(tasks);
        return [
          "Not added: these open tasks look like the same thing.",
          ...similar.map((task) => line(task, states.get(task.id)!)),
          "Add what you know to one of them with task_update (a `note`, " +
            "`addDependsOn`, links), or call task_add again with `force: true` " +
            "if it really is something else.",
        ].join("\n");
      }
    }

    const taken = new Set(tasks.map((task) => task.id));
    if (args.id && taken.has(args.id)) {
      throw new Error(`There is already a task ${args.id}.`);
    }
    const id = args.id ?? uniqueTaskId(taskSlug(args.title), taken);
    // A new task has nothing waiting on it yet, so it cannot close a loop;
    // this only refuses itself and ids that do not exist.
    const problem = dependencyProblem(tasks, id, args.dependsOn);
    if (problem) throw new Error(problem);
    const task = newTask(args, id, by, now());
    if (!task.source && by.startsWith("agent:")) {
      task.source = `session ${by.slice(6)}`;
    }
    writes.create(task);
    const states = taskStates([...tasks, task]);
    return [`Added ${id}: ${taskUrl(id)}`, line(task, states.get(id)!)].join(
      "\n",
    );
  });
}

export const taskUpdateArgs = z.object({
  /** The task's id, or its link. */
  id: z.string().min(1),
  patch: taskPatchSchema,
});

/** Changes a task, and says what that did to it and to what waits on it. */
export async function taskUpdate(
  store: TaskStore,
  input: z.input<typeof taskUpdateArgs>,
  by: TaskActor,
  now = () => new Date().toISOString(),
): Promise<string> {
  const args = taskUpdateArgs.parse(input);
  const id = taskIdFrom(args.id);

  // Judged and written in one transaction: an edit that lands first - to this
  // task, or a dependency elsewhere that would now close a loop - aborts this
  // one, which is then judged again on what that edit left.
  return store.transaction((tasks, writes) => {
    const current = tasks.find((task) => task.id === id);
    if (!current) throw new Error(`There is no task ${id}.`);

    const problem = dependencyProblem(
      tasks,
      id,
      patchedDependsOn(current.dependsOn, args.patch),
      current.dependsOn,
    );
    if (problem) throw new Error(problem);

    const { task, logged } = applyTaskPatch(current, args.patch, by, now());
    writes.replace(task);

    const states = taskStates(tasks.map((t) => (t.id === id ? task : t)));
    const state = states.get(id)!;
    const unblocked =
      isClosed(task) && !isClosed(current)
        ? state.dependents.filter(
            (dependent) => states.get(dependent.id)!.readiness === "ready",
          )
        : [];
    return [
      `Updated ${id}: ${taskUrl(id)}`,
      line(task, state),
      ...logged.map((entry) => `  history: ${entry.text}`),
      ...(unblocked.length > 0
        ? [
            "Now ready, since this closed:",
            ...unblocked.map((t) => line(t, states.get(t.id)!)),
          ]
        : []),
    ].join("\n");
  });
}
