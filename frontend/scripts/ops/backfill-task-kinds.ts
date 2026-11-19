import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { connectTasks, type TaskStore } from "../mcp/ops-store";
import {
  applyTaskPatch,
  isClosed,
  taskPatchSchema,
  type Task,
  type TaskActor,
  type TaskOption,
  type TaskPatch,
} from "../../shared/tasks";

/**
 * Gives the open tasks written before the task kinds existed their kind and
 * fields: branch merges become kind `merge`, and open decisions get the
 * question and answers their body lays out.
 *
 * Merges are found by rule here. Decisions come from a file the agent pass
 * wrote after reading each body: `[{id, question?, options?, recommended?}]`.
 * Nothing here ever picks an answer.
 *
 * The dry run writes the plan, with each task's `updatedAt` as it was read;
 * `--commit` writes that plan and skips any task changed since.
 *
 * Usage:
 *   npx tsx scripts/ops/backfill-task-kinds.ts plan.json --decisions answers.json
 *   npx tsx scripts/ops/backfill-task-kinds.ts plan.json --commit
 * Against the emulator when FIRESTORE_EMULATOR_HOST is set, otherwise against
 * production as `ops-writer` (frontend/README.md, "Agent tools").
 */

export type PlannedChange = {
  id: string;
  title: string;
  updatedAt: string;
  patch: TaskPatch;
};

export type DecisionAnswer = {
  id: string;
  question?: string;
  options?: TaskOption[];
  recommended?: string;
};

const OPEN = (task: Task) => !isClosed(task);

/** Merges of duplicate site pages, not of branches. */
const PAGE_MERGE = /\b(pages?|twins|drafts|duplicate)\b/i;
/** „Merge <branch>: ...”, „Review and merge <branch>, ...”. */
const BRANCH_IN_TITLE =
  /^(?:review and )?merge (?:the )?([a-z0-9][a-z0-9._/-]*[a-z0-9])(?: branch)?[:,\s]/i;

const looksLikeMerge = (task: Task) =>
  /^(merge|land)-/.test(task.id) ||
  /^(review and )?(merge|land)\b/i.test(task.title);

/** The branch a merge task names in its title or id, where that branch
 * exists. */
function namedBranch(task: Task, remote: ReadonlySet<string>) {
  const fromTitle = BRANCH_IN_TITLE.exec(task.title)?.[1];
  if (fromTitle && remote.has(fromTitle)) return fromTitle;
  const fromId = task.id.replace(/^(merge|land)-/, "");
  return remote.has(fromId) ? fromId : undefined;
}

export function planMerges(
  tasks: readonly Task[],
  remote: ReadonlySet<string>,
): PlannedChange[] {
  const changes: PlannedChange[] = [];
  for (const task of tasks) {
    if (task.kind !== "action" || !OPEN(task) || !looksLikeMerge(task)) {
      continue;
    }
    const branch =
      task.branches.length > 0 ? undefined : namedBranch(task, remote);
    if (task.branches.length === 0 && !branch && PAGE_MERGE.test(task.title)) {
      continue;
    }
    const patch: TaskPatch = { kind: "merge" };
    if (branch) {
      patch.branches = [branch];
      patch.note = `Rodzaj: Merge, gałąź ${branch} z tytułu.`;
    } else if (task.branches.length === 0) {
      patch.note = "Rodzaj: Merge. Brak gałęzi: dopisz ją w polu Gałęzie.";
    } else {
      patch.note = "Rodzaj: Merge.";
    }
    changes.push({
      id: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
      patch,
    });
  }
  return changes;
}

export function planDecisions(
  tasks: readonly Task[],
  answers: readonly DecisionAnswer[],
): { changes: PlannedChange[]; problems: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const changes: PlannedChange[] = [];
  const problems: string[] = [];
  for (const answer of answers) {
    const task = byId.get(answer.id);
    if (!task || task.kind !== "decision" || !OPEN(task)) {
      problems.push(`${answer.id}: not an open decision, left out.`);
      continue;
    }
    if (task.question || task.options || task.picked) {
      problems.push(`${answer.id}: already has its fields, left as it is.`);
      continue;
    }
    const patch: TaskPatch = {};
    if (answer.question?.trim()) patch.question = answer.question.trim();
    if (answer.options && answer.options.length >= 2) {
      patch.options = answer.options;
      if (
        answer.recommended &&
        answer.options.some((o) => o.key === answer.recommended)
      ) {
        patch.recommended = answer.recommended;
      }
    }
    if (Object.keys(patch).length === 0) continue;
    const parsed = taskPatchSchema.safeParse(patch);
    if (!parsed.success) {
      problems.push(
        `${answer.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      continue;
    }
    changes.push({
      id: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
      patch,
    });
  }
  return { changes, problems };
}

/** Writes the plan in one transaction, leaving out every task changed since
 * it was read for the plan. */
export async function commitPlan(
  store: TaskStore,
  plan: readonly PlannedChange[],
  by: TaskActor,
  now: string,
): Promise<{ written: string[]; skipped: string[] }> {
  return store.transaction((tasks, writes) => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const written: string[] = [];
    const skipped: string[] = [];
    for (const change of plan) {
      const task = byId.get(change.id);
      if (!task || task.updatedAt !== change.updatedAt) {
        skipped.push(change.id);
        continue;
      }
      const patch = taskPatchSchema.parse(change.patch);
      writes.replace(applyTaskPatch(task, patch, by, now).task);
      written.push(change.id);
    }
    return { written, skipped };
  });
}

function remoteBranches(): Set<string> {
  const out = execFileSync(
    "jj",
    [
      "bookmark",
      "list",
      "--all-remotes",
      "-T",
      'if(remote == "origin", name ++ "\\n")',
    ],
    { encoding: "utf8" },
  );
  return new Set(out.split("\n").filter(Boolean));
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  if (!file) {
    console.error(
      "Usage: backfill-task-kinds.ts <plan.json> [--decisions answers.json | --commit]",
    );
    process.exit(2);
  }
  const store = connectTasks();

  if (args.includes("--commit")) {
    const plan = JSON.parse(readFileSync(file, "utf8")) as PlannedChange[];
    const result = await commitPlan(
      store,
      plan,
      "agent:backfill-task-kinds",
      new Date().toISOString(),
    );
    console.log(
      `${store.source}: wrote ${result.written.length} of ${plan.length}.`,
    );
    if (result.skipped.length > 0) {
      console.log(
        `Changed since the dry run, left out: ${result.skipped.join(", ")}`,
      );
    }
    return;
  }

  const tasks = await store.list();
  const merges = planMerges(tasks, remoteBranches());
  const answersFile = flag("--decisions");
  const decisions = answersFile
    ? planDecisions(tasks, JSON.parse(readFileSync(answersFile, "utf8")))
    : { changes: [], problems: [] };
  const plan = [...merges, ...decisions.changes];
  writeFileSync(file, JSON.stringify(plan, null, 1));

  const count = (f: (c: PlannedChange) => boolean) => plan.filter(f).length;
  console.log(`${store.source}: ${tasks.length} tasks.`);
  console.log(
    `Merges: ${merges.length} to kind merge, ` +
      `${count((c) => !!c.patch.branches)} with the branch from the title, ` +
      `${count((c) => c.patch.kind === "merge" && !!c.patch.note?.includes("Brak"))} asking for it.`,
  );
  console.log(
    `Decisions: ${decisions.changes.length} written, ` +
      `${count((c) => !!c.patch.question)} with a question, ` +
      `${count((c) => !!c.patch.options)} with options, ` +
      `${count((c) => !!c.patch.recommended)} with a recommendation.`,
  );
  for (const problem of decisions.problems) console.log(problem);
  console.log(`Dry run: plan in ${file}. Run again with --commit to write it.`);
}

if (process.argv[1]?.endsWith("backfill-task-kinds.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
