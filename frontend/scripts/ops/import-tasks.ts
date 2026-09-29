import { readFileSync } from "node:fs";
import { connectTasks, type TaskStore } from "../mcp/ops-store";
import {
  dependencyCycle,
  newTask,
  taskCreateSchema,
  type Task,
  type TaskActor,
} from "../../shared/tasks";

/**
 * Loads a list of tasks into the owner's task list (`shared/tasks.ts`) - the
 * harvest of open items from the agents' notes, say.
 *
 * The file is a JSON array of tasks as `task_add` takes them, each with its
 * `id`, so that `dependsOn` can name tasks from the same file. The whole file
 * is checked before anything is written: every id unique, every dependency
 * naming a task in the file or already on the list, no loops. Then each task
 * that is not on the list yet is written; one that is stays as it is, so a
 * second run adds only what is new.
 *
 * Usage:
 *   npx tsx scripts/ops/import-tasks.ts tasks.json            # dry run
 *   npx tsx scripts/ops/import-tasks.ts tasks.json --commit   # write
 * Against the emulator when FIRESTORE_EMULATOR_HOST is set, otherwise against
 * production as `ops-writer` (frontend/README.md, "Agent tools").
 */

const seedSchema = taskCreateSchema.required({ id: true });

export type ImportPlan = {
  toWrite: Task[];
  existing: string[];
};

/** What an import would write, or why it cannot. */
export function planImport(
  raw: unknown,
  current: readonly Task[],
  by: TaskActor,
  now: string,
): ImportPlan {
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of tasks.");
  const seeds = raw.map((item, index) => {
    const parsed = seedSchema.safeParse(item);
    if (!parsed.success) {
      const id = (item as { id?: unknown } | null)?.id;
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Task #${index + 1} (${JSON.stringify(id)}): ${issues}`);
    }
    return parsed.data;
  });

  const ids = seeds.map((seed) => seed.id);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length > 0) {
    throw new Error(`Ids given twice: ${[...new Set(duplicated)].join(", ")}.`);
  }

  const onList = new Set(current.map((task) => task.id));
  const known = new Set([...onList, ...ids]);
  for (const seed of seeds) {
    const unknown = seed.dependsOn.filter((dep) => !known.has(dep));
    if (unknown.length > 0) {
      throw new Error(
        `${seed.id} depends on unknown tasks: ${unknown.join(", ")}.`,
      );
    }
  }

  // Judged against the list as it would be after the import: what is on it
  // keeps its own dependencies, and the file adds its tasks.
  const after = [
    ...current.filter((task) => !ids.includes(task.id)),
    ...seeds.map((seed) => ({ id: seed.id, dependsOn: seed.dependsOn })),
  ];
  for (const seed of seeds) {
    const cycle = dependencyCycle(after, seed.id, seed.dependsOn);
    if (cycle) throw new Error(`A loop: ${cycle.join(" → ")}.`);
  }

  return {
    toWrite: seeds
      .filter((seed) => !onList.has(seed.id))
      .map((seed) => newTask(seed, seed.id, by, now)),
    existing: seeds.filter((seed) => onList.has(seed.id)).map((s) => s.id),
  };
}

export async function importTasks(
  store: TaskStore,
  raw: unknown,
  options: { commit: boolean; by?: TaskActor; now?: string },
): Promise<string[]> {
  const current = await store.list();
  const plan = planImport(
    raw,
    current,
    options.by ?? "agent",
    options.now ?? new Date().toISOString(),
  );
  const lines = [
    `${store.source}: ${current.length} tasks now; the file has ` +
      `${plan.toWrite.length + plan.existing.length}, of which ` +
      `${plan.existing.length} are already there and stay as they are.`,
  ];
  if (!options.commit) {
    lines.push(
      `Dry run: would write ${plan.toWrite.length}. Run again with --commit.`,
    );
    return lines;
  }
  let written = 0;
  for (const task of plan.toWrite) {
    // A task added between the read and this write is left alone too.
    if (await store.create(task)) written++;
    else lines.push(`${task.id}: appeared meanwhile, left as it is.`);
  }
  lines.push(`Wrote ${written}.`);
  return lines;
}

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("Usage: import-tasks.ts <tasks.json> [--commit]");
    process.exit(2);
  }
  const lines = await importTasks(
    connectTasks(),
    JSON.parse(readFileSync(file, "utf8")),
    { commit: process.argv.includes("--commit"), by: "agent:import" },
  );
  for (const line of lines) console.log(line);
}

if (process.argv[1]?.endsWith("import-tasks.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
