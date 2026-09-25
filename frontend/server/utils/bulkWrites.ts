import type {
  DocumentData,
  DocumentReference,
  Firestore,
  WithFieldValue,
} from "firebase-admin/firestore";

/** A `BulkWriter` that says whether its writes went through.
 *
 * Firestore's own does not. `close()` resolves whatever happened: each write's
 * outcome is only on the promise `set()`/`delete()` returned, and one nobody
 * holds surfaces as nothing but an unhandled rejection in the server log - a
 * route would answer 200 over a write that failed, and whoever called it would
 * go on as if it had not. So every promise is caught the moment it is queued
 * (a handler attached any later and Node has already reported it unhandled)
 * and counted when the writer closes.
 *
 * Not `onWriteError`, which would replace BulkWriter's own retries of the
 * errors worth retrying. */
export interface SettledBulkWriter {
  set(ref: DocumentReference, data: WithFieldValue<DocumentData>): void;
  delete(ref: DocumentReference): void;
  /** Flushes, and counts: `done` writes, and one message per failed one. */
  close(): Promise<{ done: number; failed: string[] }>;
}

export function settledBulkWriter(db: Firestore): SettledBulkWriter {
  const writer = db.bulkWriter();
  const outcomes: Promise<string | null>[] = [];
  const track = (write: Promise<unknown>) => {
    outcomes.push(
      write.then(
        () => null,
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      ),
    );
  };
  return {
    set: (ref, data) => track(writer.set(ref, data)),
    delete: (ref) => track(writer.delete(ref)),
    close: async () => {
      await writer.close();
      const results = await Promise.all(outcomes);
      const failed = results.filter(
        (result): result is string => result !== null,
      );
      return { done: results.length - failed.length, failed };
    },
  };
}

/** A 500 saying how many writes failed and why the first did, when any did -
 * which tells a caller that retries on anything but a 200 to retry. */
export function throwIfFailed(failed: string[], what: string): void {
  if (!failed.length) return;
  throw createError({
    statusCode: 500,
    message: `${failed.length} ${what}: ${failed[0]}`,
  });
}
