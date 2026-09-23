import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/admin.post";

const {
  mockGetUser,
  mockDocGet,
  mockUpdate,
  mockCollection,
  mockDoc,
  mockBatch,
  mockBatchUpdate,
  mockBatchCommit,
  mockGetFirestore,
  DELETE_FIELD,
} = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);

  return {
    mockGetUser: vi.fn(),
    mockDocGet: vi.fn(),
    mockUpdate: vi.fn(),
    mockCollection: vi.fn(),
    mockDoc: vi.fn(),
    mockBatch: vi.fn(),
    mockBatchUpdate: vi.fn(),
    mockBatchCommit: vi.fn(),
    mockGetFirestore: vi.fn(),
    // What `FieldValue.delete()` hands back. A unique object rather than a
    // string, so no rank or note could ever be mistaken for it.
    DELETE_FIELD: { __fieldValue: "delete" },
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
  FieldValue: { delete: () => DELETE_FIELD },
}));

const callHandler = (body: Record<string, unknown>) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ body });

/** The patch the handler handed to `update`. */
const written = () => mockUpdate.mock.calls.at(-1)?.[0];

/** Every `batch.update`, as [document id, patch], in the order it was made. */
const batched = () =>
  mockBatchUpdate.mock.calls.map(([ref, patch]) => [
    (ref as { id: string }).id,
    patch,
  ]);

describe("POST /api/feedback/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValue(undefined);
    mockDoc.mockImplementation((id: string) => ({
      id,
      get: mockDocGet,
      update: mockUpdate,
    }));
    mockCollection.mockImplementation(() => ({ doc: mockDoc }));
    mockBatchCommit.mockResolvedValue(undefined);
    mockBatch.mockImplementation(() => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    }));
    mockGetFirestore.mockImplementation(() => ({
      collection: mockCollection,
      batch: mockBatch,
    }));
  });

  describe("who may triage", () => {
    it("rejects callers without the admin claim", async () => {
      mockGetUser.mockResolvedValue({ uid: "user-1" });

      await expect(
        callHandler({ id: "fb-1", queueRank: 5 }),
      ).rejects.toMatchObject({ statusCode: 403 });
      // Refused before anything is read, let alone written.
      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("rejects a stray newAdmin claim without admin", async () => {
      // A trial that ended by dropping `admin` can leave `newAdmin` behind; on
      // its own it grants nothing.
      mockGetUser.mockResolvedValue({ uid: "ex-trial", newAdmin: true });

      await expect(
        callHandler({ id: "fb-1", adminStatus: "resolved" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("lets an administrator on trial work the queue", async () => {
      // Trial admins carry `newAdmin` alongside `admin`. They see less of the
      // activity feed, but the feedback queue is theirs to work like anyone's.
      mockGetUser.mockResolvedValue({
        uid: "trial-1",
        admin: true,
        newAdmin: true,
      });

      await expect(callHandler({ id: "fb-1", queueRank: 5 })).resolves.toEqual({
        ok: true,
      });
      expect(written()).toEqual({ queueRank: 5 });
    });

    it("passes an authentication failure through untouched", async () => {
      mockGetUser.mockRejectedValue(
        Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
      );

      await expect(
        callHandler({ id: "fb-1", queueRank: 5 }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("queueRank", () => {
    it("writes exactly the rank it was sent", async () => {
      const result = await callHandler({ id: "fb-1", queueRank: 5 });

      expect(result).toEqual({ ok: true });
      expect(mockGetFirestore).toHaveBeenCalledWith("koryta-pl");
      expect(mockCollection).toHaveBeenCalledWith("feedback");
      expect(mockDoc).toHaveBeenCalledWith("fb-1");
      // Nothing but the rank: a status or note somebody else set in the
      // meantime must survive the move.
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(written()).toEqual({ queueRank: 5 });
    });

    it("deletes the field when the rank is null", async () => {
      await callHandler({ id: "fb-1", queueRank: null });

      // Taking a report out of the queue removes the field rather than storing
      // null, so "absent" stays the one way to say "not queued".
      expect(written()).toEqual({ queueRank: DELETE_FIELD });
    });

    // Ranks are midpoints between neighbours, so a report dropped above the
    // first one goes below zero and one dropped between two lands on a
    // fraction.
    it.each([0, -1, -3, 0.5, -0.25, 1.5 * 1024, 1e-9, -1e12])(
      "accepts the rank %s",
      async (queueRank) => {
        await callHandler({ id: "fb-1", queueRank });

        expect(written()).toEqual({ queueRank });
      },
    );

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["a numeric string", "5"],
      ["an empty string", ""],
      ["a boolean", true],
      ["an object", { value: 5 }],
    ])("refuses %s as a rank", async (_label, queueRank) => {
      // A rank that does not compare like a number would scramble the order
      // of every report around it.
      await expect(callHandler({ id: "fb-1", queueRank })).rejects.toThrow();

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("writes the rank and the status together when both are sent", async () => {
      await callHandler({
        id: "fb-1",
        adminStatus: "in_progress",
        queueRank: 2,
      });

      expect(written()).toEqual({ adminStatus: "in_progress", queueRank: 2 });
    });

    it("leaves the rank alone on a status change", async () => {
      await callHandler({ id: "fb-1", adminStatus: "resolved" });

      // Closing a report must not pull it out of (or put it into) the queue;
      // the page decides that separately.
      expect(written()).toEqual({ adminStatus: "resolved" });
      expect(written()).not.toHaveProperty("queueRank");
    });

    it("leaves the rank alone on a note change", async () => {
      await callHandler({ id: "fb-1", adminNote: "sprawdzić w KRS" });

      expect(written()).toEqual({ adminNote: "sprawdzić w KRS" });
      expect(written()).not.toHaveProperty("queueRank");
    });
  });

  describe("the report", () => {
    it("404s on a report that is not there", async () => {
      mockDocGet.mockResolvedValue({ exists: false, data: () => undefined });

      await expect(
        callHandler({ id: "fb-gone", queueRank: 5 }),
      ).rejects.toMatchObject({ statusCode: 404 });
      // `update` on a missing doc would throw NOT_FOUND from Firestore as a
      // 500; the handler answers first.
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("refuses a body without an id", async () => {
      await expect(callHandler({ queueRank: 5 })).rejects.toThrow();
      await expect(callHandler({ id: "", queueRank: 5 })).rejects.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("does not write at all when nothing was sent", async () => {
      const result = await callHandler({ id: "fb-1" });

      expect(result).toEqual({ ok: true });
      // Firestore refuses an empty `update` outright ("At least one field
      // must be updated"), so a bare id has to stop short of it.
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("refuses a status it does not know", async () => {
      await expect(
        callHandler({ id: "fb-1", adminStatus: "done" }),
      ).rejects.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("renumber", () => {
    // What the page sends when a report is dropped where the neighbours have
    // no gap left: the move plus the rest of the queue spaced out again.
    const spacedOut = [
      { id: "fb-2", queueRank: 1024 },
      { id: "fb-3", queueRank: 2048 },
      { id: "fb-4", queueRank: 3072 },
    ];

    it("writes the move and every renumbered report in one batch", async () => {
      const result = await callHandler({
        id: "fb-1",
        queueRank: 1536,
        renumber: spacedOut,
      });

      expect(result).toEqual({ ok: true });
      expect(mockBatch).toHaveBeenCalledTimes(1);
      expect(batched()).toEqual([
        ["fb-2", { queueRank: 1024 }],
        ["fb-3", { queueRank: 2048 }],
        ["fb-4", { queueRank: 3072 }],
        ["fb-1", { queueRank: 1536 }],
      ]);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      // A separate write of the move could land without the renumbering, or
      // the other way round, and leave the queue half renumbered.
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("puts a status sent along into the batched write of the report", async () => {
      await callHandler({
        id: "fb-1",
        adminStatus: "in_progress",
        queueRank: 1536,
        renumber: spacedOut,
      });

      expect(batched()).toContainEqual([
        "fb-1",
        { adminStatus: "in_progress", queueRank: 1536 },
      ]);
      // One write for the report, not one per field.
      expect(batched().filter(([id]) => id === "fb-1")).toHaveLength(1);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("falls back to a plain update when renumber is empty", async () => {
      await callHandler({ id: "fb-1", queueRank: 1536, renumber: [] });

      expect(mockBatch).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(written()).toEqual({ queueRank: 1536 });
    });

    it.each([
      ["a NaN rank", { id: "fb-2", queueRank: Number.NaN }],
      ["an Infinity rank", { id: "fb-2", queueRank: Number.POSITIVE_INFINITY }],
      ["a -Infinity rank", { id: "fb-2", queueRank: Number.NEGATIVE_INFINITY }],
      ["a string rank", { id: "fb-2", queueRank: "1024" }],
      ["a null rank", { id: "fb-2", queueRank: null }],
      ["a missing rank", { id: "fb-2" }],
      ["an empty id", { id: "", queueRank: 1024 }],
      ["a missing id", { queueRank: 1024 }],
    ])("refuses an entry with %s", async (_label, entry) => {
      await expect(
        callHandler({
          id: "fb-1",
          queueRank: 1536,
          renumber: [spacedOut[0], entry],
        }),
      ).rejects.toThrow();

      // Refused as a whole - not even the valid entry or the move is written.
      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockBatch).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `fb-r${i}`,
        queueRank: (i + 1) * 1024,
      }));

    it("takes a whole open queue of 500", async () => {
      await callHandler({ id: "fb-1", queueRank: 512, renumber: entries(500) });

      expect(mockBatchUpdate).toHaveBeenCalledTimes(501);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it("refuses more than 500 entries", async () => {
      await expect(
        callHandler({ id: "fb-1", queueRank: 512, renumber: entries(501) }),
      ).rejects.toThrow();

      expect(mockBatch).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("fails the request when the batch does not commit", async () => {
      // e.g. NOT_FOUND: a renumbered report was deleted in the meantime.
      mockBatchCommit.mockRejectedValue(new Error("5 NOT_FOUND"));

      await expect(
        callHandler({ id: "fb-1", queueRank: 1536, renumber: spacedOut }),
      ).rejects.toThrow("NOT_FOUND");
      // No fallback write of the move alone.
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("404s before batching anything when the report is not there", async () => {
      mockDocGet.mockResolvedValue({ exists: false, data: () => undefined });

      await expect(
        callHandler({ id: "fb-gone", queueRank: 1536, renumber: spacedOut }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mockBatch).not.toHaveBeenCalled();
    });
  });

  describe("adminNote", () => {
    it("stores the note it was sent", async () => {
      await callHandler({ id: "fb-1", adminNote: "duplikat fb-7" });

      expect(written()).toEqual({ adminNote: "duplikat fb-7" });
    });

    it("clears the note with an empty string", async () => {
      await callHandler({ id: "fb-1", adminNote: "" });

      expect(written()).toEqual({ adminNote: "" });
    });

    it("clears the note with null, as an empty string", async () => {
      // Unlike the rank, a cleared note is kept as "" rather than deleted -
      // behaviour from before the queue, which it must not change.
      await callHandler({ id: "fb-1", adminNote: null });

      expect(written()).toEqual({ adminNote: "" });
    });

    it("refuses a note over 2000 characters", async () => {
      await expect(
        callHandler({ id: "fb-1", adminNote: "x".repeat(2001) }),
      ).rejects.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
