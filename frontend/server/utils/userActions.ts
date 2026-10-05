import type {
  Firestore,
  Transaction,
  WriteBatch,
} from "firebase-admin/firestore";
import { userCollections, type UserActionDoc } from "~~/shared/userAdmin";

/** Adds one line to the history of an account (`userActions`).
 *
 * Written in the same batch or transaction as the change it describes, so a
 * nomination, a takedown or a dismissed request cannot land without the line
 * that says who did it and why - the reason `recordAudit` takes a batch too.
 * `at` is stamped here, from the server's clock.
 */
export function recordUserAction(
  db: Firestore,
  action: Omit<UserActionDoc, "at">,
  writer: WriteBatch | Transaction,
): string {
  const ref = db.collection(userCollections.userActions).doc();
  const doc: UserActionDoc = { ...action, at: new Date().toISOString() };
  // Firestore refuses `undefined`; an optional field that was not given is
  // left out rather than written as nothing.
  const clean = Object.fromEntries(
    Object.entries(doc as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    ),
  ) as UserActionDoc;
  // Both have the same `set`; the cast only spares TypeScript a union of
  // overloads it cannot call.
  (writer as WriteBatch).set(ref, clean);
  return ref.id;
}
