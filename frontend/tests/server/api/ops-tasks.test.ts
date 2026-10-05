import { describe, it, expect, vi, beforeEach } from "vitest";
import listHandler from "../../../server/api/ops/tasks/list.get";
import createHandler from "../../../server/api/ops/tasks/create.post";
import updateHandler from "../../../server/api/ops/tasks/update.post";
import { requireOwner } from "../../../server/utils/auth";

const { mockGetFirestore, docs, Timestamp } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
  /** Enough of Firestore's Timestamp for the routes to tell one apart. */
  class Timestamp {
    constructor(readonly millis: number) {}
    static fromDate(date: Date) {
      return new Timestamp(date.getTime());
    }
    toDate() {
      return new Date(this.millis);
    }
  }
  return {
    Timestamp,
    mockGetFirestore: vi.fn(),
    /** The `tasks` collection, by document id. */
    docs: new Map<string, Record<string, unknown>>(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("~~/server/utils/auth", () => ({
  requireOwner: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp,
  getFirestore: mockGetFirestore,
}));

/** The part of Firestore the routes use, over `docs`: reading the whole
 * collection, and a transaction that reads it and creates or sets one
 * document. Writes land when the transaction function returns, as they do. */
function fakeDb() {
  const snapshot = () => ({
    docs: [...docs].map(([id, data]) => ({ id, data: () => data })),
  });
  const collection = {
    get: async () => snapshot(),
    doc: (id: string) => ({ id }),
  };
  return {
    collection: vi.fn(() => collection),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: [string, Record<string, unknown>, boolean][] = [];
      const result = await fn({
        get: async () => snapshot(),
        create: (ref: { id: string }, data: Record<string, unknown>) =>
          writes.push([ref.id, data, true]),
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          writes.push([ref.id, data, false]),
      });
      for (const [id, data, create] of writes) {
        if (create && docs.has(id)) throw new Error("ALREADY_EXISTS");
        docs.set(id, data);
      }
      return result;
    }),
  };
}

const call = (handler: unknown, body?: unknown) =>
  (handler as (event: unknown) => Promise<Record<string, unknown>>)({ body });

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

function stored(id: string, fields: Record<string, unknown> = {}) {
  docs.set(id, {
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: at("2026-09-28T08:00:00Z"),
    updatedAt: at("2026-09-28T08:00:00Z"),
    createdBy: "agent:bridge-cse_01",
    log: [],
    ...fields,
  });
}

describe("/api/ops/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs.clear();
    vi.mocked(requireOwner).mockResolvedValue({ uid: "owner" } as never);
    mockGetFirestore.mockImplementation(() => fakeDb());
  });

  it("refuses anybody but the owner before reading anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(
      Object.assign(new Error("no"), { statusCode: 403 }),
    );
    for (const [handler, body] of [
      [listHandler, undefined],
      [createHandler, { title: "x" }],
      [updateHandler, { id: "x", patch: { status: "done" } }],
    ] as const) {
      await expect(call(handler, body)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(mockGetFirestore).not.toHaveBeenCalled();
  });

  it("lists the tasks from the agent-tasks database, times as ISO strings", async () => {
    stored("merge-x", {
      log: [{ at: at("2026-09-28T09:00:00Z"), by: "owner", text: "Hi." }],
    });
    const { tasks } = await call(listHandler);
    expect(mockGetFirestore).toHaveBeenCalledWith("agent-tasks");
    expect(tasks).toEqual([
      expect.objectContaining({
        id: "merge-x",
        createdAt: "2026-09-28T08:00:00.000Z",
        log: [{ at: "2026-09-28T09:00:00.000Z", by: "owner", text: "Hi." }],
      }),
    ]);
  });

  it("adds a task as the owner, under an id made from its title", async () => {
    stored("merge-x");
    const { task } = await call(createHandler, {
      title: "Deploy the rules",
      dependsOn: ["merge-x"],
    });
    expect(task).toMatchObject({
      id: "deploy-the-rules",
      createdBy: "owner",
      dependsOn: ["merge-x"],
    });
    const doc = docs.get("deploy-the-rules")!;
    expect(doc.createdAt).toBeInstanceOf(Timestamp);
    expect(doc.id).toBeUndefined();
  });

  it("refuses a dependency on a task that does not exist", async () => {
    await expect(
      call(createHandler, { title: "Later", dependsOn: ["nope"] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/nope/),
    });
    expect(docs.size).toBe(0);
  });

  it("closes a task, stamping when", async () => {
    stored("merge-x");
    const { task } = await call(updateHandler, {
      id: "merge-x",
      patch: { status: "done" },
    });
    expect(task).toMatchObject({
      status: "done",
      closedAt: expect.any(String),
    });
    expect(docs.get("merge-x")!.closedAt).toBeInstanceOf(Timestamp);
    expect((docs.get("merge-x")!.log as unknown[]).length).toBe(1);
  });

  it("refuses a dependency that would close a loop, and leaves the task", async () => {
    stored("a");
    stored("b", { dependsOn: ["a"] });
    await expect(
      call(updateHandler, { id: "a", patch: { addDependsOn: ["b"] } }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/a → b → a/),
    });
    expect(docs.get("a")!.dependsOn).toEqual([]);
  });

  it("answers 404 for a task that is not there", async () => {
    await expect(
      call(updateHandler, { id: "nope", patch: { note: "x" } }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
