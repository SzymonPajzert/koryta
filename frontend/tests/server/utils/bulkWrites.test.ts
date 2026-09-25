import { describe, expect, it, vi } from "vitest";
import { settledBulkWriter } from "../../../server/utils/bulkWrites";

vi.mock("firebase-admin/firestore", () => ({}));

/** A BulkWriter as Firestore's behaves: each call's own promise carries its
 * outcome, and `close()` resolves whatever they were - here only once every
 * write has settled, failures included. */
function fakeDb(fails: (id: string) => boolean) {
  const pending: Promise<unknown>[] = [];
  const write = (ref: { id: string }) => {
    const outcome = new Promise<void>((resolve, reject) =>
      setTimeout(() =>
        fails(ref.id) ? reject(new Error(`${ref.id} refused`)) : resolve(),
      ),
    );
    pending.push(outcome.catch(() => {}));
    return outcome;
  };
  return {
    bulkWriter: () => ({
      set: write,
      delete: write,
      close: async () => void (await Promise.all(pending)),
    }),
  } as unknown as Parameters<typeof settledBulkWriter>[0];
}

const ref = (id: string) => ({ id }) as never;

describe("settledBulkWriter", () => {
  it("counts the writes that went through and says why the others did not", async () => {
    const writer = settledBulkWriter(fakeDb((id) => id.startsWith("bad")));
    writer.set(ref("good1"), {});
    writer.set(ref("bad1"), {});
    writer.delete(ref("good2"));
    writer.delete(ref("bad2"));

    expect(await writer.close()).toEqual({
      done: 2,
      failed: ["bad1 refused", "bad2 refused"],
    });
  });

  it("closes clean with nothing queued", async () => {
    const writer = settledBulkWriter(fakeDb(() => false));
    expect(await writer.close()).toEqual({ done: 0, failed: [] });
  });
});
