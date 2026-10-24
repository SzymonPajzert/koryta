import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/successions.get";
import type {
  CompanySuccessions,
  PersonSuccessions,
} from "../../../../server/api/edges/successions.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};
/** The revisions `importedOrReviewed` reads the first of, for a document with
 * no approved revision. Empty unless a test needs them. */
let revisions: Record<string, Record<string, unknown>> = {};

/** A query built the way the endpoint builds it: equality filters and one
 * `in` over `edges`, and over `revisions` the first by `update_time` - the
 * pairing sorts its own results, so the fake models no other order. */
function collectionQuery(
  docsOf: () => Record<string, Record<string, unknown>>,
) {
  const filters: [string, string, unknown][] = [];
  let order: string | undefined;
  let max = Infinity;

  const query = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      filters.push([field, op, value]);
      return query;
    }),
    orderBy: vi.fn((field: string) => {
      order = field;
      return query;
    }),
    limit: vi.fn((n: number) => {
      max = n;
      return query;
    }),
    get: vi.fn(async () => {
      const entries = Object.entries(docsOf()).filter(([, data]) =>
        filters.every(([field, op, value]) =>
          op === "in"
            ? (value as unknown[]).includes(data[field])
            : data[field] === value,
        ),
      );
      if (order) {
        const key = order;
        entries.sort(([, a], [, b]) =>
          String(a[key]).localeCompare(String(b[key])),
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

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${collection}/${id}` })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      collectionQuery(() =>
        collection === "revisions" ? revisions : edges,
      ).where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

/** Whether the caller is a signed in reader asking for drafts. */
const reader = vi.hoisted(() => ({ signedIn: false }));

vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => reader.signedIn,
}));

const { mockGetQuery } = vi.hoisted(() => {
  const mockGetQuery = vi.fn(() => ({}) as Record<string, unknown>);
  globalThis.getQuery = mockGetQuery as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetQuery };
});

function call<T>(query: Record<string, unknown>): Promise<T> {
  mockGetQuery.mockReturnValue(query);
  return handler({} as never) as Promise<T>;
}

/** One supervisory spell at the hospital. Every stored one says "Rada
 * Nadzorcza", whatever the institution's organ is really called. */
function seat(fields: Record<string, unknown>) {
  return {
    source: "anna",
    target: "szpital",
    type: "employed",
    name: "Rada Nadzorcza",
    published: true,
    ...fields,
  };
}

describe("api/edges/successions supervisory seats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodes = {
      anna: { name: "Anna Nowak", type: "person", published: true },
      jan: { name: "Jan Kowalski", type: "person", published: true },
      szpital: {
        name: "Szpital w Gnieźnie",
        type: "place",
        published: true,
        supervisoryBody: "rada-spoleczna",
      },
      orlen: { name: "Orlen", type: "place", published: true },
    };
    edges = {
      e1: seat({
        source: "jan",
        start_date: "2018-01-01",
        end_date: "2021-01-01",
      }),
      e2: seat({ source: "anna", start_date: "2021-01-01", end_date: null }),
    };
  });

  it("names the hospital's own organ on the handover", async () => {
    const { successions, current } = await call<CompanySuccessions>({
      companyId: "szpital",
    });

    expect(successions).toHaveLength(1);
    expect(successions[0]?.role).toBe("Rada Społeczna");
    expect(current.map((post) => post.role)).toEqual(["Rada Społeczna"]);
  });

  it("names it the same way from the person's side", async () => {
    const { posts } = await call<PersonSuccessions>({ personId: "anna" });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.role).toBe("Rada Społeczna");
  });

  it("leaves a spółka's board alone", async () => {
    edges = {
      e1: seat({
        source: "jan",
        target: "orlen",
        start_date: "2018-01-01",
        end_date: "2021-01-01",
      }),
      e2: seat({ target: "orlen", start_date: "2021-01-01", end_date: null }),
    };

    const { successions } = await call<CompanySuccessions>({
      companyId: "orlen",
    });

    expect(successions[0]?.role).toBe("Rada Nadzorcza");
  });

  it("keeps a role nobody recorded absent rather than empty", async () => {
    // `current` types the field as nullable and the card has its own wording
    // for it; `displayRole` returns undefined for a blank, so this is the one
    // place the coercion back to null matters.
    edges = {
      e2: seat({ name: "", start_date: "2021-01-01", end_date: null }),
    };

    const { current } = await call<CompanySuccessions>({
      companyId: "szpital",
    });

    expect(current[0]?.role).toBeNull();
  });
});

/** The report on PZO Gliwice: one prokurent listed under „Funkcja niepodana w
 * rejestrze" and again as „Prokurent", for one appointment uploaded once before
 * the pipeline named prokura and once after. See shared/rolelessSpells.ts. */
describe("api/edges/successions role-less posts", () => {
  function post(fields: Record<string, unknown>) {
    return { target: "pzo", type: "employed", published: true, ...fields };
  }

  /** "who: role" for each current post, which is what the section prints. */
  async function board(): Promise<string[]> {
    const { current } = await call<CompanySuccessions>({ companyId: "pzo" });
    return current.map((post) => `${post.personName}: ${post.role}`);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    nodes = {
      janina: { name: "Janina Podwójna", type: "person", published: true },
      karol: { name: "Karol Później", type: "person", published: true },
      pzo: { name: "PZO Gliwice", type: "place", published: true },
    };
  });

  it("lists a prokurent once, not again without a role", async () => {
    edges = {
      bez_funkcji: post({ source: "janina", start_date: "2026-07-14" }),
      prokurent: post({
        source: "janina",
        name: "Prokurent",
        start_date: "2026-07-14",
      }),
    };

    expect(await board()).toEqual(["Janina Podwójna: Prokurent"]);
  });

  it("keeps a role-less post whose named neighbour ended years before", async () => {
    // A different post, not the same one twice: the prokura ended in 2014,
    // and all anybody knows about the one held since 2025 is that it is held.
    edges = {
      prokurent: post({
        source: "karol",
        name: "Prokurent",
        start_date: "2009-03-02",
        end_date: "2014-10-31",
      }),
      bez_funkcji: post({ source: "karol", start_date: "2025-11-17" }),
    };

    expect(await board()).toEqual(["Karol Później: null"]);
  });

  it("keeps a prokura that followed a zarząd seat stored twice", async () => {
    // ESV9's shape: the seat stored closed and again still open, and the
    // prokura from the day it ended stored with no role. Both stay listed -
    // the stale seat is a data problem of its own, not a reason to drop the
    // one record of the current post.
    edges = {
      zarzad: post({
        source: "karol",
        name: "Zarząd",
        start_date: "2014-09-25",
        end_date: "2026-06-19",
      }),
      zarzad_nieaktualny: post({
        source: "karol",
        name: "Zarząd",
        start_date: "2014-09-25",
      }),
      prokura: post({ source: "karol", start_date: "2026-06-19" }),
    };

    expect((await board()).sort()).toEqual([
      "Karol Później: Zarząd",
      "Karol Później: null",
    ]);
  });
});

/** Today's board as a logged out reader is shown it: the unpublished holders
 * too, where an import wrote both the person and the post or a reviewer
 * approved them, and never their party. */
describe("api/edges/successions unpublished holders", () => {
  /** An open post at the company, as the register import writes one. */
  function job(source: string, fields: Record<string, unknown> = {}) {
    return {
      source,
      target: "wodociagi",
      type: "employed",
      name: "Rada Nadzorcza",
      start_date: "2024-04-30",
      published: false,
      ...fields,
    };
  }

  /** The first revision of a document, written by an import or by hand. */
  function firstRevision(
    nodeId: string,
    automatic: boolean,
    time = "2026-01-01",
  ) {
    return { node_id: nodeId, update_time: time, update_automatic: automatic };
  }

  async function board() {
    const { current } = await call<CompanySuccessions>({
      companyId: "wodociagi",
    });
    return current;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reader.signedIn = false;
    nodes = {
      wodociagi: {
        name: "MPWiK Kamienna Góra",
        type: "place",
        published: true,
      },
      ala: {
        name: "Ala Opublikowana",
        type: "person",
        published: true,
        parties: ["PO"],
      },
      bob: {
        name: "Bob Zaimportowany",
        type: "person",
        published: false,
        parties: ["PiS"],
      },
      cyd: {
        name: "Cyd Bez Partii",
        type: "person",
        published: false,
        parties: [],
      },
      dan: {
        name: "Dan Dopisany",
        type: "person",
        published: false,
        parties: ["PSL"],
      },
      eva: {
        name: "Eva Sprawdzona",
        type: "person",
        published: false,
        parties: ["SLD"],
        revision_id: "rev-eva",
      },
      fil: {
        name: "Fil Usunięty",
        type: "person",
        published: false,
        deleted: true,
        parties: ["PO"],
      },
    };
    edges = {
      "e-ala": job("ala", { published: true }),
      "e-bob": job("bob"),
      "e-cyd": job("cyd", { name: "Zarząd" }),
      "e-dan": job("dan"),
      "e-eva": job("eva", { revision_id: "rev-e-eva" }),
      "e-fil": job("fil"),
    };
    revisions = {
      r1: firstRevision("bob", true),
      r2: firstRevision("e-bob", true),
      r3: firstRevision("cyd", true),
      r4: firstRevision("e-cyd", true),
      // Proposed by hand, and only later touched by an import: the first
      // revision is what says who put the person here.
      r5: firstRevision("dan", false, "2026-01-01"),
      r6: firstRevision("dan", true, "2026-03-01"),
      r7: firstRevision("e-dan", true),
      r8: firstRevision("fil", true),
      r9: firstRevision("e-fil", true),
    };
  });

  it("lists the holders an import or a reviewer stands behind", async () => {
    const names = (await board()).map((post) => post.personName).sort();

    expect(names).toEqual([
      "Ala Opublikowana",
      "Bob Zaimportowany",
      "Cyd Bez Partii",
      "Eva Sprawdzona",
    ]);
  });

  it("says an unpublished holder has a party, and never which", async () => {
    const current = await board();
    const bob = current.find((post) => post.personId === "bob");
    const cyd = current.find((post) => post.personId === "cyd");
    const ala = current.find((post) => post.personId === "ala");

    expect(bob).toMatchObject({
      parties: [],
      partyHidden: true,
      published: false,
    });
    expect(cyd?.partyHidden).toBeUndefined();
    expect(cyd?.published).toBe(false);
    expect(ala).toMatchObject({ parties: ["PO"], published: true });
    expect(ala?.partyHidden).toBeUndefined();
    // Not anywhere in the answer, under any field.
    const answer = JSON.stringify(current);
    expect(answer).not.toContain("PiS");
    expect(answer).not.toContain("SLD");
  });

  it("leaves out a person or a post somebody added by hand", async () => {
    nodes.eva = { ...nodes.eva, revision_id: undefined };
    revisions.r10 = firstRevision("eva", true);
    edges["e-eva"] = job("eva");
    revisions.r11 = firstRevision("e-eva", false);

    const names = (await board()).map((post) => post.personName);

    expect(names).not.toContain("Dan Dopisany");
    expect(names).not.toContain("Eva Sprawdzona");
  });

  it("leaves out a removed page and a post that ended", async () => {
    edges["e-cyd"] = job("cyd", { end_date: "2025-12-31" });

    const names = (await board()).map((post) => post.personName);

    expect(names).not.toContain("Fil Usunięty");
    expect(names).not.toContain("Cyd Bez Partii");
  });

  it("asks nothing about the provenance of published holders", async () => {
    nodes = { wodociagi: nodes.wodociagi!, ala: nodes.ala! };
    edges = { "e-ala": job("ala", { published: true }) };

    await board();

    expect(mockDb.collection).not.toHaveBeenCalledWith("revisions");
  });

  it("shows a signed in reader every holder with the party", async () => {
    reader.signedIn = true;

    const current = await board();
    const bob = current.find((post) => post.personId === "bob");

    expect(bob).toMatchObject({ parties: ["PiS"], published: false });
    expect(bob?.partyHidden).toBeUndefined();
    expect(current.map((post) => post.personName)).toContain("Dan Dopisany");
  });
});
