// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHECK_ACTOR,
  checkBranch,
  gitIn,
  overallState,
  runMergeCheck,
} from "../../scripts/ops/merge-check";
import type { TaskStore } from "../../scripts/mcp/ops-store";
import type { Task } from "../../shared/tasks";

let dir: string;
let main: string;

function sh(...args: string[]) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
  }).trim();
}

function commit(title: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(dir, file), text);
  }
  sh("add", "-A");
  sh("commit", "-q", "-m", title);
  return sh("rev-parse", "HEAD");
}

const publish = (name: string) =>
  sh("update-ref", `refs/remotes/origin/${name}`, "HEAD");

/** A repository whose branches reached main in each of the ways they do. */
beforeAll(() => {
  // No signing or hooks from the machine's own git config.
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Test";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
  dir = mkdtempSync(join(tmpdir(), "merge-check-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  const base = commit("Base", { "qa.ts": "old\n", "shared.txt": "1\n" });

  // copied: lands as a rebased copy, one commit with a new patch after a
  // conflict, one cherry-picked as it was; main then edits its file again,
  // so merging the branch would conflict.
  sh("checkout", "-q", "-b", "copied", base);
  const a1 = commit("Add entry a", { "qa.ts": "a\nold\n" });
  commit("Add a2", { "a2.txt": "x\n" });
  publish("copied");

  // partial: one of two commits is on main.
  sh("checkout", "-q", "-b", "partial", base);
  const p1 = commit("Partial one", { "p1.txt": "1\n" });
  commit("Partial two", { "p2.txt": "2\n" });
  publish("partial");

  // squashed: both commits on main as one, under another title.
  sh("checkout", "-q", "-b", "squashed", base);
  commit("Squash one", { "s1.txt": "1\n" });
  commit("Squash two", { "s2.txt": "2\n" });
  publish("squashed");

  // namesake: main has a commit with the same title on other files.
  sh("checkout", "-q", "-b", "namesake", base);
  commit("Small fixes", { "n.txt": "branch\n" });
  publish("namesake");

  // waiting: nothing of it on main.
  sh("checkout", "-q", "-b", "waiting", base);
  commit("Not merged", { "w.txt": "w\n" });
  publish("waiting");

  sh("checkout", "-q", "main");
  commit("Another entry", { "qa.ts": "n\nold\n" });
  commit("Add entry a", { "qa.ts": "a\nn\nold\n" });
  sh("cherry-pick", "copied");
  commit("Change a2 later", { "a2.txt": "y\n" });
  sh("cherry-pick", p1);
  commit("Squashed branch", { "s1.txt": "1\n", "s2.txt": "2\n" });
  commit("Small fixes", { "shared.txt": "2\n" });
  publish("main");
  main = sh("rev-parse", "HEAD");
  expect(a1).not.toBe("");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const check = (name: string) => checkBranch(gitIn(dir), name, main);

describe("checkBranch", () => {
  it("finds a rebased copy by patch or by title and files", () => {
    expect(check("copied")).toEqual({
      name: "copied",
      state: "merged",
      commits: 2,
      landed: 2,
    });
  });

  it("counts what landed of a branch only partly on main", () => {
    expect(check("partial")).toMatchObject({
      state: "partial",
      commits: 2,
      landed: 1,
    });
  });

  it("finds a squash: merging the branch would change nothing", () => {
    expect(check("squashed")).toMatchObject({
      state: "merged",
      commits: 2,
      landed: 2,
    });
  });

  it("does not take a commit of the same title on other files", () => {
    expect(check("namesake")).toMatchObject({ state: "open", landed: 0 });
  });

  it("says a branch is open, or gone from GitHub", () => {
    expect(check("waiting")).toMatchObject({
      state: "open",
      commits: 1,
      landed: 0,
    });
    expect(check("deleted")).toEqual({
      name: "deleted",
      state: "gone",
      commits: 0,
      landed: 0,
    });
  });

  it("says a branch already in main's history is merged", () => {
    sh("update-ref", "refs/remotes/origin/ancestor", `${main}~1`);
    expect(check("ancestor")).toMatchObject({ state: "merged", commits: 0 });
  });
});

describe("overallState", () => {
  const b = (state: "merged" | "partial" | "open" | "gone", landed = 0) => ({
    name: state,
    state,
    commits: 2,
    landed,
  });

  it("is merged only when every branch is", () => {
    expect(overallState([b("merged"), b("merged")])).toBe("merged");
    expect(overallState([b("merged"), b("gone")])).toBe("partial");
    expect(overallState([b("merged"), b("open")])).toBe("partial");
    expect(overallState([b("gone"), b("gone")])).toBe("gone");
    expect(overallState([b("open"), b("gone")])).toBe("open");
  });
});

const READ = "2026-11-19T09:00:00.000Z";
const NOW = "2026-11-20T09:00:00.000Z";

function stored(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    body: "",
    kind: "merge",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [id],
    createdAt: READ,
    updatedAt: READ,
    createdBy: "owner",
    log: [],
    ...extra,
  };
}

function memoryStore(initial: Task[]) {
  const docs = new Map(initial.map((task) => [task.id, task]));
  const store: TaskStore = {
    source: "memory",
    list: async () => [...docs.values()],
    create: async () => false,
    async transaction(work) {
      const queued: Task[] = [];
      const result = await work([...docs.values()], {
        create: (task) => queued.push(task),
        replace: (task) => queued.push(task),
      });
      for (const task of queued) docs.set(task.id, task);
      return result;
    },
  };
  return { store, docs };
}

describe("runMergeCheck", () => {
  const tasks = () => [
    stored("copied"),
    stored("partial"),
    stored("both", { branches: ["squashed", "waiting"] }),
    stored("squashed", { status: "doing" }),
    stored("closed-earlier", { branches: ["waiting"], status: "dropped" }),
    stored("not-a-merge", { kind: "action", branches: ["copied"] }),
  ];

  it("closes the merges whose every branch is on main, and only those", async () => {
    const { store, docs } = memoryStore(tasks());
    const outcomes = await runMergeCheck(store, check, main, NOW);
    expect(outcomes.map((o) => [o.id, o.check.state, o.closes])).toEqual([
      ["copied", "merged", true],
      ["partial", "partial", false],
      ["both", "partial", false],
      ["squashed", "merged", true],
    ]);

    const copied = docs.get("copied")!;
    expect(copied.status).toBe("done");
    expect(copied.closedAt).toBe(NOW);
    expect(copied.log.at(-1)).toMatchObject({
      by: CHECK_ACTOR,
      text: `Cała gałąź copied jest na main ${main.slice(0, 8)}.`,
    });
    expect(copied.mergeCheck).toMatchObject({ checkedAt: NOW, main });
  });

  it("writes the check on open ones without calling it an edit", async () => {
    const { store, docs } = memoryStore(tasks());
    await runMergeCheck(store, check, main, NOW);
    const both = docs.get("both")!;
    expect(both.status).toBe("open");
    expect(both.updatedAt).toBe(READ);
    expect(both.log).toEqual([]);
    expect(both.mergeCheck?.branches.map((b) => b.state)).toEqual([
      "merged",
      "open",
    ]);
  });

  it("leaves closed tasks and other kinds alone", async () => {
    const { store, docs } = memoryStore(tasks());
    await runMergeCheck(store, check, main, NOW);
    expect(docs.get("closed-earlier")).toEqual(tasks()[4]);
    expect(docs.get("not-a-merge")).toEqual(tasks()[5]);
  });

  it("writes nothing on a dry run", async () => {
    const { store, docs } = memoryStore(tasks());
    const outcomes = await runMergeCheck(store, check, main, NOW, true);
    expect(outcomes.filter((o) => o.closes)).toHaveLength(2);
    expect([...docs.values()]).toEqual(tasks());
  });
});
