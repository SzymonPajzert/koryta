import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/stats/computeNodes.post";
import type { NodeRevisions, NodeStats } from "../../../../shared/model";

/** Every collection the handler reads, empty unless a test says otherwise. */
const collections: Record<string, unknown[]> = {
  nodes: [],
  edges: [],
  notes: [],
  votes: [],
  revisions: [],
  extractions: [],
};

/** The field mask each collection was read through. */
const selected = new Map<string, string[]>();

const statsDocSet = vi.fn();
const writerUpdate = vi.fn();
const writerFlush = vi.fn();
const writerClose = vi.fn();

const mockDb = {
  collection: (name: string) => {
    const query = {
      select: (...fields: string[]) => {
        selected.set(name, fields);
        return query;
      },
      stream: () =>
        (async function* () {
          yield* collections[name] ?? [];
        })(),
      doc: (id: string) => ({ id, set: statsDocSet }),
    };
    return query;
  },
  bulkWriter: () => ({
    update: writerUpdate,
    flush: writerFlush,
    close: writerClose,
  }),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

// Faked at the token, not at the gate: `getUser` and the check on its claims
// are the thing under test, so both run for real and only the header and the
// token verification are stood in for.
const mockVerifyIdToken = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

let authHeader: string | undefined;

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRequestHeader = ((_event: unknown, name: string) =>
  name === "Authorization"
    ? authHeader
    : undefined) as typeof globalThis.getRequestHeader;

/** What was written to each node, by its id. */
function writtenBy<T>(
  pick: (data: { stats: NodeStats; revisions: NodeRevisions | null }) => T,
) {
  return Object.fromEntries(
    writerUpdate.mock.calls.map(([ref, data]) => [ref.id, pick(data)]),
  ) as Record<string, T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  writerUpdate.mockResolvedValue({});
  writerFlush.mockResolvedValue(undefined);
  writerClose.mockResolvedValue(undefined);
  authHeader = "Bearer token-1";
  mockVerifyIdToken.mockResolvedValue({ uid: "admin-1", admin: true });
  for (const key of Object.keys(collections)) collections[key] = [];
  selected.clear();
});

describe("POST /api/stats/computeNodes", () => {
  it("refuses a signed-in caller who is neither an admin nor in datascience", async () => {
    // It rewrites `stats` on every node, which is what every listing is
    // filtered and ordered by, so it is not for anybody who can sign in.
    mockVerifyIdToken.mockResolvedValue({ uid: "reader-1" });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("lets the datascience group through, as the night's robot is", async () => {
    // A recount writes no more than its imports already do, and the night
    // runs one after its uploads (decision on 2026-11-18).
    mockVerifyIdToken.mockResolvedValue({
      uid: "pipeline-people-import",
      datascience: true,
    });

    const result = await handler({} as never);

    expect(result).toMatchObject({ status: "success" });
    expect(statsDocSet).toHaveBeenCalled();
  });

  it("refuses a caller carrying no token", async () => {
    authHeader = undefined;

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("refuses a token that does not verify", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("expired"));

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("reads nothing when it refuses", async () => {
    // A full pass reads every node, edge, note, vote and revision. Refusing
    // after paying for that would leave the bill open to anyone.
    mockVerifyIdToken.mockResolvedValue({ uid: "reader-1" });
    const nodes = vi.fn();
    collections.nodes = [{ id: "n-1", data: nodes }];

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(nodes).not.toHaveBeenCalled();
    expect(writerUpdate).not.toHaveBeenCalled();
  });

  it("lets an admin through", async () => {
    const result = await handler({} as never);

    expect(result).toMatchObject({ status: "success" });
    expect(statsDocSet).toHaveBeenCalled();
  });

  /** Whole documents - mostly a node's search chunks and old stats and a
   * revision's snapshot, none of which the handler reads - are what took the
   * recount past the 300 s a request gets, on the 2026-11-18 export. */
  it("reads every collection through a field mask", async () => {
    await handler({} as never);

    expect([...selected.keys()].sort()).toEqual([
      "edges",
      "extractions",
      "nodes",
      "notes",
      "revisions",
      "votes",
    ]);
    expect(selected.get("nodes")).not.toContain("stats");
    expect(selected.get("nodes")).not.toContain("nameChunksLower");
    expect(selected.get("revisions")).not.toContain("data");
  });

  /** Waiting for the writer every so often is what keeps the computed updates
   * from piling up in memory behind its throttle. */
  it("writes every node, waiting for the writer every 500 updates", async () => {
    collections.nodes = Array.from({ length: 1001 }, (_, i) => ({
      id: `person-${i}`,
      data: () => ({ type: "person", name: `P${i}` }),
    }));

    await handler({} as never);

    expect(writerUpdate).toHaveBeenCalledTimes(1001);
    expect(writerFlush).toHaveBeenCalledTimes(2);
    expect(writerClose).toHaveBeenCalledTimes(1);
  });

  it("fails when a node could not be written, before the region rows", async () => {
    collections.nodes = [
      { id: "person-1", data: () => ({ type: "person", name: "A" }) },
      { id: "person-2", data: () => ({ type: "person", name: "B" }) },
    ];
    writerUpdate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("NOT_FOUND"));

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(writerClose).toHaveBeenCalled();
    expect(statsDocSet).not.toHaveBeenCalled();
  });

  /** `stats` is written as one map, so a pass that did not count the facts
   * would take `stats.factsCount` off every person - and /eksploruj/tabela's
   * „Liczba faktów” sort drops a person who lacks the field rather than
   * sorting them last, so the whole table would empty out behind it. */
  it("recounts the extracted facts onto each person", async () => {
    collections.nodes = [
      { id: "person-1", data: () => ({ type: "person", name: "A" }) },
      { id: "person-2", data: () => ({ type: "person", name: "B" }) },
    ];
    collections.extractions = [
      { get: (field: string) => (field === "personNodeId" ? "person-1" : "") },
      { get: (field: string) => (field === "personNodeId" ? "person-1" : "") },
      { get: () => undefined },
    ];

    await handler({} as never);

    expect(writtenBy((data) => data.stats.factsCount)).toEqual({
      "person-1": 2,
      "person-2": 0,
    });
  });

  /** The newest revision, how many there are, and whether the approved one
   * is behind - by `node_id`, or by the `nodeId` older revisions carry. */
  it("sums up each node's revisions", async () => {
    collections.nodes = [
      {
        id: "person-1",
        data: () => ({
          type: "person",
          name: "A",
          revision_id: "revisions/rev-old",
        }),
      },
      { id: "person-2", data: () => ({ type: "person", name: "B" }) },
    ];
    collections.revisions = [
      {
        id: "rev-old",
        data: () => ({
          node_id: "person-1",
          update_time: "2026-01-01T10:00:00.000Z",
        }),
      },
      {
        id: "rev-new",
        data: () => ({
          nodeId: "person-1",
          update_time: { toDate: () => new Date("2026-02-01T10:00:00Z") },
        }),
      },
    ];

    await handler({} as never);

    expect(writtenBy((data) => data.revisions)).toEqual({
      "person-1": {
        latest_id: "rev-new",
        latest_time: "2026-02-01T10:00:00.000Z",
        total: 2,
        has_unapproved: true,
      },
      "person-2": null,
    });
  });

  /** The candidacies are edges, and the table's „Wybory” filter cannot read
   * another collection - so the elections are written onto the person. A
   * region is handed every candidacy filed in it too, and none of them is its
   * own. */
  it("files a person under the elections they stood in, and a region under none", async () => {
    collections.nodes = [
      { id: "person-1", data: () => ({ type: "person", name: "A" }) },
      {
        id: "teryt22",
        data: () => ({ type: "region", name: "pomorskie", teryt: "22" }),
      },
    ];
    collections.edges = [
      {
        data: () => ({
          type: "election",
          source: "person-1",
          target: "teryt22",
          start_date: "2023-01-01",
          position: "Sejm",
          published: true,
        }),
      },
    ];

    await handler({} as never);

    expect(
      writtenBy((data) => [
        data.stats.edges.all.elections,
        data.stats.edges.approved.elections,
      ]),
    ).toEqual({
      "person-1": [["parliament-2023"], ["parliament-2023"]],
      teryt22: [[], []],
    });
  });

  /** The home map colours a powiat by its people's parties, so its row carries
   * them: each person once, in the party the graph draws them in. */
  it("counts a powiat's people by party on its row, and only a powiat's", async () => {
    const person = (id: string, parties: string[], published = true) => ({
      id,
      data: () => ({ type: "person", name: id, parties, published }),
    });
    collections.nodes = [
      person("pis", ["PiS"]),
      // SLD is counted with Nowa Lewica, as on every party chart.
      person("sld", ["SLD"]),
      // A named party is drawn over „Inne”.
      person("po", ["Inne", "PO"]),
      person("bez", []),
      person("szkic", ["PiS"], false),
      {
        id: "teryt1811",
        data: () => ({
          type: "region",
          name: "Powiat mielecki",
          teryt: "1811",
        }),
      },
      {
        id: "teryt18",
        data: () => ({ type: "region", name: "podkarpackie", teryt: "18" }),
      },
      { id: "mzbm", data: () => ({ type: "place", name: "MZBM" }) },
    ];
    collections.edges = [
      ...["pis", "sld", "po", "bez", "szkic"].map((source) => ({
        data: () => ({
          type: "employed",
          source,
          target: "mzbm",
          published: true,
        }),
      })),
      { data: () => ({ type: "seat", source: "teryt1811", target: "mzbm" }) },
      { data: () => ({ type: "owns", source: "teryt18", target: "mzbm" }) },
    ];

    await handler({} as never);

    expect(selected.get("nodes")).toContain("parties");
    const rows = statsDocSet.mock.calls[0]![0].regions;
    expect(rows).toContainEqual({
      id: "teryt1811",
      teryt: "1811",
      name: "Powiat mielecki",
      people: 4,
      parties: { PiS: 1, "Nowa Lewica": 1, PO: 1 },
    });
    expect(rows).toContainEqual({
      id: "teryt18",
      teryt: "18",
      name: "podkarpackie",
      people: 4,
    });
  });

  /** The search box reads the line under a person off the documents its
   * passes already hold, so it is worked out here and stored on the person:
   * one per kind of reader (shared/searchLine.ts). */
  it("stores the line the search box shows under each person", async () => {
    collections.nodes = [
      {
        id: "radny",
        data: () => ({
          type: "person",
          name: "Robert Wójcik",
          published: true,
          revision_id: "rev-radny",
        }),
      },
      {
        id: "nobody",
        data: () => ({ type: "person", name: "Robert Nikt" }),
      },
      {
        // Nobody has published him, nor did an import write him.
        id: "imiennik",
        data: () => ({ type: "person", name: "Robert Wójcik" }),
      },
      {
        id: "teryt1811",
        data: () => ({
          type: "region",
          name: "Powiat mielecki",
          teryt: "1811",
        }),
      },
      {
        id: "mzbm",
        data: () => ({
          type: "place",
          name: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH (Mielec)",
        }),
      },
    ];
    collections.edges = [
      {
        id: "run",
        data: () => ({
          type: "election",
          source: "radny",
          target: "teryt1811",
          position: "Rada miasta",
          start_date: "2024-01-01",
          elected: true,
          published: true,
        }),
      },
      {
        id: "post",
        data: () => ({
          type: "employed",
          source: "radny",
          target: "mzbm",
          start_date: "2018-07-02",
          end_date: "2019-06-26",
        }),
      },
      {
        id: "seat",
        data: () => ({ type: "seat", source: "teryt1811", target: "mzbm" }),
      },
      {
        id: "imiennik-run",
        data: () => ({
          type: "election",
          source: "imiennik",
          target: "teryt1811",
          position: "Rada miasta",
          start_date: "2024-01-01",
          elected: true,
        }),
      },
      {
        id: "imiennik-post",
        data: () => ({
          type: "employed",
          source: "imiennik",
          target: "mzbm",
          start_date: "2020-01-01",
        }),
      },
    ];
    // The post was imported, which is what lets its teaser show it.
    collections.revisions = [
      {
        id: "post-rev",
        data: () => ({
          node_id: "post",
          update_time: "2026-05-01T10:00:00Z",
          update_automatic: true,
        }),
      },
    ];

    await handler({} as never);

    const written = writtenBy((data) => data.stats.searchLine);
    const seat = {
      what: "Rada miasta",
      when: "2024",
      election: "local-2024:won",
    };
    expect(written.radny).toEqual({
      // The published line takes no town from a post nobody has published.
      approved: { ...seat, where: "powiat mielecki", ties: ["teryt1811"] },
      all: { ...seat, where: "Mielec", ties: ["teryt1811", "mzbm"] },
      teaser: {
        where: "Mielec",
        what: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH",
        when: "do 2019",
        ties: ["mzbm"],
      },
    });
    // Unpublished: a signed in reader is told the latest post, not the PKW
    // run (decision on 2026-11-18), and the teaser shows nothing of a person
    // no import wrote.
    expect(written.imiennik).toEqual({
      all: {
        where: "Mielec",
        what: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH",
        ties: ["mzbm"],
      },
    });
    // Nothing to say, and nothing stored to say it.
    expect(written.nobody).toBeUndefined();
    expect(written.mzbm).toBeUndefined();
  });
});
