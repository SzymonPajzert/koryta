import { describe, it, expect, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { importedOrReviewed } from "../../../server/utils/provenance";

/** Revisions by the document they are about, oldest first. */
let revisions: Record<string, Record<string, unknown>[]> = {};
/** The documents whose history was read. */
let asked: string[] = [];

const db = {
  collection: (name: string) => {
    expect(name).toBe("revisions");
    let nodeId = "";
    let direction = "";
    const query = {
      where: (field: string, op: string, value: string) => {
        expect([field, op]).toEqual(["node_id", "=="]);
        nodeId = value;
        asked.push(value);
        return query;
      },
      orderBy: (field: string, dir: string) => {
        expect(field).toBe("update_time");
        direction = dir;
        return query;
      },
      limit: () => query,
      get: async () => {
        // The oldest only when asked for it that way.
        expect(direction).toBe("asc");
        return {
          docs: (revisions[nodeId] ?? [])
            .slice(0, 1)
            .map((data) => ({ data: () => data })),
        };
      },
    };
    return query;
  },
} as unknown as Firestore;

describe("importedOrReviewed", () => {
  beforeEach(() => {
    revisions = {};
    asked = [];
  });

  it("takes a document an import wrote first", async () => {
    revisions = {
      imported: [
        { update_automatic: true },
        // A contributor's pending edit since changes nothing about who wrote
        // the document.
        { update_automatic: false, status: "pending" },
      ],
    };
    expect(await importedOrReviewed(db, [{ id: "imported" }])).toEqual(
      new Set(["imported"]),
    );
  });

  it("refuses a document a contributor created", async () => {
    // A proposed person, or a relation somebody added: written at once,
    // reviewed by nobody.
    revisions = {
      proposed: [{ update_automatic: false, status: "pending" }],
      older: [{ update_user: "uid-of-somebody" }],
    };
    expect(
      await importedOrReviewed(db, [{ id: "proposed" }, { id: "older" }]),
    ).toEqual(new Set());
  });

  it("refuses a document with no history to answer from", async () => {
    expect(await importedOrReviewed(db, [{ id: "legacy" }])).toEqual(new Set());
  });

  it("takes a reviewed document without reading its history", async () => {
    revisions = { approved: [{ update_automatic: false }] };
    expect(
      await importedOrReviewed(db, [
        { id: "approved", revision_id: "revisions/r1" },
      ]),
    ).toEqual(new Set(["approved"]));
    expect(asked).toEqual([]);
  });

  it("reads each document once", async () => {
    revisions = { a: [{ update_automatic: true }] };
    await importedOrReviewed(db, [{ id: "a" }, { id: "a" }, {}]);
    expect(asked).toEqual(["a"]);
  });
});
