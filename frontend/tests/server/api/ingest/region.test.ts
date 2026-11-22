import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/region.post";

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.readValidatedBody = async (_event: any, parse: any) =>
    parse(await mockReadBody());
  return { mockReadBody };
});

type Doc = Record<string, unknown>;

/** The stored documents, by collection and id, and every write committed. */
let store: Record<string, Record<string, Doc>> = {};
let writes: { op: string; collection: string; id: string; data: Doc }[] = [];

const ref = (collection: string, id: string) => ({ collection, id });

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (collection: string) => ({
      doc: (id: string) => ref(collection, id),
      where: (field: string, op: string, value: unknown) => {
        expect([collection, field, op, value]).toEqual([
          "nodes",
          "type",
          "==",
          "region",
        ]);
        return {
          select: () => ({
            get: async () => {
              const docs = Object.entries(store.nodes ?? {})
                .filter(([, node]) => node.type === "region")
                .map(([id, node]) => ({
                  id,
                  ref: ref("nodes", id),
                  data: () => node,
                }));
              return { docs, size: docs.length };
            },
          }),
        };
      },
    }),
    getAll: async (...refs: { collection: string; id: string }[]) =>
      refs.map(({ collection, id }) => ({
        id,
        exists: store[collection]?.[id] !== undefined,
      })),
    batch: () => {
      const pending: typeof writes = [];
      const add =
        (op: string) =>
        (target: { collection: string; id: string }, data: Doc) =>
          pending.push({
            op,
            collection: target.collection,
            id: target.id,
            data,
          });
      return {
        set: add("set"),
        update: add("update"),
        commit: async () => {
          for (const write of pending) {
            writes.push(write);
            const docs = (store[write.collection] ??= {});
            docs[write.id] =
              write.op === "set"
                ? write.data
                : { ...docs[write.id], ...write.data };
          }
        },
      };
    },
  }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

// The real gate runs against whatever `getUser` hands back.
const mockGetUser = vi.fn();
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

const STAROSTWO = {
  teryt: "2215",
  region: "wejherowski",
  name: "Starostwo Powiatowe w Wejherowie",
  regon: "191686414",
  nip: "5881831062",
};
const WEJHEROWO = {
  teryt: "2215031",
  region: "Wejherowo",
  name: "Urząd Miejski w Wejherowie",
  regon: "000526251",
  nip: "5882155172",
};
const WEJHEROWO_WIEJSKA = {
  teryt: "2215102",
  region: "Wejherowo",
  name: "Urząd Gminy Wejherowo",
  regon: "000545113",
  nip: "5881007736",
};
const POMORSKIE = [
  {
    teryt: "22",
    region: "POMORSKIE",
    name: "Pomorski Urząd Wojewódzki w Gdańsku",
    regon: "000514242",
    nip: "5831066122",
  },
  {
    teryt: "22",
    region: "POMORSKIE",
    name: "Urząd Marszałkowski Województwa Pomorskiego w Gdańsku",
    regon: "191686443",
    nip: "5832569948",
  },
];
const WARKA = {
  teryt: "1406113",
  region: "Warka",
  name: "Urząd Miejski w Warce",
  regon: "000526624",
  nip: "7971385756",
};
const TABLE = [...POMORSKIE, STAROSTWO, WEJHEROWO, WEJHEROWO_WIEJSKA, WARKA];

/** A region payload as `RegionPayloads` emits it. */
const payload = (
  teryt: string,
  name: string,
  parent?: string,
  replaces?: string[],
) => ({
  node_id: `teryt${teryt}`,
  type: "region",
  name,
  teryt,
  ...(parent
    ? {
        edge: {
          edge_id: `edge_teryt${parent}_teryt${teryt}_owns`,
          source: `teryt${parent}`,
          target: `teryt${teryt}`,
          type: "owns",
        },
      }
    : {}),
  ...(replaces ? { replaces } : {}),
});

const region = (teryt: string, extra: Doc = {}): Doc => ({
  type: "region",
  name: `Region ${teryt}`,
  teryt,
  ...extra,
});

const upload = (body: Doc) => {
  mockReadBody.mockResolvedValue(body);
  return handler({} as never);
};

/** What the committed writes left in `offices`, by node id. */
const officesWritten = () =>
  Object.fromEntries(
    writes
      .filter((write) => write.collection === "nodes" && write.data.offices)
      .map((write) => [write.id, write.data.offices]),
  );

describe("POST /api/ingest/region", () => {
  beforeEach(() => {
    writes = [];
    mockGetUser.mockResolvedValue({ uid: "uploader", datascience: true });
    store = {
      nodes: {
        teryt22: region("22"),
        teryt2215: region("2215"),
        teryt2215031: region("2215031"),
        teryt1406114: region("1406114"),
        person: { type: "person", name: "Jan Kowalski" },
      },
    };
  });

  describe("the urzędy", () => {
    it("gives each region the rows the dialog answers it with", async () => {
      const answer = await upload({ offices: TABLE });

      expect(officesWritten()).toEqual({
        teryt22: POMORSKIE,
        // A powiat its starostwo alone: every gmina is a region of its own.
        teryt2215: [STAROSTWO],
        teryt2215031: [WEJHEROWO],
        // The town's half of Warka is run by the gmina's urząd.
        teryt1406114: [WARKA],
      });
      expect(answer).toMatchObject({
        regions: undefined,
        offices: { rows: 6, regions: 4, updated: 4, unchanged: 0 },
      });
    });

    it("writes nothing to a region whose rows are already there", async () => {
      store.nodes!.teryt2215031 = region("2215031", {
        // Stored with its fields in another order, as Firestore may hand it.
        offices: [
          {
            nip: "5882155172",
            regon: "000526251",
            name: "Urząd Miejski w Wejherowie",
            region: "Wejherowo",
            teryt: "2215031",
          },
        ],
      });

      const answer = await upload({ offices: TABLE });

      expect(Object.keys(officesWritten())).not.toContain("teryt2215031");
      expect(answer.offices).toMatchObject({ updated: 3, unchanged: 1 });
    });

    it("leaves a region the table has no row for as it was", async () => {
      store.nodes!.teryt2215052 = region("2215052", { offices: [WEJHEROWO] });
      store.nodes!.noCode = { type: "region", name: "Województwo Puste" };

      const answer = await upload({ offices: TABLE });

      expect(Object.keys(officesWritten())).not.toContain("teryt2215052");
      expect(answer.offices).toMatchObject({
        without: { count: 2, named: ["2215052", "noCode"] },
      });
    });

    it("skips a removed region", async () => {
      store.nodes!.teryt2215031 = region("2215031", { deleted: true });

      await upload({ offices: TABLE });

      expect(Object.keys(officesWritten())).not.toContain("teryt2215031");
    });

    it("leaves out a row whose REGON or NIP fails its check digit", async () => {
      // A place proposed from it would be refused, and the contributor told the
      // register's own number is wrong.
      const answer = await upload({
        offices: [
          ...TABLE,
          {
            ...WEJHEROWO,
            name: "Urząd z błędnym REGON-em",
            regon: "000526252",
          },
          { ...POMORSKIE[0]!, nip: "5831066123" },
        ],
      });

      expect(officesWritten().teryt2215031).toEqual([WEJHEROWO]);
      expect(officesWritten().teryt22).toEqual(POMORSKIE);
      expect(answer.offices).toMatchObject({
        refused: {
          count: 2,
          named: [
            "2215031 Urząd z błędnym REGON-em",
            "22 Pomorski Urząd Wojewódzki w Gdańsku",
          ],
        },
      });
    });

    it("counts a name the „Urząd” chip would not recognise", async () => {
      const answer = await upload({
        offices: [
          ...TABLE,
          { ...WEJHEROWO, teryt: "2215021", name: "Gmina Miejska Rumia" },
        ],
      });

      expect(answer.offices).toMatchObject({
        unnamed: { count: 1, named: ["2215021 Gmina Miejska Rumia"] },
      });
    });
  });

  describe("the regions", () => {
    it("creates a gmina the site lacks, with its urząd and the edge from its powiat", async () => {
      const answer = await upload({
        regions: [
          payload("2215", "Powiat wejherowski", "22"),
          payload("2215102", "Gmina wiejska Wejherowo", "2215", [
            "Gmina Wejherowo",
          ]),
        ],
        offices: TABLE,
      });

      expect(store.nodes!.teryt2215102).toEqual({
        name: "Gmina wiejska Wejherowo",
        type: "region",
        teryt: "2215102",
        published: true,
        offices: [WEJHEROWO_WIEJSKA],
        // What a listing filters on, before anything has counted it.
        stats: { nodeGroupSize: 0, isApproved: true },
      });
      expect(store.edges!.edge_teryt2215_teryt2215102_owns).toEqual({
        source: "teryt2215",
        target: "teryt2215102",
        type: "owns",
        published: true,
      });
      expect(answer.regions).toMatchObject({
        sent: 2,
        created: { count: 1, named: ["2215102 Gmina wiejska Wejherowo"] },
        unchanged: 1,
        edges: 1,
      });
    });

    it("creates a powiat and its gmina in one upload, parent first", async () => {
      // Sent child first; the powiat still has to exist for the edge.
      await upload({
        regions: [
          payload("1406113", "Gmina Warka", "1406"),
          payload("1406", "Powiat grójecki", "14"),
        ],
      });

      expect(store.nodes!.teryt1406).toMatchObject({ name: "Powiat grójecki" });
      expect(store.edges!.edge_teryt1406_teryt1406113_owns).toMatchObject({
        source: "teryt1406",
      });
    });

    it("finds an existing region by its code, whatever its id", async () => {
      store.nodes!["opole-powiat"] = region("1661", { name: "Opole" });

      const answer = await upload({
        regions: [
          payload("1661", "Opole", "16"),
          payload("1661011", "Gmina Opole", "1661"),
        ],
      });

      expect(store.nodes!.teryt1661).toBeUndefined();
      expect(store.edges!["edge_opole-powiat_teryt1661011_owns"]).toMatchObject(
        { source: "opole-powiat", target: "teryt1661011" },
      );
      expect(answer.regions).toMatchObject({ unchanged: 1, edges: 1 });
    });

    it("renames a gmina that still has the name another in its powiat shares", async () => {
      store.nodes!.teryt2215031 = region("2215031", {
        name: "Gmina Wejherowo",
      });

      const answer = await upload({
        regions: [
          payload("2215031", "Gmina miejska Wejherowo", "2215", [
            "Gmina Wejherowo",
          ]),
        ],
      });

      expect(store.nodes!.teryt2215031!.name).toBe("Gmina miejska Wejherowo");
      expect(answer.regions).toMatchObject({
        renamed: { count: 1, named: ["2215031 Gmina miejska Wejherowo"] },
      });
    });

    it("keeps a name somebody gave a region", async () => {
      // Only the shared name a payload replaces is ever taken over.
      store.nodes!.teryt2215031 = region("2215031", {
        name: "Wejherowo (miasto)",
      });

      await upload({
        regions: [
          payload("2215031", "Gmina miejska Wejherowo", "2215", [
            "Gmina Wejherowo",
          ]),
        ],
      });

      expect(store.nodes!.teryt2215031!.name).toBe("Wejherowo (miasto)");
    });

    it("does not bring back a region that was taken down", async () => {
      store.nodes!.teryt2215102 = region("2215102", { deleted: true });

      const answer = await upload({
        regions: [payload("2215102", "Gmina wiejska Wejherowo", "2215")],
      });

      expect(writes).toEqual([]);
      expect(answer.regions).toMatchObject({
        removed: { count: 1, named: ["2215102"] },
      });
    });

    it("does not overwrite a document already under the id", async () => {
      store.nodes!.teryt2215102 = { type: "place", name: "Coś innego" };

      const answer = await upload({
        regions: [payload("2215102", "Gmina wiejska Wejherowo", "2215")],
      });

      expect(store.nodes!.teryt2215102).toEqual({
        type: "place",
        name: "Coś innego",
      });
      expect(answer.regions).toMatchObject({
        taken: { count: 1, named: ["teryt2215102"] },
      });
    });

    describe("with a cap on how many it creates", () => {
      // Sent child first and out of code order: the cap takes the powiat,
      // then the gminy by code.
      const grojecki = [
        payload("1406113", "Gmina Warka", "1406"),
        payload("1406012", "Gmina Belsk Duży", "1406"),
        payload("1406", "Powiat grójecki", "14"),
      ];

      beforeEach(() => {
        store.nodes!.teryt14 = region("14");
      });

      it("creates no more than it may, parents first, and counts the rest as waiting", async () => {
        const answer = await upload({ regions: grojecki, maxCreated: 2 });

        expect(store.nodes!.teryt1406).toMatchObject({ teryt: "1406" });
        expect(store.nodes!.teryt1406012).toMatchObject({ teryt: "1406012" });
        expect(store.nodes!.teryt1406113).toBeUndefined();
        expect(answer.regions).toMatchObject({
          created: {
            count: 2,
            named: ["1406 Powiat grójecki", "1406012 Gmina Belsk Duży"],
          },
          waiting: { count: 1, named: ["1406113 Gmina Warka"] },
          edges: 2,
        });
      });

      it("goes on the next time from where it stopped", async () => {
        await upload({ regions: grojecki, maxCreated: 2 });
        writes = [];

        const answer = await upload({ regions: grojecki, maxCreated: 2 });

        expect(store.nodes!.teryt1406113).toMatchObject({ teryt: "1406113" });
        expect(answer.regions).toMatchObject({
          created: { count: 1, named: ["1406113 Gmina Warka"] },
          unchanged: 2,
          waiting: { count: 0 },
        });
      });

      it("still renames and gives the regions there their urzędy at 0", async () => {
        store.nodes!.teryt2215031 = region("2215031", {
          name: "Gmina Wejherowo",
        });

        const answer = await upload({
          regions: [
            payload("2215031", "Gmina miejska Wejherowo", "2215", [
              "Gmina Wejherowo",
            ]),
            payload("2215102", "Gmina wiejska Wejherowo", "2215"),
          ],
          offices: TABLE,
          maxCreated: 0,
        });

        expect(store.nodes!.teryt2215102).toBeUndefined();
        expect(store.nodes!.teryt2215031).toMatchObject({
          name: "Gmina miejska Wejherowo",
          offices: [WEJHEROWO],
        });
        expect(answer.regions).toMatchObject({
          created: { count: 0 },
          renamed: { count: 1 },
          waiting: { count: 1, named: ["2215102 Gmina wiejska Wejherowo"] },
        });
      });
    });

    it("creates a region whose parent the site lacks, without the edge", async () => {
      const answer = await upload({
        regions: [payload("0201011", "Gmina Bolesławiec", "0201")],
      });

      expect(store.nodes!.teryt0201011).toMatchObject({ teryt: "0201011" });
      expect(store.edges).toBeUndefined();
      expect(answer.regions).toMatchObject({
        orphaned: { count: 1, named: ["0201011"] },
      });
    });
  });

  it("refuses an account outside the datascience group", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader" });

    await expect(upload({ offices: TABLE })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(writes).toEqual([]);
  });

  it("refuses a body with nothing to write, or a row that is not one", async () => {
    await expect(upload({})).rejects.toThrow();
    await expect(upload({ offices: [], regions: [] })).rejects.toThrow();
    await expect(
      upload({ offices: [{ ...WEJHEROWO, teryt: "Wejherowo" }] }),
    ).rejects.toThrow();
    await expect(
      upload({ regions: [{ ...payload("22", "Pomorskie"), type: "place" }] }),
    ).rejects.toThrow();
    await expect(
      upload({ regions: [payload("22", "Pomorskie")], maxCreated: -1 }),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});
