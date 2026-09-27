import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/offices.get";

let nodes: Record<string, Record<string, unknown>> = {};
let revisions: Record<string, Record<string, unknown>> = {};
/** The `in` queries the handler ran, as collection, field and values. */
let queries: { collection: string; field: string; values: unknown[] }[] = [];

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((collection: string) => {
      const docs = () => (collection === "revisions" ? revisions : nodes);
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: docs()[id] !== undefined,
            data: () => docs()[id],
          }),
        }),
        where: (field: string, op: string, values: unknown[]) => {
          expect(op).toBe("in");
          expect(values.length).toBeLessThanOrEqual(30);
          queries.push({ collection, field, values });
          return {
            get: async () => ({
              docs: Object.entries(docs())
                .filter(([, doc]) => values.includes(doc[field]))
                .map(([id, doc]) => ({ id, data: () => doc })),
            }),
          };
        },
      };
    }),
  })),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "reader-uid" }),
}));

/** The table as the storage hands it back in a build: bytes, not text. */
const TABLE = [
  '{"teryt":"1406113","region":"Warka","name":"Urz\\u0105d Miejski w Warce","regon":"000526624","nip":"7971385756"}',
  '{"teryt":"2215","region":"wejherowski","name":"Starostwo Powiatowe w Wejherowie","regon":"191686414","nip":"5881831062"}',
  '{"teryt":"2215031","region":"Wejherowo","name":"Urz\\u0105d Miejski w Wejherowie","regon":"000526251","nip":"5882155172"}',
  '{"teryt":"2215102","region":"Wejherowo","name":"Urz\\u0105d Gminy Wejherowo","regon":"000545113","nip":"5881007736"}',
  '{"teryt":"22","region":"POMORSKIE","name":"POMORSKI URZ\\u0104D WOJEW\\u00d3DZKI W GDA\\u0143SKU","regon":"000514242","nip":"5831066122"}',
  '{"teryt":"22","region":"POMORSKIE","name":"Urz\\u0105d Marsza\\u0142kowski Wojew\\u00f3dztwa Pomorskiego w Gda\\u0144sku","regon":"191686443","nip":"5832569948"}',
].join("\n");

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).useStorage = () => ({
    getItemRaw: async () => new TextEncoder().encode(TABLE),
  });
});

const call = (id: string) => {
  globalThis.getRouterParam = vi.fn(() => id);
  return handler({} as never);
};

describe("GET /api/nodes/[id]/offices", () => {
  beforeEach(() => {
    queries = [];
    revisions = {};
    nodes = {
      teryt2215031: {
        type: "region",
        name: "Gmina Wejherowo",
        teryt: "2215031",
        published: true,
      },
      teryt2215: {
        type: "region",
        name: "Powiat wejherowski",
        teryt: "2215",
        published: true,
      },
      teryt22: { type: "region", name: "Województwo Pomorskie", teryt: "22" },
      teryt2215052: {
        type: "region",
        name: "Gmina Gniewino",
        teryt: "2215052",
      },
      teryt1406114: {
        type: "region",
        name: "Gmina Warka",
        teryt: "1406114",
      },
      person: { type: "person", name: "Jan Kowalski" },
    };
  });

  it("names the urząd, as a new place when the site has none", async () => {
    const { offices } = await call("teryt2215031");

    expect(offices).toEqual([
      {
        teryt: "2215031",
        region: "Wejherowo",
        name: "Urząd Miejski w Wejherowie",
        regon: "000526251",
        nip: "5882155172",
        node: null,
        gmina: null,
        seatId: "teryt2215031",
      },
    ]);
    expect(queries).toEqual([
      { collection: "nodes", field: "regonNumber", values: ["000526251"] },
    ]);
  });

  it("points at the place already filed under the REGON", async () => {
    // Whoever added it first may have named it their own way; the number is
    // what says it is the same office.
    nodes.urzad = {
      type: "place",
      name: "UM Wejherowo",
      regonNumber: "000526251",
      published: true,
    };

    const { offices } = await call("teryt2215031");

    expect(offices[0]!.node).toEqual({ id: "urzad", name: "UM Wejherowo" });
  });

  it("does not point at a removed page", async () => {
    nodes.urzad = {
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      deleted: true,
    };

    const { offices } = await call("teryt2215031");

    expect(offices[0]!.node).toBeNull();
  });

  it("prefers the published copy of a duplicate", async () => {
    nodes.draft = {
      type: "place",
      name: "Urząd (szkic)",
      regonNumber: "000526251",
      published: false,
    };
    revisions.draftRev = { node_id: "draft", status: "pending" };
    nodes.live = {
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      published: true,
    };

    const { offices } = await call("teryt2215031");

    expect(offices[0]!.node?.id).toBe("live");
  });

  it("points at a proposal still waiting for a reviewer", async () => {
    // What the last contributor proposed a minute ago: the post waits for it
    // in the same queue, rather than a second copy of the urząd joining it.
    nodes.proposed = {
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      published: false,
    };
    revisions.proposal = { node_id: "proposed", status: "pending" };

    const { offices } = await call("teryt2215031");

    expect(offices[0]!.node?.id).toBe("proposed");
  });

  it("does not point at a proposal that was turned down", async () => {
    // Rejecting marks the revision and leaves the draft - which would then
    // hold every post filed under it off the site for good.
    nodes.rejected = {
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      published: false,
    };
    revisions.proposal = {
      node_id: "rejected",
      status: "rejected",
      reject_reason: "Duplikat",
    };

    const { offices } = await call("teryt2215031");

    expect(offices[0]!.node).toBeNull();
    expect(queries).toContainEqual({
      collection: "revisions",
      field: "node_id",
      values: ["rejected"],
    });
  });

  it("reads no revisions for a place that is live", async () => {
    nodes.urzad = {
      type: "place",
      name: "Urząd Miejski w Wejherowie",
      regonNumber: "000526251",
      published: true,
    };

    await call("teryt2215031");

    expect(queries.map((query) => query.collection)).not.toContain("revisions");
  });

  it("offers both of a województwo's offices", async () => {
    const { offices } = await call("teryt22");

    expect(offices.map((office) => office.regon)).toEqual([
      "000514242",
      "191686443",
    ]);
  });

  it("offers a powiat's gminy after its starostwo, seated where they can be", async () => {
    const { offices } = await call("teryt2215");

    expect(
      offices.map(({ name, gmina, seatId }) => ({ name, gmina, seatId })),
    ).toEqual([
      {
        name: "Starostwo Powiatowe w Wejherowie",
        gmina: null,
        seatId: "teryt2215",
      },
      // The town has a region node, so its urząd goes there...
      {
        name: "Urząd Miejski w Wejherowie",
        gmina: "Gmina miejska Wejherowo",
        seatId: "teryt2215031",
      },
      // ...and the villages around it have none, so theirs goes in the powiat.
      {
        name: "Urząd Gminy Wejherowo",
        gmina: "Gmina wiejska Wejherowo",
        seatId: "teryt2215",
      },
    ]);
    // One query for the places and one for the gminy's regions.
    expect(queries).toEqual([
      {
        collection: "nodes",
        field: "regonNumber",
        values: ["191686414", "000526251", "000545113"],
      },
      {
        collection: "nodes",
        field: "teryt",
        values: ["2215031", "2215102"],
      },
    ]);
  });

  it("answers for a town's half of a gmina with the gmina's urząd", async () => {
    // Warka the town has a node, the gmina miejsko-wiejska around it none, so
    // a new urząd is seated in the town.
    const { offices } = await call("teryt1406114");

    expect(offices.map(({ name, seatId }) => ({ name, seatId }))).toEqual([
      { name: "Urząd Miejski w Warce", seatId: "teryt1406114" },
    ]);
  });

  it("seats a town's half's urząd in its gmina where the site has one", async () => {
    nodes.teryt1406113 = {
      type: "region",
      name: "Gmina Warka",
      teryt: "1406113",
    };

    const { offices } = await call("teryt1406114");

    expect(offices[0]!.seatId).toBe("teryt1406113");
  });

  it("asks nothing of the database for a region the table lacks", async () => {
    const { offices } = await call("teryt2215052");

    expect(offices).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("refuses anything that is not a region", async () => {
    await expect(call("person")).rejects.toMatchObject({ statusCode: 404 });
    await expect(call("missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});
