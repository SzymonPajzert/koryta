import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/declarations.get";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
});

type Doc = Record<string, unknown>;
let nodes: Record<string, Doc | undefined> = {};
let publications: Record<string, Doc | undefined> = {};
let extracts: Record<string, Doc | undefined> = {};

/** The documents by collection, read when asked. */
const table = (name: string): Record<string, Doc | undefined> =>
  name === "declarationPublications"
    ? publications
    : name === "declarationExtracts"
      ? extracts
      : nodes;

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        collection: name,
        get: async () => ({ id, data: () => table(name)[id] }),
      }),
    }),
    getAll: async (...refs: { id: string; collection: string }[]) =>
      refs.map((ref) => ({
        id: ref.id,
        data: () => table(ref.collection)[ref.id],
      })),
  }),
}));
vi.mock("../../../../server/utils/merge", () => ({
  resolveMergedNode: async (_db: unknown, id: string) => ({
    id,
    snapshot: nodes[id] ? { data: () => nodes[id] } : undefined,
  }),
}));
vi.mock("../../../../server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getRouterParam: (event: { id: string }) => event.id,
}));

const call = (id: string) =>
  (handler as unknown as (event: { id: string }) => Promise<unknown>)({ id });

const BORN = "1979-07-15";

const DECLARATION = {
  url: "https://bip.strzelin.pl/download/1",
  year: 2023,
  unit: "Strzelin (gmina miejsko-wiejska)",
  office: "Rada gminy",
};

/** A crop of `DECLARATION`, settled on `BORN` by readers unless told
 * otherwise. */
function crop(fields: Doc = {}): Doc {
  return {
    status: "agreed",
    agreed: { value: BORN, kind: "date", by: "readers" },
    url: DECLARATION.url,
    declarationYear: DECLARATION.year,
    units: [{ unitName: DECLARATION.unit, office: DECLARATION.office }],
    ...fields,
  };
}

beforeEach(() => {
  nodes = {
    kowalska: {
      type: "person",
      name: "Anna Kowalska",
      published: true,
      birthDate: BORN,
    },
  };
  publications = {};
  extracts = { "abc-p0": crop() };
});

describe("api/nodes/[id]/declarations", () => {
  it("says the site published the page, with the declaration to check", async () => {
    publications.kowalska = {
      status: "published",
      autoPublished: true,
      publishedAt: { toDate: () => new Date("2026-10-29T08:15:00Z") },
      declarations: [DECLARATION],
      // Never on the answer: what the automation did behind the scenes.
      edges: { published: ["e1"], held: [] },
      extractIds: ["abc-p0"],
    };
    expect(await call("kowalska")).toEqual({
      autoPublished: { at: "2026-10-29T08:15:00.000Z" },
      declarations: [DECLARATION],
    });
  });

  it("links the declaration of a page a person published, without the note", async () => {
    publications.kowalska = {
      status: "confirmed",
      declarations: [DECLARATION],
      extractIds: ["abc-p0"],
    };
    expect(await call("kowalska")).toEqual({
      autoPublished: null,
      declarations: [DECLARATION],
    });
  });

  it("never calls a page an admin pressed for one the site published itself", async () => {
    // As a press of „Opublikuj z kolejki” leaves the record (`publishPage`).
    publications.kowalska = {
      status: "published",
      autoPublished: false,
      pressedBy: "admin-uid",
      publishedAt: { toDate: () => new Date("2026-10-30T12:00:00Z") },
      declarations: [DECLARATION],
      extractIds: ["abc-p0"],
    };
    expect(await call("kowalska")).toEqual({
      autoPublished: null,
      declarations: [DECLARATION],
    });
  });

  it("answers 404, never an empty answer, for a draft or a page with nothing", async () => {
    publications.kowalska = {
      status: "queued",
      declarations: [DECLARATION],
      extractIds: ["abc-p0"],
    };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });

    nodes.kowalska = { ...nodes.kowalska, published: false };
    publications.kowalska = {
      status: "published",
      declarations: [DECLARATION],
      extractIds: ["abc-p0"],
    };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });

    await expect(call("nobody")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("drops a declaration whose address is not a web link", async () => {
    extracts["abc-p0"] = crop({ url: "javascript:alert(1)" });
    publications.kowalska = {
      status: "confirmed",
      declarations: [{ ...DECLARATION, url: "javascript:alert(1)" }],
      extractIds: ["abc-p0"],
    };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists a declaration only while its crop confirms the page's birth date", async () => {
    const LATER = {
      url: "https://bip.strzelin.pl/download/2",
      year: 2024,
      unit: DECLARATION.unit,
      office: DECLARATION.office,
    };
    publications.kowalska = {
      status: "confirmed",
      declarations: [DECLARATION, LATER],
      extractIds: ["abc-p0", "def-p0"],
    };
    // The job read the 2024 one off a typed form: that confirms too.
    extracts["def-p0"] = crop({
      url: LATER.url,
      declarationYear: LATER.year,
      agreed: { value: BORN, kind: "date", by: "machine" },
    });
    expect(await call("kowalska")).toMatchObject({
      declarations: [DECLARATION, LATER],
    });

    // An admin took the 2023 one back.
    extracts["abc-p0"] = crop({ status: "withdrawn", agreed: null });
    expect(await call("kowalska")).toMatchObject({ declarations: [LATER] });

    // An admin settled the 2024 one on her date: that confirms nothing.
    extracts["def-p0"] = crop({
      url: LATER.url,
      declarationYear: LATER.year,
      agreed: { value: BORN, kind: "date", by: "admin" },
    });
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("says nothing, the automatic publication included, once the page's date is another", async () => {
    publications.kowalska = {
      status: "published",
      autoPublished: true,
      publishedAt: { toDate: () => new Date("2026-10-29T08:15:00Z") },
      declarations: [DECLARATION],
      extractIds: ["abc-p0"],
    };
    nodes.kowalska = { ...nodes.kowalska, birthDate: "1980-01-02" };

    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });
  });
});
