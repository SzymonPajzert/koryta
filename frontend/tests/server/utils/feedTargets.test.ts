import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isFeedDocId,
  resetFeedTargetCache,
  resolveFeedTargets,
  unreadFeedTarget,
  type FeedTargetRef,
} from "../../../server/utils/feedTargets";

type Doc = Record<string, unknown>;
type Ref = { collection: string; id: string };

/** A Firestore stand-in holding documents by collection and id.
 *
 * `doc()` throws on an id Firestore would reject, the way the real one does,
 * so a test fails loudly if a bad id ever reaches it. Every `getAll` is logged
 * with the ids it asked for, and `failReads` makes one of them throw. */
function fakeDb(
  seed: Record<string, Record<string, Doc>>,
  failReads?: (collection: string, ids: string[]) => boolean,
) {
  const reads: { collection: string; ids: string[]; fieldMask?: string[] }[] =
    [];
  const queries: { collection: string; wheres: unknown[][] }[] = [];

  const snapshot = (id: string, data: Doc | undefined) => ({
    id,
    exists: data !== undefined,
    data: () => data,
    get: (path: string) =>
      path
        .split(".")
        .reduce<unknown>(
          (value, key) => (value == null ? undefined : (value as Doc)[key]),
          data,
        ),
  });

  const db = {
    collection: (name: string) => {
      const wheres: unknown[][] = [];
      const query = {
        where: (field: string, op: string, value: unknown) => {
          wheres.push([field, op, value]);
          return query;
        },
        orderBy: () => query,
        select: () => query,
        limit: () => query,
        get: async () => {
          queries.push({ collection: name, wheres });
          // Only the proposal fallback queries here: the newest revision of
          // one page, which the fixtures hold at most one of.
          const docs = Object.entries(seed[name] ?? {})
            .filter(([, data]) =>
              wheres.every(
                ([field, , value]) => data[field as string] === value,
              ),
            )
            .map(([id, data]) => snapshot(id, data));
          return { size: docs.length, docs };
        },
        doc: (id: string) => {
          if (!id || id.includes("/")) throw new Error(`bad id ${id}`);
          return { collection: name, id };
        },
      };
      return query;
    },
    getAll: async (...args: unknown[]) => {
      const options = args.pop() as { fieldMask?: string[] };
      const refs = args as Ref[];
      const collection = refs[0]?.collection ?? "";
      const ids = refs.map((ref) => ref.id);
      reads.push({ collection, ids, fieldMask: options.fieldMask });
      if (failReads?.(collection, ids)) throw new Error("unavailable");
      return refs.map((ref) =>
        snapshot(ref.id, seed[ref.collection]?.[ref.id]),
      );
    },
  };
  return { db: db as never, reads, queries };
}

const NODES = {
  p1: { name: "Jan Kowalski", type: "person" },
  p2: { name: "Anna Nowak", type: "person" },
  c1: { name: "PKP SA", type: "place" },
  gone: { name: "Usunięta Osoba", type: "person", deleted: true },
};

beforeEach(() => resetFeedTargetCache());
afterEach(() => vi.useRealTimers());

describe("isFeedDocId", () => {
  it("accepts what Firestore accepts as a document id", () => {
    expect(isFeedDocId("p1")).toBe(true);
    expect(isFeedDocId("proposal_p1_uid_abc")).toBe(true);
    expect(isFeedDocId("_x_")).toBe(true);
  });

  it("rejects what would throw or name something else", () => {
    for (const id of ["", "a/b", ".", "..", "__name__", "x".repeat(1501), 7]) {
      expect(isFeedDocId(id)).toBe(false);
    }
    // 1,500 bytes, not characters: "ł" is two.
    expect(isFeedDocId("ł".repeat(750))).toBe(true);
    expect(isFeedDocId("ł".repeat(751))).toBe(false);
  });
});

describe("resolveFeedTargets", () => {
  it("names a page and links it by its type", async () => {
    const { db } = fakeDb({ nodes: NODES });

    const [person, place] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "p1" },
      { collection: "nodes", id: "c1" },
    ]);

    expect(person).toEqual({
      collection: "nodes",
      id: "p1",
      type: "person",
      name: "Jan Kowalski",
      href: "/osoba/jan-kowalski-p1",
    });
    expect(place?.href).toBe("/instytucja/pkp-sa-c1");
  });

  it("gives a removed page no link", async () => {
    const { db } = fakeDb({ nodes: NODES });

    const [gone] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "gone" },
    ]);

    expect(gone).toMatchObject({ name: "Usunięta Osoba", href: null });
    expect(gone?.deleted).toBe(true);
  });

  it("follows merged_into to the page that survived, hop by hop", async () => {
    const { db } = fakeDb({
      nodes: {
        ...NODES,
        dupA: {
          name: "J. Kowalski",
          type: "person",
          deleted: true,
          merged_into: "dupB",
        },
        dupB: {
          name: "Kowalski Jan",
          type: "person",
          deleted: true,
          merged_into: "p1",
        },
      },
    });

    const [target] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "dupA" },
    ]);

    expect(target).toMatchObject({
      id: "p1",
      name: "Jan Kowalski",
      href: "/osoba/jan-kowalski-p1",
    });
    expect(target?.deleted).toBeUndefined();
  });

  it("stops a merge cycle instead of hanging on it", async () => {
    const { db } = fakeDb({
      nodes: {
        a: { name: "A", type: "person", merged_into: "b" },
        b: { name: "B", type: "person", merged_into: "a" },
      },
    });

    const [target] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "a" },
    ]);

    expect(target?.id).toBe("b");
  });

  it("stays on the last real page when merged_into points at nothing", async () => {
    const { db } = fakeDb({
      nodes: { a: { name: "A", type: "person", merged_into: "missing" } },
    });

    const [target] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "a" },
    ]);

    expect(target?.id).toBe("a");
  });

  it("does not follow a page asked for exactly", async () => {
    const { db } = fakeDb({
      nodes: { ...NODES, p2: { ...NODES.p2, merged_into: "p1" } },
    });

    const [target] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "p2", exact: true },
    ]);

    expect(target?.id).toBe("p2");
  });

  it("names a relation after its two ends and links it to its source", async () => {
    const { db } = fakeDb({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", type: "employed" } },
    });

    const [edge] = await resolveFeedTargets(db, [
      { collection: "edges", id: "e1" },
    ]);

    expect(edge).toEqual({
      collection: "edges",
      id: "e1",
      type: "edge",
      name: "Jan Kowalski → PKP SA",
      href: "/osoba/jan-kowalski-p1",
    });
  });

  it("names a relation by the ends its revision gives", async () => {
    // The stored edge has since been pointed elsewhere; the event is about
    // what the revision said.
    const { db } = fakeDb({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", type: "employed" } },
    });

    const [edge] = await resolveFeedTargets(db, [
      { collection: "edges", id: "e1", ends: { source: "p2", target: "c1" } },
    ]);

    expect(edge?.name).toBe("Anna Nowak → PKP SA");
  });

  it("gives a removed relation no link", async () => {
    const { db } = fakeDb({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", deleted: true } },
    });

    const [edge] = await resolveFeedTargets(db, [
      { collection: "edges", id: "e1" },
    ]);

    expect(edge).toMatchObject({ href: null, deleted: true });
  });

  it("drops a relation whose end cannot be named", async () => {
    const { db } = fakeDb({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "nowhere" } },
    });

    expect(
      await resolveFeedTargets(db, [{ collection: "edges", id: "e1" }]),
    ).toEqual([null]);
  });

  it("names a fact after its person and organisation", async () => {
    const { db } = fakeDb({
      extractions: {
        f1: {
          personNodeName: "Jan Kowalski",
          person: "J. Kowalski",
          organization: "PKP SA",
        },
        f2: { person: "Anna Nowak" },
        f3: { fact_type: "employment" },
      },
    });

    const facts = await resolveFeedTargets(db, [
      { collection: "extractions", id: "f1" },
      { collection: "extractions", id: "f2" },
      { collection: "extractions", id: "f3" },
    ]);

    expect(facts.map((fact) => fact?.name)).toEqual([
      "Jan Kowalski · PKP SA",
      "Anna Nowak",
      "fakt",
    ]);
    expect(facts[0]).toMatchObject({
      type: "fact",
      href: "/ekstrakcje/kategoryzacja?fact=f1",
    });
  });

  it("encodes a fact id into its link", async () => {
    const { db } = fakeDb({ extractions: { "a&b": { person: "X" } } });

    const [fact] = await resolveFeedTargets(db, [
      { collection: "extractions", id: "a&b" },
    ]);

    expect(fact?.href).toBe("/ekstrakcje/kategoryzacja?fact=a%26b");
  });

  it("names a page that exists only as a proposal from its revision", async () => {
    const { db, queries } = fakeDb({ nodes: NODES });

    const [target] = await resolveFeedTargets(db, [
      {
        collection: "nodes",
        id: "new1",
        proposed: { name: "Nowa Osoba", type: "person" },
      },
    ]);

    expect(target).toMatchObject({
      name: "Nowa Osoba",
      href: "/osoba/nowa-osoba-new1",
    });
    expect(queries).toEqual([]);
  });

  it("falls back to the newest revision of a page it has no node for", async () => {
    const { db, queries } = fakeDb({
      nodes: NODES,
      revisions: {
        r1: { node_id: "new1", data: { name: "Nowa Osoba", type: "person" } },
      },
    });

    const [target] = await resolveFeedTargets(db, [
      { collection: "nodes", id: "new1" },
    ]);

    expect(target?.name).toBe("Nowa Osoba");
    expect(queries).toEqual([
      { collection: "revisions", wheres: [["node_id", "==", "new1"]] },
    ]);
  });

  it("drops a target that is neither a page nor a proposal", async () => {
    const { db } = fakeDb({ nodes: NODES });

    expect(
      await resolveFeedTargets(db, [{ collection: "nodes", id: "nothing" }]),
    ).toEqual([null]);
  });

  it("drops an id that cannot name a document without ever building a ref", async () => {
    const { db, reads } = fakeDb({ nodes: NODES });

    const resolved = await resolveFeedTargets(db, [
      { collection: "nodes", id: "a/b" },
      { collection: "nodes", id: "__name__" },
      { collection: "extractions", id: ".." },
      { collection: "nodes", id: "p1" },
    ]);

    expect(resolved.map((target) => target?.id ?? null)).toEqual([
      null,
      null,
      null,
      "p1",
    ]);
    expect(reads.flatMap((read) => read.ids)).toEqual(["p1"]);
  });

  it("drops the targets of a read that failed and keeps the rest", async () => {
    const { db } = fakeDb(
      { nodes: NODES, extractions: { f1: { person: "X" } } },
      (collection) => collection === "extractions",
    );

    const resolved = await resolveFeedTargets(db, [
      { collection: "extractions", id: "f1" },
      { collection: "nodes", id: "p1" },
    ]);

    expect(resolved.map((target) => target?.id ?? null)).toEqual([null, "p1"]);
  });

  it("reads each target once, with a field mask, in chunks of 300", async () => {
    const nodes: Record<string, Doc> = {};
    const refs: FeedTargetRef[] = [];
    for (let i = 0; i < 301; i++) {
      nodes[`n${i}`] = { name: `Osoba ${i}`, type: "person" };
      refs.push(
        { collection: "nodes", id: `n${i}` },
        { collection: "nodes", id: `n${i}` },
      );
    }
    const { db, reads } = fakeDb({ nodes });

    const resolved = await resolveFeedTargets(db, refs);

    expect(resolved.every(Boolean)).toBe(true);
    expect(reads.map((read) => read.ids.length)).toEqual([300, 1]);
    expect(reads[0]?.fieldMask).toEqual([
      "name",
      "type",
      "merged_into",
      "deleted",
    ]);
  });

  it("remembers what it read for an hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
    const { db, reads } = fakeDb({ nodes: NODES });
    const refs: FeedTargetRef[] = [{ collection: "nodes", id: "p1" }];

    await resolveFeedTargets(db, refs);
    vi.setSystemTime(new Date("2026-09-22T10:59:00Z"));
    await resolveFeedTargets(db, refs);
    expect(reads).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-22T11:01:00Z"));
    await resolveFeedTargets(db, refs);
    expect(reads).toHaveLength(2);

    resetFeedTargetCache();
    await resolveFeedTargets(db, refs);
    expect(reads).toHaveLength(3);
  });

  it("does not remember a read that failed", async () => {
    let failing = true;
    const { db, reads } = fakeDb({ nodes: NODES }, () => failing);
    const refs: FeedTargetRef[] = [{ collection: "nodes", id: "p1" }];

    expect(await resolveFeedTargets(db, refs)).toEqual([null]);
    failing = false;
    expect((await resolveFeedTargets(db, refs))[0]?.id).toBe("p1");
    expect(reads).toHaveLength(2);
  });
});

describe("unreadFeedTarget", () => {
  it("types a target by what its reference says, and reads nothing", () => {
    expect(unreadFeedTarget({ collection: "edges", id: "e1" })).toEqual({
      collection: "edges",
      id: "e1",
      type: "edge",
      unread: true,
    });
    expect(unreadFeedTarget({ collection: "extractions", id: "f1" })).toEqual({
      collection: "extractions",
      id: "f1",
      type: "fact",
      unread: true,
    });
    expect(
      unreadFeedTarget({
        collection: "nodes",
        id: "n1",
        proposed: { name: "Nowa Osoba", type: "place" },
      }),
    ).toEqual({ collection: "nodes", id: "n1", type: "place", unread: true });
  });

  it("leaves a page untyped when nothing says what it is", () => {
    // A vote's or a note's page, and a revision whose type is not one.
    for (const ref of [
      { collection: "nodes", id: "n1" },
      { collection: "nodes", id: "n1", proposed: { type: "bogus" } },
    ] satisfies FeedTargetRef[]) {
      expect(unreadFeedTarget(ref)).toEqual({
        collection: "nodes",
        id: "n1",
        unread: true,
      });
    }
  });
});
