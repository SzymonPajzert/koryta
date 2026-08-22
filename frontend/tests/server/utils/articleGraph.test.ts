import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { graphForArticles } from "../../../server/utils/articleGraph";

type Doc = Record<string, unknown>;

const { mockFetchNodesByIds, mockFetchEdgesClose } = vi.hoisted(() => ({
  mockFetchNodesByIds: vi.fn(),
  mockFetchEdgesClose: vi.fn(),
}));

vi.mock("~~/server/utils/fetch", () => ({
  fetchNodesByIds: mockFetchNodesByIds,
  fetchEdgesClose: mockFetchEdgesClose,
}));

/** The two query shapes `topics.ts` builds: chained equality filters, plus
 * `in` and `array-contains-any`. Copied in spirit from topics.test.ts. */
function fakeDb(edges: Record<string, Doc>) {
  const matches = (doc: Doc, field: string, op: string, value: unknown) => {
    if (op === "array-contains-any") {
      const held = (doc[field] as string[] | undefined) ?? [];
      return (value as string[]).some((wanted) => held.includes(wanted));
    }
    if (op === "in") return (value as unknown[]).includes(doc[field]);
    return doc[field] === value;
  };

  const build = (filters: [string, string, unknown][]) => ({
    where: (field: string, op: string, value: unknown) =>
      build([...filters, [field, op, value]]),
    get: async () => ({
      docs: Object.entries(edges)
        .filter(([, doc]) =>
          filters.every(([field, op, value]) => matches(doc, field, op, value)),
        )
        .map(([id, doc]) => ({ id, data: () => doc })),
    }),
  });

  return { collection: vi.fn(() => build([])) } as unknown as Firestore;
}

/** The article names one person and one company, and nothing rests on it yet -
 * the state anybody who has just recorded a mention is looking at. */
const mentionEdges = {
  m1: { source: "a1", target: "p1", type: "mentions", published: true },
  m2: { source: "a1", target: "c9", type: "mentions", published: true },
};

const nodes: Record<string, Doc> = {
  p1: { id: "p1", type: "person", name: "Jan Kowalski", visibility: true },
  p2: { id: "p2", type: "person", name: "Anna Nowak", visibility: true },
  c1: { id: "c1", type: "place", name: "Spółka", visibility: true },
  c9: { id: "c9", type: "place", name: "Ministerstwo", visibility: true },
  p3: { id: "p3", type: "person", name: "Urzędnik", visibility: true },
};

/** Jan's own relations, and one the ministry has that nobody should follow. */
const closeEdges = [
  {
    id: "e1",
    source: "p1",
    target: "c1",
    type: "employed",
    visibility: true,
  },
  {
    id: "e2",
    source: "p1",
    target: "p2",
    type: "connection",
    visibility: true,
  },
  {
    id: "e3",
    source: "p3",
    target: "c9",
    type: "employed",
    visibility: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchNodesByIds.mockImplementation(async (ids: string[]) =>
    ids.map((id) => nodes[id]).filter(Boolean),
  );
  // Only the ids actually asked for, so a test can tell whether the ministry
  // was expanded by whether its staff came back.
  mockFetchEdgesClose.mockImplementation(async (ids: string[]) =>
    closeEdges.filter(
      (edge) => ids.includes(edge.source) || ids.includes(edge.target),
    ),
  );
});

describe("graphForArticles", () => {
  it("draws a named person alone when nothing asks for their network", async () => {
    const graph = await graphForArticles(fakeDb(mentionEdges), ["a1"], true);

    expect(Object.keys(graph.nodes).sort()).toEqual(["c9", "p1"]);
    expect(graph.edges).toEqual([]);
    expect(mockFetchEdgesClose).not.toHaveBeenCalled();
  });

  it("draws each named person's immediate connections around them", async () => {
    const graph = await graphForArticles(fakeDb(mentionEdges), ["a1"], true, {
      expandMentions: true,
    });

    // Jan's employer and the person he knows are drawn as context; the
    // article's own people are still there.
    expect(Object.keys(graph.nodes).sort()).toEqual(["c1", "c9", "p1", "p2"]);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(["e1", "e2"]);
  });

  it("does not expand a company the article names", async () => {
    await graphForArticles(fakeDb(mentionEdges), ["a1"], true, {
      expandMentions: true,
    });

    expect(mockFetchEdgesClose).toHaveBeenCalledWith(["p1"]);
  });

  it("leaves out a relation nobody has approved, for a logged out reader", async () => {
    mockFetchEdgesClose.mockResolvedValue([
      { ...closeEdges[0], visibility: false },
    ]);

    const graph = await graphForArticles(fakeDb(mentionEdges), ["a1"], false, {
      expandMentions: true,
    });

    expect(graph.edges).toEqual([]);
    expect(Object.keys(graph.nodes)).not.toContain("c1");
  });
});
