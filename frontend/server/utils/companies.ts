import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { resolveMergedNode } from "./merge";

/** Whether a page is out of use: removed by an approved removal, or merged
 * into another one. Both keep their document - `deleted: true`, and for a
 * merge `merged_into` - so a query on any field they still carry finds them. */
export function isRetiredPage(data: Record<string, unknown>): boolean {
  if (data.deleted === true) return true;
  return typeof data.merged_into === "string" && data.merged_into !== "";
}

/** The company page a KRS number names, or undefined when the site has none.
 *
 * Every server-side lookup of a company by its number goes through here: the
 * company ingest, for the company itself and for each owner it names, and the
 * person ingest, for each employer. They used to ask
 * `where("krsNumber", "==", krs).limit(1)`, which hands back whichever page
 * Firestore reaches first - and a removed or merged-away page keeps its
 * `krsNumber`, so that could be a page no reader can see while the one they
 * do see sits next to it. An ingest landing there writes the register onto a
 * tombstone and leaves the page people actually read stale.
 *
 * So, in order:
 *
 * 1. The first page with this number that is still in use. Firestore orders an
 *    equality query by document id, so where nothing is retired this is the
 *    page `limit(1)` returned, and an ingest goes on writing where it wrote.
 *    Two live pages for one number - „Therma” (0000081135) and Centrum Rozwoju
 *    Komunalnego (0000013874) on 2026-10-09 - still resolve to the first of
 *    them; that is for a merge to settle, not a lookup.
 * 2. Failing that, the page a merged-away one points at, through
 *    `resolveMergedNode`: the number belongs to the page the admin kept, even
 *    where the survivor does not carry it yet.
 * 3. Failing that, the first page with the number however retired, which is
 *    what `limit(1)` gave. A company whose only page somebody removed is still
 *    a number the site knows: answering nothing would have the company ingest
 *    make it a fresh, published page - and `CompaniesPayloads` re-sends every
 *    number the export holds, removed ones included - undoing the removal the
 *    next night. Written to as before, the page stays hidden (`pageIsPublic`
 *    reads `deleted`, and the write carries it).
 *
 * `isRetiredPage` on the answer tells a caller which case it got.
 *
 * Not `limit(1)` any more, since the live page may sit behind a retired one.
 * No number has more than two pages, so reading all of them costs what the
 * single read did.
 */
export async function lookupCompanyByKrs(
  db: Firestore,
  krs: string,
): Promise<DocumentSnapshot | undefined> {
  const snapshot = await db
    .collection("nodes")
    .where("krsNumber", "==", krs)
    .get();

  const live = snapshot.docs.find((doc) => !isRetiredPage(doc.data()));
  if (live) return live;

  for (const doc of snapshot.docs) {
    const next = doc.data().merged_into;
    if (typeof next !== "string" || !next) continue;
    const { snapshot: survivor } = await resolveMergedNode(db, next);
    if (survivor?.exists && !isRetiredPage(survivor.data() ?? {})) {
      return survivor;
    }
  }
  return snapshot.docs[0];
}
