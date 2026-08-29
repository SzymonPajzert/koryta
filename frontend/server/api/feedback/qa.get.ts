import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import type { Feedback, QaAdminResolution } from "~~/shared/model";

/** How many of the caller's own reports are read back.
 *
 * A cap rather than the whole history because the query is paid for on every
 * /qa load: the answer only ever needs the newest report per changelog entry,
 * and somebody who has filed more than this many reports has long since
 * stopped caring what happened to the oldest. Measured against prod, the
 * busiest reporter has 24.
 */
const MAX_REPORTS = 200;

/** What admins did with the caller's OWN reports from /qa, keyed by changelog
 * entry.
 *
 * This route exists because there is otherwise no way for a reporter to learn
 * the fate of their own report. `feedback` is shut to the client SDK outright
 * (`firestore.rules`: `allow read, write: if false`), and the only route over
 * the collection, `/api/feedback/list`, is admin-only - so /qa read nothing but
 * the reader's own `qaChecks` document and kept showing an entry as broken long
 * after the team had closed the report about it.
 *
 * Scoped to `user.uid` and nothing else, deliberately and without a query
 * parameter to widen it: this is the one place an admin decision is handed to a
 * non-admin, and the queue behind it must not become readable through a route
 * every signed-in reader may call. For the same reason `adminNote` is never
 * returned - it is where the team writes to itself during triage, and
 * forwarding it would turn an internal jotting into a reply nobody wrote.
 */
export default defineEventHandler(async (event) => {
  // 401 without a token rather than an empty answer: /qa is behind the auth
  // middleware and `authRequest` always attaches one, so a missing token means
  // something is wrong, not that there is nothing to say.
  const user = await getUser(event);

  const db = getFirestore("koryta-pl");
  const snapshot = await db
    .collection("feedback")
    .where("userUid", "==", user.uid)
    .orderBy("createdAt", "desc")
    .limit(MAX_REPORTS)
    .get();

  const resolutions: Record<string, QaAdminResolution> = {};
  for (const doc of snapshot.docs) {
    // Partial rather than `as Feedback`: the collection is two years of
    // documents written by three different versions of the intake, and the
    // type describes what the newest one writes. Nothing here is worth a 500
    // over a field an old report never had.
    const data = doc.data() as Partial<Feedback>;
    const itemId = data.context?.qa?.itemId;
    // Reports written through the "Zgłoś" button carry no changelog entry;
    // they belong to /admin/opinie and to nothing on this page. A document
    // with no `createdAt` cannot come back from the query above at all - the
    // check is here to keep the loose cast honest rather than to guard.
    if (!itemId || !data.createdAt) continue;
    // Newest wins, and the walk is already newest-first. That is what makes
    // re-reporting self-clearing: "nadal nie działa" files a fresh document
    // with `adminStatus: "new"`, which from the next load on outranks the
    // closure it argues with.
    if (resolutions[itemId]) continue;
    resolutions[itemId] = {
      itemId,
      // Documents predating the admin queue carry no status; they were never
      // triaged, which is what "new" says.
      status: data.adminStatus ?? "new",
      reportedAt: data.createdAt,
    };
  }

  return { resolutions };
});
