import { describe, it, expect, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  isRetiredPage,
  lookupCompanyByKrs,
} from "../../../server/utils/companies";

// `server/utils/merge` pulls in `server/utils/revisions`, which reaches for
// `Timestamp` and `FieldValue` at import time; nothing here reads either back.
vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ toMillis: () => 0 }) },
  FieldValue: { delete: () => "<delete>" },
}));

/** A `nodes` collection answering the two reads the lookup makes: an equality
 * query, in document id order as Firestore returns one, and a read by id. */
function nodeDb(nodes: Record<string, Record<string, unknown>>) {
  const snapshot = (id: string) => ({
    id,
    ref: { id },
    exists: nodes[id] !== undefined,
    data: () => nodes[id],
  });
  const db = {
    collection: () => ({
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: Object.keys(nodes)
            .sort()
            .filter((id) => nodes[id]![field] === value)
            .map(snapshot),
        }),
      }),
      doc: (id: string) => ({ get: async () => snapshot(id) }),
    }),
  };
  return db as unknown as Firestore;
}

const KRS = "0000081135";

describe("lookupCompanyByKrs", () => {
  it("answers with the one page a number has", async () => {
    const db = nodeDb({ therma: { type: "place", krsNumber: KRS } });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe("therma");
  });

  it("answers nothing for a number the site has never seen", async () => {
    const db = nodeDb({ therma: { type: "place", krsNumber: KRS } });

    expect(await lookupCompanyByKrs(db, "0000000001")).toBeUndefined();
  });

  it("passes over a removed page that sorts first", async () => {
    // `limit(1)` handed back the lowest document id whatever it was, so a page
    // taken down as „duplikat” went on receiving the register's upload while
    // the page readers see was left behind.
    const db = nodeDb({
      A_removed: {
        type: "place",
        krsNumber: KRS,
        deleted: true,
        delete_reason: "duplikat",
      },
      b_live: { type: "place", krsNumber: KRS },
    });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe("b_live");
  });

  it("passes over a merged-away page that still carries the number", async () => {
    const db = nodeDb({
      A_tombstone: {
        type: "place",
        krsNumber: KRS,
        deleted: true,
        merged_into: "b_survivor",
      },
      b_survivor: { type: "place", krsNumber: KRS },
    });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe("b_survivor");
  });

  it("follows a merge to a survivor that does not carry the number", async () => {
    // The number belongs to the page an admin kept, not to the tombstone the
    // upload would otherwise go on writing to out of sight.
    const db = nodeDb({
      tombstone: {
        type: "place",
        krsNumber: KRS,
        deleted: true,
        merged_into: "survivor",
      },
      survivor: { type: "place", name: "Therma" },
    });

    const found = await lookupCompanyByKrs(db, KRS);

    expect(found?.id).toBe("survivor");
    expect(found?.data()).toMatchObject({ name: "Therma" });
  });

  it("follows a chain of merges to the end", async () => {
    const db = nodeDb({
      first: { krsNumber: KRS, deleted: true, merged_into: "second" },
      second: { deleted: true, merged_into: "third" },
      third: { type: "place" },
    });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe("third");
  });

  it("stays with a removed page when it is the only one with the number", async () => {
    // Answering nothing would have the company ingest make the company a
    // fresh, published page - and `CompaniesPayloads` re-sends removed numbers
    // too - so a removal would be undone the next night.
    const db = nodeDb({
      removed: { type: "place", krsNumber: KRS, deleted: true },
    });

    const found = await lookupCompanyByKrs(db, KRS);

    expect(found?.id).toBe("removed");
    expect(isRetiredPage(found!.data()!)).toBe(true);
  });

  it("stays with the tombstone when the merge leads to a page since removed", async () => {
    const db = nodeDb({
      tombstone: { krsNumber: KRS, deleted: true, merged_into: "survivor" },
      survivor: { type: "place", deleted: true },
    });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe("tombstone");
  });

  it("keeps the first of two live pages, which is where an ingest already writes", async () => {
    // „Therma” on 2026-10-09: the hand-made BnTvgqabfOXJFyuzFi8t sorts before
    // the uploaded v9eUDB9lGr62mj4r4Trq, and the 08-29 company ingest renamed
    // it. Moving the uploads to the other page now would only spread what they
    // write across both; the pair is for a merge to settle.
    const db = nodeDb({
      v9eUDB9lGr62mj4r4Trq: { type: "place", krsNumber: KRS, published: true },
      BnTvgqabfOXJFyuzFi8t: { type: "place", krsNumber: KRS, published: true },
    });

    expect((await lookupCompanyByKrs(db, KRS))?.id).toBe(
      "BnTvgqabfOXJFyuzFi8t",
    );
  });
});

describe("isRetiredPage", () => {
  it("reads both ways a page leaves the site", () => {
    expect(isRetiredPage({ deleted: true })).toBe(true);
    expect(isRetiredPage({ merged_into: "survivor" })).toBe(true);
    expect(isRetiredPage({ deleted: false, merged_into: "" })).toBe(false);
    expect(isRetiredPage({})).toBe(false);
  });
});
