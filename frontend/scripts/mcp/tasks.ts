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
  goalProgress,
  isClosed,
  newTask,
  patchedDependsOn,
  priorityLevel,
  similarTasks,
  taskAncestors,
  taskCreateSchema,
  taskPatchSchema,
  taskSection,
  taskSlug,
  taskStates,
  taskUrl,
  uniqueTaskId,
  type Task,
  type TaskActor,
  type TaskPriority,
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
  goals: "Goals - where the tasks lead",
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
  | "goals"
  | "mine"
  | "agents"
  | "blocked"
  | "ideas"
  | "parked"
  | "closed"
  | "all";

const VIEW_SECTIONS: Record<ListView, readonly TaskSection[]> = {
  open: ["goals", "mine", "agents", "blocked", "ideas", "parked"],
  ready: ["mine", "agents"],
  goals: ["goals"],
  mine: ["mine"],
  agents: ["agents"],
  blocked: ["blocked"],
  ideas: ["ideas"],
  parked: ["parked"],
  closed: ["closed"],
  all: ["goals", "mine", "agents", "blocked", "ideas", "parked", "closed"],
};

export type ListArgs = {
  view?: ListView;
  /** Only tasks with this tag. */
  tag?: string;
  /** Only this goal and the tasks that lead to it. */
  goal?: string;
  /** Only tasks whose id, title, body or branches mention this. */
  search?: string;
  /** Only tasks at least this pressing, by their own level or one they take
   * from what they hold up: `high` is high and urgent. */
  priority?: TaskPriority;
};

/** ` !urgent`, or ` !high (for goal-x)` when the level is taken from what the
 * task holds up. Nothing on a closed task: what it was is history. */
function priorityMark(state: TaskState): string {
  if (!state.priority || state.readiness === "closed") return "";
  const from = state.priorityFrom.map((t) => t.id);
  if (from.length === 0) return ` !${state.priority}`;
  const more = from.length > 3 ? `, +${from.length - 3}` : "";
  return ` !${state.priority} (for ${from.slice(0, 3).join(", ")}${more})`;
}

function line(task: Task, state: TaskState, tasks: readonly Task[]): string {
  const tags = task.tags.length > 0 ? ` [${task.tags.join(", ")}]` : "";
  let waits =
    state.blockers.length > 0
      ? ` - waits on: ${state.blockers.map((b) => b.id).join(", ")}`
      : "";
  if (task.kind === "goal") {
    const { closed, total } = goalProgress(tasks, task.id);
    waits = ` - ${closed} of ${total} tasks leading to it closed${waits}`;
  }
  const blocks =
    state.dependents.length > 0 && state.readiness !== "closed"
      ? ` - then: ${state.dependents.map((d) => d.id).join(", ")}`
      : "";
  const status = task.status === "doing" ? " (in progress)" : "";
  return `- ${task.id}${priorityMark(state)} · ${task.kind}/${task.who}${status} · ${task.title}${tags}${waits}${blocks}`;
}

const matches = (
  task: Task,
  state: TaskState,
  args: ListArgs,
  group: Set<string> | null,
) => {
  if (group && !group.has(task.id)) return false;
  if (args.tag && !task.tags.includes(args.tag)) return false;
  if (
    args.priority &&
    priorityLevel(state.priority) < priorityLevel(args.priority)
  ) {
    return false;
  }
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
  const order = [...tasks].sort((a, b) => compareTasks(a, b, states));
  for (const task of order) {
    const section = taskSection(task, states.get(task.id)!);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(task);
  }
  const count = (section: TaskSection) => bySection.get(section)?.length ?? 0;
  const goal = args.goal ? taskIdFrom(args.goal) : undefined;
  const group = goal ? new Set([goal, ...taskAncestors(tasks, goal)]) : null;
  const filters = [
    goal && `goal ${goal} and what leads to it`,
    args.tag && `tag ${args.tag}`,
    args.priority &&
      (args.priority === "urgent" ? "urgent tasks" : "high and urgent tasks"),
    args.search && `"${args.search}"`,
  ].filter(Boolean);

  const lists = VIEW_SECTIONS[view].flatMap((section) => {
    const shown = (bySection.get(section) ?? []).filter((task) =>
      matches(task, states.get(task.id)!, args, group),
    );
    if (shown.length === 0) return [];
    return [
      "",
      `## ${SECTION_TITLES[section]}: ${shown.length}`,
      ...shown.map((task) => line(task, states.get(task.id)!, tasks)),
    ];
  });

  return [
    `The owner's tasks, read from ${store.source} at ${new Date().toISOString()}.`,
    `Open: goals ${count("goals")}, ready for the owner ${count("mine")},` +
      ` ready for an agent ${count("agents")}, blocked ${count("blocked")},` +
      ` ideas ${count("ideas")}, parked ${count("parked")}.` +
      ` Closed: ${count("closed")}.`,
    ...pressing(tasks, states),
    `Link a task as ${taskUrl("<id>")}. task_get has the whole of one.` +
      (filters.length > 0 ? ` Showing only ${filters.join(", ")}.` : ""),
    ...(lists.length > 0 ? lists : ["", "Nothing on these lists."]),
  ].join("\n");
}

/** The header's word on what comes first: the urgent tasks by name, and how
 * many are high. A level a task takes from what it holds up counts too, but
 * only the tasks it comes from are named. */
function pressing(
  tasks: readonly Task[],
  states: Map<string, TaskState>,
): string[] {
  const at = (level: TaskPriority) => {
    const all = tasks.filter(
      (t) => !isClosed(t) && states.get(t.id)!.priority === level,
    );
    const own = all.filter((t) => t.priority === level);
    return { own, taken: all.length - own.length };
  };
  const urgent = at("urgent");
  const high = at("high");
  const tasksWord = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);
  const words: string[] = [];
  if (urgent.own.length > 0) {
    words.push(
      `Urgent: ${urgent.own.map((t) => t.id).join(", ")}` +
        (urgent.taken > 0
          ? `, and ${tasksWord(urgent.taken)} they wait on.`
          : "."),
    );
  }
  if (high.own.length + high.taken > 0) {
    words.push(
      `High: ${high.own.length + high.taken}` +
        (high.taken > 0
          ? `, ${high.taken} of them because a high task or goal waits on them.`
          : "."),
    );
  }
  return words.length > 0 ? [words.join(" ")] : [];
}

function describe(
  task: Task,
  states: Map<string, TaskState>,
  tasks: readonly Task[],
) {
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
    // Higher than its own: the level and the tasks it comes from.
    inheritedPriority:
      state.priorityFrom.length > 0
        ? { priority: state.priority, from: state.priorityFrom.map(brief) }
        : undefined,
    waitsOn: state.blockers.map(brief),
    dependsOnMissing: state.missing.length > 0 ? state.missing : undefined,
    thenUnblocks: state.dependents.map(brief),
    goalProgress:
      task.kind === "goal" ? goalProgress(tasks, task.id) : undefined,
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
        return task ? [describe(task, states, tasks)] : [];
      }),
      notFound: notFound.length > 0 ? notFound : undefined,
    },
    null,
    2,
  );
}

/** Why an agent may not give `task` the priority `wanted`, or null if it may.
 *
 * Agents file most of the tasks, so a level has to be argued for to keep its
 * meaning: raising one takes the evidence, in `evidenceIn`. And a level the
 * owner set is his judgement - an agent may raise it, never lower it. */
export function priorityRefusal(
  task: Pick<Task, "id" | "priority" | "prioritySetBy">,
  wanted: TaskPriority | null,
  evidence: string | undefined,
  evidenceIn: "note" | "body",
): string | null {
  const from = priorityLevel(task.priority);
  const to = priorityLevel(wanted);
  if (to < from && task.prioritySetBy === "owner") {
    return (
      `The owner set ${task.id} to ${task.priority}. An agent may raise a ` +
      "priority, but not lower one the owner set: add a `note` with what " +
      "you found, and leave the level to him."
    );
  }
  if (to > from && !evidence?.trim()) {
    return (
      `Making ${task.id} ${wanted} needs the evidence in \`${evidenceIn}\`: ` +
      "what grows worse while it waits, or the deadline."
    );
  }
  return null;
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
          ...similar.map((task) => line(task, states.get(task.id)!, tasks)),
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
    if (args.priority && by !== "owner") {
      const refusal = priorityRefusal({ id }, args.priority, args.body, "body");
      if (refusal) throw new Error(refusal);
    }
    const task = newTask(args, id, by, now());
    if (!task.source && by.startsWith("agent:")) {
      task.source = `session ${by.slice(6)}`;
    }
    writes.create(task);
    const after = [...tasks, task];
    const states = taskStates(after);
    return [
      `Added ${id}: ${taskUrl(id)}`,
      line(task, states.get(id)!, after),
      ...priorityChanges(id, taskStates(tasks), states, after),
    ].join("\n");
  });
}

/** The tasks whose priority a change to `id` moved, besides `id` itself: what
 * it waits on, or did, which takes the level it passes on or loses it. */
function priorityChanges(
  id: string,
  before: Map<string, TaskState>,
  after: Map<string, TaskState>,
  tasks: readonly Task[],
): string[] {
  const moved = tasks.filter(
    (t) =>
      t.id !== id &&
      !isClosed(t) &&
      before.get(t.id)?.priority !== after.get(t.id)!.priority,
  );
  if (moved.length === 0) return [];
  const shown = moved.slice(0, 20);
  return [
    "This also moved the priority of:",
    ...shown.map((t) => {
      const state = after.get(t.id)!;
      return state.priority
        ? line(t, state, tasks)
        : `${line(t, state, tasks)} (normal again)`;
    }),
    ...(moved.length > shown.length
      ? [`…and ${moved.length - shown.length} more.`]
      : []),
  ];
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
    if (args.patch.priority !== undefined && by !== "owner") {
      const refusal = priorityRefusal(
        current,
        args.patch.priority,
        args.patch.note,
        "note",
      );
      if (refusal) throw new Error(refusal);
    }

    const { task, logged } = applyTaskPatch(current, args.patch, by, now());
    writes.replace(task);

    const after = tasks.map((t) => (t.id === id ? task : t));
    const states = taskStates(after);
    const state = states.get(id)!;
    const unblocked =
      isClosed(task) && !isClosed(current)
        ? state.dependents.filter(
            (dependent) => states.get(dependent.id)!.readiness === "ready",
          )
        : [];
    return [
      `Updated ${id}: ${taskUrl(id)}`,
      line(task, state, after),
      ...logged.map((entry) => `  history: ${entry.text}`),
      ...(unblocked.length > 0
        ? [
            "Now ready, since this closed:",
            ...unblocked.map((t) => line(t, states.get(t.id)!, after)),
          ]
        : []),
      ...priorityChanges(id, taskStates(tasks), states, after),
    ].join("\n");
  });
}
