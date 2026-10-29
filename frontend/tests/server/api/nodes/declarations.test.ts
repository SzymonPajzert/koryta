import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/declarations.get";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
});

let nodes: Record<string, Record<string, unknown> | undefined> = {};
let publications: Record<string, Record<string, unknown> | undefined> = {};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          data: () =>
            name === "declarationPublications" ? publications[id] : nodes[id],
        }),
      }),
    }),
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

const DECLARATION = {
  url: "https://bip.strzelin.pl/download/1",
  year: 2023,
  unit: "Strzelin (gmina miejsko-wiejska)",
  office: "Rada gminy",
};

beforeEach(() => {
  nodes = {
    kowalska: { type: "person", name: "Anna Kowalska", published: true },
  };
  publications = {};
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
    };
    expect(await call("kowalska")).toEqual({
      autoPublished: null,
      declarations: [DECLARATION],
    });
  });

  it("answers 404, never an empty answer, for a draft or a page with nothing", async () => {
    publications.kowalska = { status: "queued", declarations: [DECLARATION] };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });

    nodes.kowalska = {
      type: "person",
      name: "Anna Kowalska",
      published: false,
    };
    publications.kowalska = {
      status: "published",
      declarations: [DECLARATION],
    };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });

    await expect(call("nobody")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("drops a declaration whose address is not a web link", async () => {
    publications.kowalska = {
      status: "confirmed",
      declarations: [{ ...DECLARATION, url: "javascript:alert(1)" }],
    };
    await expect(call("kowalska")).rejects.toMatchObject({ statusCode: 404 });
  });
});
