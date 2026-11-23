import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../server/api/stats/database.get";
import type { DatabaseStats } from "../../../server/api/stats/database.get";

const { scans, statsDocs } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  // The handler is wrapped in nitro's cache; here it runs straight through.
  globals.defineCachedEventHandler = (fn: unknown) => fn;
  return {
    /** Collections read whole, which is what the census costs. */
    scans: [] as string[],
    /** `stats` documents, where the census is stored for six hours. */
    statsDocs: new Map<string, Record<string, unknown>>(),
  };
});

const people = [
  { stats: { isApproved: true, votes: { humanVoted: true } } },
  { stats: { isApproved: false } },
];

/** A field off a document, the way `DocumentSnapshot.get` reads a dotted path. */
function field(data: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      data,
    );
}

vi.mock("firebase-admin/firestore", () => {
  const query = (collection: string) => {
    const q = {
      where: () => q,
      select: () => q,
      get: async () => {
        scans.push(collection);
        const rows = collection === "nodes" ? people : [];
        return {
          docs: rows.map((data, i) => ({
            id: `${collection}${i}`,
            data: () => data,
            get: (path: string) => field(data, path),
          })),
        };
      },
      count: () => ({ get: async () => ({ data: () => ({ count: 7 }) }) }),
    };
    return q;
  };
  const statsDoc = (id: string) => ({
    id,
    get: async () => ({
      exists: statsDocs.has(id),
      data: () => statsDocs.get(id),
    }),
  });
  const db = {
    collection: (name: string) =>
      name === "stats" ? { doc: statsDoc } : query(name),
    batch: () => {
      const writes: [string, Record<string, unknown>][] = [];
      return {
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          writes.push([ref.id, data]),
        commit: async () => {
          for (const [id, data] of writes) statsDocs.set(id, data);
        },
      };
    },
  };
  return { getFirestore: () => db };
});

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const call = handler as unknown as () => Promise<DatabaseStats>;

beforeEach(() => {
  scans.length = 0;
  statsDocs.clear();
  vi.useFakeTimers();
  // 12:30 in Warsaw.
  vi.setSystemTime(new Date("2026-11-23T11:30:00Z"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/api/stats/database", () => {
  it("counts on every call off Cloud Run and stores nothing", async () => {
    vi.stubEnv("K_SERVICE", "");
    vi.stubEnv("K_REVISION", "");

    await call();
    const once = scans.length;
    await call();

    expect(once).toBeGreaterThan(0);
    expect(scans).toHaveLength(2 * once);
    expect(statsDocs.size).toBe(0);
  });

  it("counts once a window for each backend and build, then reads the stored census", async () => {
    vi.stubEnv("K_SERVICE", "prod");
    vi.stubEnv("K_REVISION", "prod-build-001");

    const first = await call();
    expect(first.nodes.people).toBe(2);
    expect(statsDocs.get("databaseStats_prod")).toMatchObject({
      key: "prod-build-001|2026-11-23T12",
    });
    const once = scans.length;

    const second = await call();
    expect(scans).toHaveLength(once);
    expect(second).toEqual(first);

    // The next window counts again.
    vi.setSystemTime(new Date("2026-11-23T17:00:00Z"));
    await call();
    expect(scans).toHaveLength(2 * once);
    expect(statsDocs.get("databaseStats_prod")!.key).toBe(
      "prod-build-001|2026-11-23T18",
    );
  });
});
