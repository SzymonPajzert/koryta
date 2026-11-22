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

/** The region nodes as stored, and the updates the handler committed. */
let nodes: Record<string, Record<string, unknown>> = {};
let committed: { id: string; data: Record<string, unknown> }[] = [];
let batches = 0;

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      where: (field: string, op: string, value: unknown) => {
        expect([field, op, value]).toEqual(["type", "==", "region"]);
        return {
          select: () => ({
            get: async () => {
              const docs = Object.entries(nodes)
                .filter(([, node]) => node.type === "region")
                .map(([id, node]) => ({ id, ref: { id }, data: () => node }));
              return { docs, size: docs.length };
            },
          }),
        };
      },
    }),
    batch: () => {
      const pending: { id: string; data: Record<string, unknown> }[] = [];
      return {
        update: (ref: { id: string }, data: Record<string, unknown>) =>
          pending.push({ id: ref.id, data }),
        commit: async () => {
          batches++;
          committed.push(...pending);
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

const region = (teryt: string, extra: Record<string, unknown> = {}) => ({
  type: "region",
  name: `Region ${teryt}`,
  teryt,
  ...extra,
});

const upload = (offices: unknown[] = TABLE) => {
  mockReadBody.mockResolvedValue({ offices });
  return handler({} as never);
};

const written = () =>
  Object.fromEntries(committed.map(({ id, data }) => [id, data.offices]));

describe("POST /api/ingest/region", () => {
  beforeEach(() => {
    committed = [];
    batches = 0;
    mockGetUser.mockResolvedValue({ uid: "uploader", datascience: true });
    nodes = {
      teryt22: region("22"),
      teryt2215: region("2215"),
      teryt2215031: region("2215031"),
      teryt1406114: region("1406114"),
      person: { type: "person", name: "Jan Kowalski" },
    };
  });

  it("gives each region the rows the dialog answers it with", async () => {
    const answer = await upload();

    expect(written()).toEqual({
      teryt22: POMORSKIE,
      // The starostwo, then the urzędy of the powiat's gminy.
      teryt2215: [STAROSTWO, WEJHEROWO, WEJHEROWO_WIEJSKA],
      teryt2215031: [WEJHEROWO],
      // The town's half of Warka is run by the gmina's urząd.
      teryt1406114: [WARKA],
    });
    expect(answer).toMatchObject({
      rows: 6,
      regions: 4,
      updated: 4,
      unchanged: 0,
    });
    expect(batches).toBe(1);
  });

  it("writes nothing to a region whose rows are already there", async () => {
    nodes.teryt2215031 = region("2215031", {
      // Stored with its fields in another order, as Firestore may hand it back.
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

    const answer = await upload();

    expect(Object.keys(written())).not.toContain("teryt2215031");
    expect(answer).toMatchObject({ updated: 3, unchanged: 1 });
  });

  it("leaves a region the table has no row for as it was", async () => {
    // A region with no urząd in the table keeps what it has rather than
    // being emptied, and is named in the answer.
    nodes.teryt2215052 = region("2215052", { offices: [WEJHEROWO] });
    nodes.noCode = { type: "region", name: "Województwo Puste" };

    const answer = await upload();

    expect(Object.keys(written())).not.toContain("teryt2215052");
    expect(answer).toMatchObject({
      without: { count: 2, named: ["2215052", "noCode"] },
    });
  });

  it("skips a removed region", async () => {
    nodes.teryt2215031 = region("2215031", { deleted: true });

    await upload();

    expect(Object.keys(written())).not.toContain("teryt2215031");
  });

  it("leaves out a row whose REGON or NIP fails its check digit", async () => {
    // A place proposed from it would be refused, and the contributor told the
    // register's own number is wrong.
    const answer = await upload([
      ...TABLE,
      { ...WEJHEROWO_WIEJSKA, teryt: "2215092", regon: "000542699" },
      { ...WEJHEROWO_WIEJSKA, teryt: "2215072", nip: "5881136021" },
    ]);

    expect(written().teryt2215).toEqual([
      STAROSTWO,
      WEJHEROWO,
      WEJHEROWO_WIEJSKA,
    ]);
    expect(answer).toMatchObject({
      refused: {
        count: 2,
        named: [
          "2215092 Urząd Gminy Wejherowo",
          "2215072 Urząd Gminy Wejherowo",
        ],
      },
    });
  });

  it("counts a name the „Urząd” chip would not recognise", async () => {
    const answer = await upload([
      ...TABLE,
      { ...WEJHEROWO, teryt: "2215021", name: "Gmina Miejska Rumia" },
    ]);

    expect(answer).toMatchObject({
      unnamed: { count: 1, named: ["2215021 Gmina Miejska Rumia"] },
    });
  });

  it("refuses an account outside the datascience group", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader" });

    await expect(upload()).rejects.toMatchObject({ statusCode: 403 });
    expect(committed).toEqual([]);
  });

  it("refuses a table that is not one", async () => {
    await expect(upload([])).rejects.toThrow();
    await expect(
      upload([{ ...WEJHEROWO, teryt: "Wejherowo" }]),
    ).rejects.toThrow();
    expect(committed).toEqual([]);
  });
});
