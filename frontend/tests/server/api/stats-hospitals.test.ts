import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../server/api/stats/hospitals.get";

type QueryCall = {
  collection: string;
  wheres: unknown[][];
  selects: string[];
};

const {
  queries,
  mockGetAll,
  nodeDocs,
  edgeDocs,
  personDocs,
  statsDocs,
  mockWantsLatest,
} = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.defineEventHandler = (fn: unknown) => fn;

  return {
    queries: [] as QueryCall[],
    mockGetAll: vi.fn(),
    nodeDocs: [] as { id: string; data: () => unknown }[],
    edgeDocs: [] as { id: string; data: () => unknown }[],
    personDocs: [] as Record<string, unknown>[],
    /** `stats` documents, where the answer is stored for six hours. */
    statsDocs: new Map<string, Record<string, unknown>>(),
    mockWantsLatest: vi.fn(async () => false),
  };
});

vi.mock("firebase-admin/firestore", () => {
  const statsDoc = (id: string) => ({
    id,
    get: async () => ({
      exists: statsDocs.has(id),
      data: () => statsDocs.get(id),
    }),
  });
  const batch = () => {
    const writes: [string, Record<string, unknown>][] = [];
    return {
      set: (ref: { id: string }, data: Record<string, unknown>) =>
        writes.push([ref.id, data]),
      commit: async () => {
        for (const [id, data] of writes) statsDocs.set(id, data);
      },
    };
  };
  const collection = (name: string) => {
    const call: QueryCall = { collection: name, wheres: [], selects: [] };
    queries.push(call);
    const query: Record<string, unknown> = {
      doc: (id: string) => (name === "stats" ? statsDoc(id) : { id }),
      where: (...args: unknown[]) => {
        call.wheres.push(args);
        return query;
      },
      select: (...fields: string[]) => {
        call.selects.push(...fields);
        return query;
      },
      // The recorded `where`s are applied rather than ignored. Both the
      // employment lookup and the seat lookup read `edges`, so a mock that
      // answered every edges query with every edge handed the seat lookup an
      // employment edge - and the handler then went off to read the region
      // behind a person, a document no fixture here has anything to say about.
      get: async () => ({
        docs: (name === "nodes" ? nodeDocs : edgeDocs).filter((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return call.wheres.every(([field, op, value]) => {
            const held = data[field as string];
            if (op === "==") return held === value;
            if (op === "in") return (value as unknown[]).includes(held);
            throw new Error(`the mock does not know the "${op}" operator`);
          });
        }),
      }),
    };
    return query;
  };
  return {
    getFirestore: () => ({ collection, getAll: mockGetAll, batch }),
  };
});

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The handler is wrapped in nitro's cache; here it runs straight through.
// Recorded rather than merely stubbed: which wrapper this endpoint uses is the
// difference between an editor seeing what they just published and being served
// an edge-cached answer from up to six hours earlier, so the choice is asserted
// below rather than left to the import.
// A plain array rather than a spy, and `vi.hoisted` rather than a `const`: the
// wrapping happens once, when the module is imported, which is before any
// `beforeEach` - so a spy would have its one recorded call wiped by
// `clearAllMocks` long before the assertion, and a `const` would still be in
// its temporal dead zone when `vi.mock`'s factory runs.
const { wrappedWith } = vi.hoisted(() => ({ wrappedWith: [] as string[] }));
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("authCachedEventHandler");
    return fn;
  },
  editorFreshCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("editorFreshCachedEventHandler");
    return fn;
  },
  wantsLatest: mockWantsLatest,
}));

const call = () =>
  (handler as unknown as (event: unknown) => Promise<never>)({});

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  nodeDocs.length = 0;
  edgeDocs.length = 0;
  personDocs.length = 0;
  statsDocs.clear();
  mockWantsLatest.mockResolvedValue(false);
  // A `DocumentSnapshot`, not a bag with the fields on it: the handler reads
  // the region documents through `snap.get(field)`, which is how a `fieldMask`
  // read is meant to be unpacked, and a mock without it threw rather than
  // answering `undefined` for a document that carries no `teryt`.
  mockGetAll.mockImplementation(async () =>
    personDocs.map((data) => ({
      id: data.id as string,
      exists: true,
      data: () => data,
      get: (field: string) => data[field],
    })),
  );
});

describe("/api/stats/hospitals", () => {
  it("lets an editor read through the cache", async () => {
    // The plain cached wrapper sends `s-maxage=21600`, so Cloud CDN holds a
    // copy that no server-side cache clear can reach - an admin who publishes a
    // board member and reloads the page is shown the answer from before they
    // did it. `editorFresh` answers a `latest` request `no-store` instead,
    // which is the only instruction the CDN takes.
    expect(wrappedWith).toEqual(["editorFreshCachedEventHandler"]);
  });

  it("reads only what it needs, with queries the declared indexes serve", async () => {
    nodeDocs.push(
      {
        id: "h1",
        data: () => ({
          type: "place",
          name: "Szpital Powiatowy sp. z o.o.",
          categories: ["szpitale"],
          isPublic: true,
          published: true,
          supervisoryOrgan: "rada_nadzorcza",
        }),
      },
      {
        id: "w1",
        data: () => ({
          type: "place",
          name: "Wodociągi",
          categories: ["wodociagi"],
          isPublic: true,
          published: true,
        }),
      },
    );
    edgeDocs.push({
      id: "e1",
      data: () => ({
        type: "employed",
        source: "p1",
        target: "h1",
        name: "Rada Nadzorcza",
        published: true,
      }),
    });
    personDocs.push({
      id: "p1",
      name: "Jan Kowalski",
      parties: ["PiS"],
      published: true,
    });

    const stats = await call();

    const [places, edges] = queries;
    // One equality on `type`, which Firestore serves from a single field index.
    // The hospital filter itself cannot be a query: `categories` is stored as a
    // numbered-key object and `array-contains` does not match those.
    expect(places?.collection).toBe("nodes");
    expect(places?.wheres).toEqual([["type", "==", "place"]]);
    expect(places?.selects).toContain("supervisoryOrgan");
    expect(places?.selects).not.toContain("content");

    // `target` + `type`, which is the composite index already in
    // firestore.indexes.json. Only the hospitals are asked for - reading the
    // whole edges collection is one of the known cost sinks.
    expect(edges?.collection).toBe("edges");
    expect(edges?.wheres).toEqual([
      ["target", "in", ["h1"]],
      ["type", "==", "employed"],
    ]);

    // A person node carries a whole biography and this needs the party.
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    const args = mockGetAll.mock.calls[0]!;
    expect(args.at(-1)).toEqual({
      fieldMask: ["name", "parties", "published", "deleted"],
    });
    expect(args.slice(0, -1)).toEqual([{ id: "p1" }]);

    expect(stats).toMatchObject({
      hospitals: 1,
      paid: {
        hospitals: 1,
        seats: 1,
        byParty: [{ party: "PiS", seats: 1, people: 1, hospitals: 1 }],
      },
    });
  });

  it("asks for no edges at all when nothing qualifies", async () => {
    nodeDocs.push({
      id: "h1",
      // Published and tagged, but nothing says the public sector owns it.
      data: () => ({
        type: "place",
        name: "Prywatna klinika",
        categories: ["szpitale"],
        published: true,
      }),
    });

    const stats = await call();

    expect(queries.map((q) => q.collection)).toEqual(["nodes"]);
    expect(mockGetAll).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ hospitals: 0, paid: { seats: 0 } });
  });

  describe("stored once per backend and six-hour window", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    beforeEach(() => {
      vi.stubEnv("K_SERVICE", "prod");
      vi.stubEnv("K_REVISION", "prod-build-001");
      vi.useFakeTimers();
      // 12:30 in Warsaw.
      vi.setSystemTime(new Date("2026-11-23T11:30:00Z"));
      nodeDocs.push({
        id: "h1",
        data: () => ({
          type: "place",
          name: "Szpital Powiatowy sp. z o.o.",
          categories: ["szpitale"],
          isPublic: true,
          published: true,
          supervisoryOrgan: "rada_nadzorcza",
        }),
      });
    });

    /** Reads of the place nodes, which is what a count costs. */
    const placeScans = () =>
      queries.filter((q) => q.collection === "nodes").length;

    it("counts once, and every later instance reads the stored answer", async () => {
      const first = await call();
      expect(placeScans()).toBe(1);
      expect(statsDocs.get("hospitalStats_prod")).toMatchObject({
        key: "prod-build-001|2026-11-23T12",
      });

      expect(await call()).toEqual(first);
      expect(placeScans()).toBe(1);
    });

    it("counts afresh for an editor asking for the latest", async () => {
      await call();
      // Whatever is stored, an editor gets what the database says now.
      const stored = statsDocs.get("hospitalStats_prod")!;
      statsDocs.set("hospitalStats_prod", {
        ...stored,
        json: JSON.stringify({ hospitals: 99 }),
      });
      mockWantsLatest.mockResolvedValue(true);

      const fresh = await call();

      expect(placeScans()).toBe(2);
      expect(fresh).toMatchObject({ hospitals: 1 });
      expect(statsDocs.get("hospitalStats_prod")!.json).toBe(
        JSON.stringify({ hospitals: 99 }),
      );
    });
  });
});
