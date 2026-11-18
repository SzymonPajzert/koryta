import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/authorities.get";
import type { RegionGovernment } from "../../../../shared/model";
import type { GovernmentView } from "../../../../shared/regionAuthorities";

let nodes: Record<string, Record<string, unknown>> = {};
let revisions: Record<string, Record<string, unknown>> = {};

/** A query over `revisions` the way the endpoint and `importedOrReviewed`
 * build theirs: equality filters, one order, a limit. */
function revisionQuery() {
  const filters: [string, unknown][] = [];
  let order: [string, string] | undefined;
  let max = Infinity;
  const query = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    }),
    orderBy: vi.fn((field: string, direction = "asc") => {
      order = [field, direction];
      return query;
    }),
    limit: vi.fn((n: number) => {
      max = n;
      return query;
    }),
    get: vi.fn(async () => {
      const entries = Object.entries(revisions).filter(([, data]) =>
        filters.every(([field, value]) => data[field] === value),
      );
      if (order) {
        const [key, direction] = order;
        entries.sort(
          ([, a], [, b]) =>
            String(a[key]).localeCompare(String(b[key])) *
            (direction === "desc" ? -1 : 1),
        );
      }
      const docs = entries
        .slice(0, max)
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }),
  };
  return query;
}

function snapshot(store: Record<string, Record<string, unknown>>, id: string) {
  return { id, exists: store[id] !== undefined, data: () => store[id] };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      get: vi.fn(async () =>
        snapshot(collection === "revisions" ? revisions : nodes, id),
      ),
    })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      revisionQuery().where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => snapshot(nodes, ref.id)),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

const reader = vi.hoisted(() => ({ signedIn: false }));
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => reader.signedIn,
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // server/utils/fetch.ts caches a function of its own at load time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
});
vi.mock("h3", () => ({
  getRouterParam: (event: { id: string }) => event.id,
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
}));

function call(
  id = "teryt1005011",
  query: Record<string, string> = {},
): Promise<GovernmentView | null> {
  return handler({ id, query } as never) as Promise<GovernmentView | null>;
}

/** Gmina Łowicz's record, with a page linked for each kind of person. */
const record: RegionGovernment = {
  election: "local-2024",
  head: {
    office: "Burmistrz",
    name: "Mariusz Siewiera",
    personId: "hand",
    committee: "KWW ŁOWICKIE.PL",
    member: "Prawo i Sprawiedliwość",
  },
  councils: [
    {
      office: "Rada miasta",
      seats: 21,
      members: [
        {
          name: "Jakub Wolski",
          personId: "pub",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          committeeParties: ["PiS"],
        },
        { name: "Hubert Krajewski", personId: "draft" },
        { name: "Ewa Nieznana", personId: "gone" },
        { name: "Bez Strony" },
      ],
    },
  ],
};

beforeEach(() => {
  reader.signedIn = false;
  revisions = {};
  nodes = {
    teryt1005011: {
      type: "region",
      name: "Gmina Łowicz",
      published: true,
      authorities: record,
    },
    pub: {
      type: "person",
      name: "Jakub Wolski",
      published: true,
      parties: ["PiS"],
    },
    draft: { type: "person", name: "Hubert Krajewski", parties: ["PSL"] },
    hand: { type: "person", name: "Mariusz Siewiera" },
  };
  // An import wrote the draft; a person made `hand`.
  revisions["r-draft"] = {
    node_id: "draft",
    update_time: "2024-05-01",
    update_automatic: true,
  };
  revisions["r-hand"] = {
    node_id: "hand",
    update_time: "2024-05-01",
    update_automatic: false,
  };
});

describe("GET /api/nodes/[id]/authorities", () => {
  it("names everybody to a logged out reader, and links only the pages they may open", async () => {
    const view = (await call())!;
    // A page made by hand nobody checked: the name stands, and no link says
    // there is a page.
    expect(view.head).toEqual({
      name: "Mariusz Siewiera",
      committee: "KWW ŁOWICKIE.PL",
      office: "Burmistrz",
      member: "Prawo i Sprawiedliwość",
    });
    expect(view.councils[0]).toEqual({
      office: "Rada miasta",
      seats: 21,
      members: [
        {
          name: "Jakub Wolski",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          committeeParties: ["PiS"],
          page: { id: "pub", published: true, parties: ["PiS"] },
        },
        // An imported draft: linked, its party held back.
        {
          name: "Hubert Krajewski",
          page: {
            id: "draft",
            published: false,
            parties: [],
            partyHidden: true,
          },
        },
        { name: "Ewa Nieznana" },
        { name: "Bez Strony" },
      ],
    });
    // No `personId` anywhere: the link carries it where it is allowed.
    expect(JSON.stringify(view)).not.toContain("personId");
  });

  it("links every page for a signed in reader, with its parties", async () => {
    reader.signedIn = true;
    const view = (await call())!;
    expect(view.head?.page).toEqual({
      id: "hand",
      published: false,
      parties: [],
    });
    expect(view.councils[0]!.members[1]!.page).toEqual({
      id: "draft",
      published: false,
      parties: ["PSL"],
    });
  });

  it("shows a signed in reader the newest proposal, or the one a link previews", async () => {
    const proposed = (name: string): RegionGovernment => ({
      ...record,
      head: { ...record.head!, name, personId: undefined },
    });
    revisions["p1"] = {
      node_id: "teryt1005011",
      update_time: "2026-11-18T10:00",
      data: { authorities: proposed("Anna Nowa") },
    };
    revisions["p2"] = {
      node_id: "teryt1005011",
      update_time: "2026-11-18T11:00",
      data: { authorities: proposed("Piotr Nowszy") },
    };
    // Logged out: the record as stored, whatever is proposed.
    expect((await call())!.head?.name).toBe("Mariusz Siewiera");
    expect((await call(undefined, { revisionId: "p1" }))!.head?.name).toBe(
      "Mariusz Siewiera",
    );
    reader.signedIn = true;
    expect((await call())!.head?.name).toBe("Piotr Nowszy");
    expect((await call(undefined, { revisionId: "p1" }))!.head?.name).toBe(
      "Anna Nowa",
    );
  });

  it("answers nothing for a region nobody may open, a node that is no region, or no record", async () => {
    expect(await call("pub")).toBeNull();
    nodes.teryt1005011 = { ...nodes.teryt1005011, published: false };
    expect(await call()).toBeNull();
    nodes.teryt1005011 = { type: "region", name: "Gmina", published: true };
    expect(await call()).toBeNull();
  });
});
