import { execFileSync } from "node:child_process";
import { connectTasks, type TaskStore } from "../mcp/ops-store";
import {
  applyTaskPatch,
  isClosed,
  type MergeCheck,
  type MergeState,
  type Task,
  type TaskActor,
} from "../../shared/tasks";

/**
 * The check of main for the task list's merges: for every open task of kind
 * `merge`, how much of each branch it names is on main, written as the
 * task's `mergeCheck`. A task whose every branch is there is closed. Nothing
 * is ever reopened. Runs from .github/workflows/merge-check.yml on each push
 * to main.
 *
 * Branches land as rewritten copies (jj rebase, duplicate), so ancestry says
 * nothing. A branch commit counts as landed when main has, since the branch
 * forked from it:
 * - a commit with the same patch (`git cherry`), or
 * - a commit with the same first line that touches the same files: a copy
 *   rebased over a conflict has another patch id but keeps its title.
 * A branch is also whole on main when merging it into main changes nothing,
 * which is what a squash looks like.
 *
 * Usage, from frontend/:
 *   npx tsx scripts/ops/merge-check.ts --repo <git dir> [--dry-run]
 * `--repo` is a git repository with the branches under refs/remotes/origin/
 * (a checkout with fetch-depth 0, or `git clone --mirror` of a colocated jj
 * repository). Against the emulator when FIRESTORE_EMULATOR_HOST is set,
 * otherwise against production as `ops-writer` (frontend/README.md, "Agent
 * tools").
 */

export const CHECK_ACTOR: TaskActor = "agent:merge-check";

export type Git = (args: string[]) => string;

export function gitIn(dir: string): Git {
  return (args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
}

/** The commit a ref names, or null when there is no such ref. */
function resolve(git: Git, ref: string): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

const lines = (text: string) => text.split("\n").filter(Boolean);

/** The files a commit changes, sorted, as one string to compare by. */
const filesOf = (git: Git, commit: string) =>
  lines(
    git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commit]),
  )
    .sort()
    .join("\n");

/** Whether merging `tip` into `main` would leave main's tree as it is. */
function changesNothing(git: Git, main: string, tip: string): boolean {
  let tree: string;
  try {
    tree = lines(git(["merge-tree", "--write-tree", main, tip]))[0] ?? "";
  } catch {
    return false; // conflicts: main differs from the branch where both changed
  }
  return tree === git(["rev-parse", `${main}^{tree}`]).trim();
}

export type BranchCheck = MergeCheck["branches"][number];

export function checkBranch(
  git: Git,
  name: string,
  main: string,
  remote = "origin",
): BranchCheck {
  const tip = resolve(git, `refs/remotes/${remote}/${name}`);
  if (!tip) return { name, state: "gone", commits: 0, landed: 0 };

  const commits = lines(
    git(["rev-list", "--no-merges", "--reverse", `${main}..${tip}`]),
  );
  if (commits.length === 0) {
    return { name, state: "merged", commits: 0, landed: 0 };
  }
  if (changesNothing(git, main, tip)) {
    return {
      name,
      state: "merged",
      commits: commits.length,
      landed: commits.length,
    };
  }

  const samePatch = new Set(
    lines(git(["cherry", main, tip]))
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  );
  // Main's commits since the branch forked, by first line.
  let base: string;
  try {
    base = git(["merge-base", main, tip]).trim();
  } catch {
    base = "";
  }
  const onMain = new Map<string, string[]>();
  const log = git([
    "log",
    "--no-merges",
    "--format=%H %s",
    base ? `${base}..${main}` : main,
  ]);
  for (const line of lines(log)) {
    const at = line.indexOf(" ");
    const subject = line.slice(at + 1).trim();
    if (!subject) continue;
    onMain.set(subject, [...(onMain.get(subject) ?? []), line.slice(0, at)]);
  }
  const subjectOf = (commit: string) =>
    git(["log", "-1", "--format=%s", commit]).trim();
  const landed = commits.filter((commit) => {
    if (samePatch.has(commit)) return true;
    const copies = onMain.get(subjectOf(commit));
    if (!copies) return false;
    const files = filesOf(git, commit);
    return copies.some((copy) => filesOf(git, copy) === files);
  }).length;

  return {
    name,
    state:
      landed === commits.length ? "merged" : landed > 0 ? "partial" : "open",
    commits: commits.length,
    landed,
  };
}

/** A task's state from its branches': merged only when all are. */
export function overallState(branches: readonly BranchCheck[]): MergeState {
  if (branches.every((b) => b.state === "merged")) return "merged";
  if (branches.every((b) => b.state === "gone")) return "gone";
  if (branches.some((b) => b.state === "merged" || b.landed > 0)) {
    return "partial";
  }
  return "open";
}

export type CheckOutcome = {
  id: string;
  title: string;
  check: MergeCheck;
  /** Whether this run closes it. */
  closes: boolean;
};

/** The check of every open merge task, with its branches checked once each. */
export function checkMerges(
  tasks: readonly Task[],
  checkOne: (branch: string) => BranchCheck,
  main: string,
  now: string,
): CheckOutcome[] {
  const cache = new Map<string, BranchCheck>();
  const branch = (name: string) => {
    if (!cache.has(name)) cache.set(name, checkOne(name));
    return cache.get(name)!;
  };
  return tasks
    .filter(
      (task) =>
        task.kind === "merge" && !isClosed(task) && task.branches.length > 0,
    )
    .map((task) => {
      const branches = task.branches.map(branch);
      const check: MergeCheck = {
        state: overallState(branches),
        branches,
        checkedAt: now,
        main,
      };
      return {
        id: task.id,
        title: task.title,
        check,
        closes: check.state === "merged",
      };
    });
}

/** The task with the check written in. A check is not an edit, so
 * `updatedAt` moves only when the task is closed. */
export function withCheck(
  task: Task,
  outcome: CheckOutcome,
  now: string,
): Task {
  const checked: Task = { ...task, mergeCheck: outcome.check };
  if (!outcome.closes) return checked;
  const names = outcome.check.branches.map((b) => b.name).join(", ");
  return applyTaskPatch(
    checked,
    {
      status: "done",
      note: `Cała gałąź ${names} jest na main ${outcome.check.main.slice(0, 8)}.`,
    },
    CHECK_ACTOR,
    now,
  ).task;
}

/** Runs the check over the list as it is when written, in one transaction. */
export async function runMergeCheck(
  store: TaskStore,
  checkOne: (branch: string) => BranchCheck,
  main: string,
  now: string,
  dryRun = false,
): Promise<CheckOutcome[]> {
  if (dryRun) return checkMerges(await store.list(), checkOne, main, now);
  return store.transaction((tasks, writes) => {
    const outcomes = checkMerges(tasks, checkOne, main, now);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const outcome of outcomes) {
      writes.replace(withCheck(byId.get(outcome.id)!, outcome, now));
    }
    return outcomes;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const git = gitIn(flag("--repo") ?? ".");
  const remote = flag("--remote") ?? "origin";
  const dryRun = args.includes("--dry-run");
  const head = resolve(git, `refs/remotes/${remote}/main`);
  if (!head) throw new Error(`No ${remote}/main in the repository.`);

  const store = connectTasks();
  const outcomes = await runMergeCheck(
    store,
    (name) => checkBranch(git, name, head, remote),
    head,
    new Date().toISOString(),
    dryRun,
  );

  const count = (state: MergeState) =>
    outcomes.filter((o) => o.check.state === state).length;
  console.log(
    `${store.source}: ${outcomes.length} open merges against main ${head.slice(0, 12)}: ` +
      `${count("merged")} merged, ${count("partial")} partly, ` +
      `${count("open")} not yet, ${count("gone")} gone.`,
  );
  for (const o of outcomes) {
    const parts = o.check.branches
      .map((b) => `${b.name} ${b.state} ${b.landed}/${b.commits}`)
      .join("; ");
    console.log(`${o.closes ? "CLOSE " : "      "}${o.id}: ${parts}`);
  }
  console.log(
    dryRun
      ? "Dry run: nothing written."
      : `Written; closed ${outcomes.filter((o) => o.closes).length}.`,
  );
}

if (process.argv[1]?.endsWith("merge-check.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
