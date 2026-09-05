import { describe, it, expect, vi } from "vitest";
import { collectActivityEvents } from "../../../server/utils/activityEvents";

// `vi.mock` is hoisted above the import, so the collector picks this up.
// `Timestamp` is only used to convert the window bounds for the revision scan,
// which the fake below ignores.
vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { fromDate: (date: Date) => date },
}));

type Doc = Record<string, unknown>;

/** A Firestore stand-in that answers every query on a collection with the same
 * documents.
 *
 * The date filters are Firestore's job and are not what these tests are about;
 * every fixture below sits inside the window, so the only thing left deciding
 * what comes out is the in-memory filtering in the collector, which is exactly
 * what is under test. */
function fakeDb(
  collections: Record<string, Doc[]>,
  /** Every range bound the collector asks for, so a test can check what type it
   * compared against - which is the whole of the note bug. */
  onWhere?: (collection: string, field: string, value: unknown) => void,
) {
  const query = (name: string, docs: Doc[]) => {
    const snapshot = {
      size: docs.length,
      docs: docs.map((data, index) => ({
        id: `doc-${index}`,
        data: () => data,
        get: (path: string) =>
          path
            .split(".")
            .reduce<unknown>(
              (value, key) => (value == null ? value : (value as Doc)[key]),
              data,
            ),
      })),
    };
    const self: Record<string, unknown> = {
      where: (field: string, _op: string, value: unknown) => {
        onWhere?.(name, field, value);
        return self;
      },
      orderBy: () => self,
      select: () => self,
      limit: () => self,
      get: async () => snapshot,
    };
    return self;
  };

  return {
    collection: (name: string) => query(name, collections[name] ?? []),
  } as never;
}

const AT = "2026-08-20T10:00:00.000Z";
const WINDOW = { sinceIso: "2026-08-01T00:00:00.000Z" };

describe("collectRevisions", () => {
  it("counts a change somebody proposed by hand", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          { update_user: "anna", update_time: AT, data: { type: "person" } },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
  });

  it("drops what the ingest wrote for itself", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          {
            update_user: "uploader",
            update_time: AT,
            update_automatic: true,
            data: { type: "person" },
          },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([]);
  });

  it("keeps counting a revision that predates the flag", async () => {
    // 1,760 revisions in production carry no `update_automatic` at all, and
    // every one of them was written by a person.
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [{ update_user: "anna", update_time: AT }],
      }),
      WINDOW,
    );

    expect(events).toHaveLength(1);
  });

  it("drops the article node every crawl and capture leaves behind", async () => {
    // `ensureArticleNode` writes one of these per page seen, with
    // `update_automatic: false`, because the same endpoint serves the scraper,
    // the extension and somebody pasting a link into /zrodla. None of the three
    // is a proposed change: the revision approves itself in its own commit, so
    // `review_time` is the same instant as `update_time`.
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          {
            update_user: "anna",
            update_time: AT,
            update_automatic: false,
            status: "approved",
            review_time: AT,
            data: { type: "article" },
          },
          {
            update_user: "anna",
            update_time: AT,
            update_automatic: false,
            status: "pending",
            data: { type: "person" },
          },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
  });

  it("drops the article nodes written before the collection had a status", async () => {
    // All 292 in the export of 2026-07-20 carry four fields and nothing else,
    // and every one of them came from the ingest.
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          { update_user: "anna", update_time: AT, data: { type: "article" } },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([]);
  });

  it("keeps an article edit somebody actually proposed", async () => {
    // `article` is a proposableNodeType, so the propose-edit dialog can offer
    // one - and a title somebody corrected by hand is real work. It is waiting
    // for review, so it never approved itself.
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          {
            update_user: "anna",
            update_time: AT,
            update_automatic: false,
            status: "pending",
            data: { type: "article" },
          },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
  });

  it("keeps an article edit an administrator later approved", async () => {
    // Approved in a later request, so `review_time` is a different instant.
    const { events } = await collectActivityEvents(
      fakeDb({
        revisions: [
          {
            update_user: "anna",
            update_time: AT,
            update_automatic: false,
            status: "approved",
            review_time: "2026-08-22T09:00:00.000Z",
            data: { type: "article" },
          },
        ],
      }),
      WINDOW,
    );

    expect(events).toHaveLength(1);
  });
});

describe("collectNoteSources", () => {
  /** What `serverTimestamp()` leaves on a note once Firestore has resolved it. */
  const stamp = (iso: string) => ({ toDate: () => new Date(iso) });

  it("counts a note dated the way `saveNote` dates it now", async () => {
    // `saveNote` stamps `updatedAt` with `serverTimestamp()`, so the field is a
    // Timestamp and not a string. Reading it as a string is what hid every note
    // written since the changeover of about 2026-08-02.
    const { events } = await collectActivityEvents(
      fakeDb({
        notes: [
          { userUid: "anna", updatedAt: stamp(AT), sources: ["a", "b", "c"] },
        ],
      }),
      WINDOW,
    );

    expect(events).toEqual([
      { uid: "anna", at: AT, kind: "noteSource", count: 3 },
    ]);
  });

  it("still counts a note dated the way `saveNote` used to", async () => {
    // The collection holds both: 253 string-dated notes up to 2026-08-01 and
    // 173 timestamp-dated ones after it, in the export of 2026-08-30. A window
    // that straddles the changeover has to see both halves.
    const { events } = await collectActivityEvents(
      fakeDb({
        notes: [{ userUid: "anna", createdAt: AT, sources: ["a"] }],
      }),
      WINDOW,
    );

    expect(events).toEqual([
      { uid: "anna", at: AT, kind: "noteSource", count: 1 },
    ]);
  });

  it("asks for each note field under both types it is stored in", async () => {
    // Firestore orders values by type before value, so one range bound can only
    // ever match one of the two - a string bound skips every timestamp-dated
    // note and vice versa.
    const bounds: unknown[] = [];
    await collectActivityEvents(
      fakeDb({ notes: [] }, (collection, _field, value) => {
        if (collection === "notes") bounds.push(value);
      }),
      { sinceIso: "2026-08-01T00:00:00.000Z", untilIso: AT },
    );

    // Eight: a lower and an upper bound, on each of `createdAt` and
    // `updatedAt`, under each of the two types. `Timestamp.fromDate` is stubbed
    // to return the Date it was handed, so a timestamp bound is a Date here.
    expect(bounds).toHaveLength(8);
    expect(bounds.filter((bound) => bound instanceof Date)).toHaveLength(4);
    expect(bounds.filter((bound) => typeof bound === "string")).toHaveLength(4);
  });

  it("counts a note once even when all four scans return it", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        notes: [
          {
            userUid: "anna",
            createdAt: stamp(AT),
            updatedAt: stamp(AT),
            sources: ["a"],
          },
        ],
      }),
      WINDOW,
    );

    expect(events).toHaveLength(1);
  });

  it("falls back to when the note was written if it was never edited", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        notes: [{ userUid: "anna", createdAt: stamp(AT), sources: ["a"] }],
      }),
      WINDOW,
    );

    expect(events[0]?.at).toBe(AT);
  });

  it("ignores a note holding no sources", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        notes: [{ userUid: "anna", updatedAt: stamp(AT), sources: [] }],
      }),
      WINDOW,
    );

    expect(events).toEqual([]);
  });
});

describe("collectPublications", () => {
  const audit = (docs: Doc[]) =>
    collectActivityEvents(fakeDb({ audit: docs }), WINDOW);

  it("counts a published page", async () => {
    const { events } = await audit([
      { user: "admin", at: AT, action: "publish", collection: "nodes" },
    ]);

    expect(events).toEqual([{ uid: "admin", at: AT, kind: "publication" }]);
  });

  /** Rows written inside one commit, milliseconds apart, the way `recordAudit`
   * stamps them when a batch runs. */
  const inOneCommit = (rows: Doc[]) =>
    rows.map((row, index) => ({
      ...row,
      at: `2026-08-20T10:00:00.${String(index).padStart(3, "0")}Z`,
    }));

  it("counts one publication for a person, not one per relation", async () => {
    // Publishing a person publishes their relations with them, and
    // `publishEdgeInBatch` files an approve *and* a publish per edge. One click
    // used to be twenty-five marks on the chart; it is one now.
    const { events } = await audit([
      { user: "admin", at: AT, action: "publish", collection: "nodes" },
      ...inOneCommit(
        Array.from({ length: 12 }, () => [
          { user: "admin", action: "approve", collection: "edges" },
          { user: "admin", action: "publish", collection: "edges" },
        ]).flat(),
      ),
    ]);

    expect(events).toEqual([{ uid: "admin", at: AT, kind: "publication" }]);
  });

  it("ignores everything an administrator did that was not publishing a page", async () => {
    // Approving, rejecting, hiding and removing are the queue work on the way
    // to a publication rather than the publication, and none of them is counted.
    const { events } = await audit([
      { user: "admin", at: AT, action: "approve", collection: "nodes" },
      { user: "admin", at: AT, action: "reject", collection: "nodes" },
      { user: "admin", at: AT, action: "unpublish", collection: "nodes" },
      { user: "admin", at: AT, action: "delete", collection: "edges" },
      { user: "admin", at: AT, action: "publish", collection: "edges" },
    ]);

    expect(events).toEqual([]);
  });

  it("does not fold two people's work together", async () => {
    const { events } = await audit([
      {
        user: "ala",
        at: AT,
        action: "publish",
        collection: "nodes",
        target_id: "n1",
      },
      {
        user: "bogdan",
        at: AT,
        action: "publish",
        collection: "nodes",
        target_id: "n1",
      },
    ]);

    expect(events.map((e) => e.uid).sort()).toEqual(["ala", "bogdan"]);
  });

  it("keeps two pages published in the same second apart", async () => {
    // The fold is per page as well as per second, so a batch that ever files
    // two rows for one page reads as one decision while two people made public
    // at once stay two.
    const { events } = await audit([
      {
        user: "admin",
        at: AT,
        action: "publish",
        collection: "nodes",
        target_id: "n1",
      },
      {
        user: "admin",
        at: AT,
        action: "publish",
        collection: "nodes",
        target_id: "n2",
      },
      {
        user: "admin",
        at: "2026-08-20T10:00:00.400Z",
        action: "publish",
        collection: "nodes",
        target_id: "n2",
      },
    ]);

    expect(events).toHaveLength(2);
  });
});

describe("collectActivityEvents", () => {
  it("reads every collection that records an interaction", async () => {
    const { events } = await collectActivityEvents(
      fakeDb({
        votes: [
          { userUid: "anna", updatedAt: AT, nodeId: "n1" },
          { userUid: "anna", updatedAt: AT, extractionId: "e1" },
        ],
        notes: [{ userUid: "bob", updatedAt: AT, sources: ["a", "b"] }],
        revisions: [{ update_user: "anna", update_time: AT }],
        audit: [
          { user: "admin", at: AT, action: "publish", collection: "nodes" },
        ],
      }),
      WINDOW,
    );

    // Both vote documents are the same kind: a rating of a person and a rating
    // of an extracted fact are one thing here.
    expect(events.map((event) => event.kind).sort()).toEqual([
      "noteSource",
      "publication",
      "revision",
      "vote",
      "vote",
    ]);

    // A note contributes one unit per source it holds, not one per document.
    expect(events.find((event) => event.kind === "noteSource")?.count).toBe(2);
  });
});
