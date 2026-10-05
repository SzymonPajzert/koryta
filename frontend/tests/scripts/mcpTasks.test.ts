// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  connectTasks,
  decodeTask,
  encodeTask,
  restTaskStore,
  type TaskStore,
} from "../../scripts/mcp/ops-store";
import {
  agentActor,
  taskAdd,
  taskGet,
  taskIdFrom,
  taskUpdate,
  tasksList,
} from "../../scripts/mcp/tasks";
import type { Task } from "../../shared/tasks";

const T0 = "2026-09-28T08:00:00.000Z";
const T1 = "2026-09-28T09:00:00.000Z";
const now = () => T1;

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: T0,
    updatedAt: T0,
    createdBy: "agent",
    log: [],
    ...fields,
  };
}

/** A store in memory that commits a transaction the way Firestore does: only
 * when nothing it read has changed since, and otherwise runs it again on a
 * fresh read. `interfereOnce` lands another writer's change between a
 * transaction's read and its commit. */
function memoryStore(initial: Task[] = []) {
  const docs = new Map<string, { task: Task; version: number }>(
    initial.map((t) => [t.id, { task: t, version: 0 }]),
  );
  let version = 0;
  let interfere: (() => void) | undefined;
  const put = (t: Task) => docs.set(t.id, { task: t, version: ++version });
  const store: TaskStore = {
    source: "memory",
    list: async () => [...docs.values()].map((d) => structuredClone(d.task)),
    async create(t) {
      if (docs.has(t.id)) return false;
      put(t);
      return true;
    },
    async transaction(work) {
      for (let tries = 0; tries < 5; tries++) {
        const read = new Map([...docs].map(([id, d]) => [id, d.version]));
        const queued: Task[] = [];
        const result = await work(await store.list(), {
          create: (t) => queued.push(t),
          replace: (t) => queued.push(t),
        });
        interfere?.();
        interfere = undefined;
        const changed =
          docs.size !== read.size ||
          [...docs].some(([id, d]) => read.get(id) !== d.version);
        if (changed) continue;
        queued.forEach(put);
        return result;
      }
      throw new Error("kept changing");
    },
  };
  return {
    store,
    docs,
    interfereOnce: (fn: () => void) => (interfere = fn),
    bump: (id: string, fields: Partial<Task>) =>
      put({ ...docs.get(id)!.task, ...fields }),
    put,
  };
}

describe("tasksList", () => {
  it("lists tasks on the page's lists, with what they wait on", async () => {
    const { store } = memoryStore([
      task("merge-x", { title: "Merge x", branches: ["x"] }),
      task("deploy-x", { title: "Deploy x", dependsOn: ["merge-x"] }),
      task("fix-y", { who: "agent", kind: "task", tags: ["frontend"] }),
      task("idea", { kind: "idea" }),
      task("gone", { status: "done" }),
    ]);
    const text = await tasksList(store);
    expect(text).toContain(
      "Open: goals 0, ready for the owner 1, ready for an agent 1, blocked 1, ideas 1, parked 0. Closed: 1.",
    );
    expect(text).toContain(
      "- merge-x · action/owner · Merge x - then: deploy-x",
    );
    expect(text).toContain(
      "- deploy-x · action/owner · Deploy x - waits on: merge-x",
    );
    expect(text).not.toContain("gone");

    const filtered = await tasksList(store, { view: "all", tag: "frontend" });
    expect(filtered).toContain("fix-y");
    expect(filtered).not.toContain("merge-x");
    expect(filtered).toContain("Showing only tag frontend.");
  });
});

describe("goals", () => {
  const goalStore = () =>
    memoryStore([
      task("merge-x", { status: "done" }),
      task("deploy-x", { dependsOn: ["merge-x"] }),
      task("elsewhere"),
      task("x-live", {
        title: "X live",
        kind: "goal",
        dependsOn: ["deploy-x"],
      }),
    ]).store;

  it("lists a goal on its own list, with how far it has got", async () => {
    const text = await tasksList(goalStore());
    expect(text).toContain("## Goals - where the tasks lead: 1");
    expect(text).toContain(
      "- x-live · goal/owner · X live - 1 of 2 tasks leading to it closed - waits on: deploy-x",
    );
  });

  it("narrows the list to a goal and what leads to it", async () => {
    const text = await tasksList(goalStore(), {
      view: "all",
      goal: "https://koryta.pl/admin/zadania#t-x-live",
    });
    expect(text).toContain("deploy-x");
    expect(text).toContain("merge-x");
    expect(text).not.toContain("elsewhere");
    expect(text).toContain("Showing only goal x-live and what leads to it.");
  });

  it("gives a goal's progress with the whole goal", async () => {
    const answer = JSON.parse(await taskGet(goalStore(), ["x-live"]));
    expect(answer.tasks[0].goalProgress).toEqual({ closed: 1, total: 2 });
  });
});

describe("taskGet", () => {
  it("answers whole tasks by id or link", async () => {
    const { store } = memoryStore([task("a"), task("b", { dependsOn: ["a"] })]);
    const answer = JSON.parse(
      await taskGet(store, ["https://koryta.pl/admin/zadania#t-b", "nope"]),
    );
    expect(answer.tasks).toHaveLength(1);
    expect(answer.tasks[0]).toMatchObject({
      id: "b",
      readiness: "blocked",
      link: "https://koryta.pl/admin/zadania#t-b",
      waitsOn: [{ id: "a", readiness: "ready" }],
    });
    expect(answer.notFound).toEqual(["nope"]);
  });
});

describe("taskAdd", () => {
  it("adds a task under an id made from its title", async () => {
    const { store, docs } = memoryStore([task("merge-x")]);
    const text = await taskAdd(
      store,
      {
        title: "Deploy the indexes after the merge",
        dependsOn: ["merge-x"],
        kind: "action",
      },
      "agent:bridge-cse_01Abc",
      now,
    );
    expect(text).toContain(
      "Added deploy-the-indexes-after-the-merge: https://koryta.pl/admin/zadania#t-deploy-the-indexes-after-the-merge",
    );
    expect(docs.get("deploy-the-indexes-after-the-merge")!.task).toMatchObject({
      dependsOn: ["merge-x"],
      createdBy: "agent:bridge-cse_01Abc",
      source: "session bridge-cse_01Abc",
      createdAt: T1,
    });
  });

  it("shows a look-alike instead of adding it, unless forced", async () => {
    const { store, docs } = memoryStore([
      task("upload-names", {
        title: "Upload nameless-company names to prod",
      }),
    ]);
    const refused = await taskAdd(
      store,
      { title: "Upload the nameless company names" },
      "agent",
      now,
    );
    expect(refused).toMatch(/^Not added/);
    expect(refused).toContain("upload-names");
    expect(docs.size).toBe(1);

    await taskAdd(
      store,
      { title: "Upload the nameless company names", force: true },
      "agent",
      now,
    );
    expect(docs.size).toBe(2);
  });

  it("refuses a dependency on a task that does not exist", async () => {
    const { store } = memoryStore();
    await expect(
      taskAdd(store, { title: "Later", dependsOn: ["nope"] }, "agent", now),
    ).rejects.toThrow(/nope/);
  });

  it("takes the next number when another agent took the id first", async () => {
    const { store, docs, interfereOnce, put } = memoryStore();
    interfereOnce(() => put(task("same-title", { title: "Same title" })));
    const text = await taskAdd(
      store,
      { title: "Same title", force: true },
      "agent",
      now,
    );
    expect(text).toContain("Added same-title-2");
    expect([...docs.keys()]).toEqual(["same-title", "same-title-2"]);
  });
});

describe("taskUpdate", () => {
  it("closes a task and says what that unblocked", async () => {
    const { store, docs } = memoryStore([
      task("merge-x"),
      task("deploy-x", { dependsOn: ["merge-x"] }),
    ]);
    const text = await taskUpdate(
      store,
      { id: "merge-x", patch: { status: "done", note: "Merged as abc123." } },
      "agent",
      now,
    );
    expect(text).toContain("history: Status: otwarte → zrobione.");
    expect(text).toContain("history: Merged as abc123.");
    expect(text).toContain("Now ready, since this closed:");
    expect(text).toContain("- deploy-x");
    expect(docs.get("merge-x")!.task.closedAt).toBe(T1);
  });

  it("refuses a dependency that would close a loop", async () => {
    const { store } = memoryStore([task("a"), task("b", { dependsOn: ["a"] })]);
    await expect(
      taskUpdate(
        store,
        { id: "a", patch: { addDependsOn: ["b"] } },
        "agent",
        now,
      ),
    ).rejects.toThrow(/a → b → a/);
  });

  it("redoes the change on top of an edit that landed first", async () => {
    const { store, docs, interfereOnce, bump } = memoryStore([task("a")]);
    interfereOnce(() => bump("a", { title: "Renamed meanwhile" }));
    await taskUpdate(
      store,
      { id: "#t-a", patch: { note: "Checked." } },
      "agent",
      now,
    );
    const stored = docs.get("a")!.task;
    expect(stored.title).toBe("Renamed meanwhile");
    expect(stored.log.map((e) => e.text)).toEqual(["Checked."]);
  });

  it("refuses the second of two arrows that together close a loop", async () => {
    const { store, docs, interfereOnce, bump } = memoryStore([
      task("a"),
      task("b"),
    ]);
    // Another agent makes b wait on a while this one makes a wait on b.
    interfereOnce(() => bump("b", { dependsOn: ["a"] }));
    await expect(
      taskUpdate(
        store,
        { id: "a", patch: { addDependsOn: ["b"] } },
        "agent",
        now,
      ),
    ).rejects.toThrow(/a → b → a/);
    expect(docs.get("a")!.task.dependsOn).toEqual([]);
  });

  it("says so when there is no such task", async () => {
    const { store } = memoryStore();
    await expect(
      taskUpdate(store, { id: "nope", patch: { note: "x" } }, "agent", now),
    ).rejects.toThrow("There is no task nope.");
  });
});

describe("agentActor and taskIdFrom", () => {
  it("names the session's workspace", () => {
    expect(
      agentActor({
        CLAUDE_PROJECT_DIR:
          "/home/szymon/.claude-worktrees/koryta/bridge-cse_01Kj9KCVUdugRYjmuQH94gNG",
      }),
    ).toBe("agent:bridge-cse_01Kj9KCVUdugRYjmuQH94gNG");
    expect(taskIdFrom(" https://koryta.pl/admin/zadania#t-deploy-x ")).toBe(
      "deploy-x",
    );
  });
});

describe("restTaskStore", () => {
  const DOCUMENTS = "projects/koryta-pl/databases/agent-tasks/documents";

  function fakeFetch(
    reply: (url: string) => { status?: number; body: unknown },
  ) {
    const calls: { url: string; body: unknown }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const { status = 200, body } = reply(url);
      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status },
      );
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
  }

  const store = (fetch: typeof globalThis.fetch) =>
    restTaskStore({
      origin: "https://firestore.test",
      token: async () => "t0k3n",
      source: "the test database",
      fetch,
    });

  it("stores times as timestamps and reads them back as the same task", () => {
    const original = task("deploy-x", {
      rank: 1.5,
      closedAt: T1,
      status: "done",
      log: [{ at: T1, by: "owner", text: "Done." }],
    });
    const fields = encodeTask(original);
    expect(fields.createdAt).toEqual({ timestampValue: T0 });
    expect(fields.rank).toEqual({ doubleValue: 1.5 });
    expect(fields.log!.arrayValue!.values![0]!.mapValue!.fields!.at).toEqual({
      timestampValue: T1,
    });
    expect(fields.id).toBeUndefined();

    // Firestore answers to the microsecond.
    const micro = JSON.parse(
      JSON.stringify(fields).replaceAll(".000Z", ".000000Z"),
    );
    expect(
      decodeTask({ name: `${DOCUMENTS}/tasks/deploy-x`, fields: micro }),
    ).toEqual(original);
  });

  /** Answers a transaction's calls: begin, the read, then the commit - or
   * the given answer to the commit. */
  const transactionFetch = (commit: () => { status?: number; body: unknown }) =>
    fakeFetch((url) => {
      if (url.endsWith(":beginTransaction"))
        return { body: { transaction: "tx1" } };
      if (url.endsWith(":runQuery")) {
        return {
          body: [
            {
              document: {
                name: `${DOCUMENTS}/tasks/a`,
                fields: encodeTask(task("a")),
              },
            },
          ],
        };
      }
      if (url.endsWith(":commit")) return commit();
      return { body: {} };
    });

  it("reads and writes the agent-tasks database in one transaction", async () => {
    const { fetch, calls } = transactionFetch(() => ({ body: {} }));
    const seen = await store(fetch).transaction((tasks, writes) => {
      writes.replace({ ...tasks[0]!, title: "New" });
      return tasks.map((t) => t.id);
    });
    expect(seen).toEqual(["a"]);
    expect(calls.map((c) => c.url.split(":").at(-1))).toEqual([
      "beginTransaction",
      "runQuery",
      "commit",
    ]);
    expect(calls[1]!.body).toMatchObject({ transaction: "tx1" });
    expect(calls[2]!.url).toBe(`https://firestore.test/v1/${DOCUMENTS}:commit`);
    expect(calls[2]!.body).toMatchObject({
      transaction: "tx1",
      writes: [
        {
          update: { name: `${DOCUMENTS}/tasks/a` },
          currentDocument: { exists: true },
        },
      ],
    });
  });

  it("runs the work again when the commit loses to another writer", async () => {
    let commits = 0;
    const { fetch } = transactionFetch(() =>
      ++commits === 1
        ? {
            status: 409,
            body: { error: { status: "ABORTED", message: "contention" } },
          }
        : { body: {} },
    );
    let runs = 0;
    await store(fetch).transaction((tasks, writes) => {
      runs++;
      writes.replace(tasks[0]!);
    });
    expect(runs).toBe(2);
  });

  it("rolls back, and says why, when the work refuses", async () => {
    const { fetch, calls } = transactionFetch(() => ({ body: {} }));
    await expect(
      store(fetch).transaction(() => {
        throw new Error("a loop");
      }),
    ).rejects.toThrow("a loop");
    expect(calls.at(-1)!.url).toMatch(/:rollback$/);
    expect(calls.at(-1)!.body).toEqual({ transaction: "tx1" });
  });

  it("reads a taken id as a lost race, and anything else as an error", async () => {
    const lost = fakeFetch(() => ({
      status: 409,
      body: { error: { status: "ALREADY_EXISTS", message: "exists" } },
    }));
    expect(await store(lost.fetch).create(task("a"))).toBe(false);

    const denied = fakeFetch(() => ({
      status: 403,
      body: { error: { message: "Missing or insufficient permissions" } },
    }));
    await expect(store(denied.fetch).create(task("a"))).rejects.toThrow(
      /403: Missing or insufficient permissions\..*ops-writer/,
    );
  });

  it("lists every task", async () => {
    const { fetch } = fakeFetch(() => ({
      body: [
        {
          document: {
            name: `${DOCUMENTS}/tasks/a`,
            fields: encodeTask(task("a")),
            updateTime: "2026-09-28T09:00:00.1Z",
          },
        },
        { readTime: "2026-09-28T09:00:01Z" },
      ],
    }));
    expect(await store(fetch).list()).toEqual([task("a")]);
  });

  it("goes to the emulator when one is named", () => {
    expect(
      connectTasks({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).source,
    ).toBe("the Firestore emulator at 127.0.0.1:8080 (database agent-tasks)");
  });
});
