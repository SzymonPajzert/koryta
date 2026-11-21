import type { Firestore } from "firebase-admin/firestore";
import { DECLARATION_ACTOR } from "~~/shared/declarations";

/** A node or an edge, as much of it as `importedOrReviewed` reads. */
type Written = { id?: string; revision_id?: unknown };

/** Which of `docs` say only what an automatic import wrote or a reviewer
 * approved - the unpublished pages and relations a logged out reader may be
 * shown a glimpse of (`shared/personTeaser.ts`).
 *
 * Everything else in the drafts is somebody's say-so. A contributor's change
 * to an existing page or relation is only a pending revision until a reviewer
 * approves it; but proposing a new person writes the person's document at
 * once, and so does adding a relation - unreviewed claims, by anybody with an
 * account, about a named individual. Showing those to the public would let
 * anybody put anybody's name on this site.
 *
 * So a document qualifies when it has an approved revision (`revision_id`),
 * or when its first revision was written by an import - `update_automatic`,
 * which the server sets from how the write was made rather than from anything
 * in the request - other than the declarations automation (see
 * `writtenByImportOrReviewed`). A document with no revisions at all is older
 * than the question can be answered for, and does not.
 *
 * One read per document left to check: the first of its revisions, off the
 * `(node_id, update_time)` index the revision history already uses.
 */
export async function importedOrReviewed(
  db: Firestore,
  docs: readonly Written[],
): Promise<Set<string>> {
  const qualified = new Set<string>();
  const toCheck: string[] = [];
  for (const doc of docs) {
    if (!doc.id) continue;
    if (doc.revision_id) qualified.add(doc.id);
    else toCheck.push(doc.id);
  }

  const firsts = await Promise.all(
    [...new Set(toCheck)].map(async (id) => {
      const snapshot = await db
        .collection("revisions")
        .where("node_id", "==", id)
        .orderBy("update_time", "asc")
        .limit(1)
        .get();
      return { id, first: snapshot.docs[0]?.data() };
    }),
  );
  for (const { id, first } of firsts) {
    if (writtenByImportOrReviewed({ id }, first)) qualified.add(id);
  }
  return qualified;
}

/** The same rule for one document whose first revision is already in hand -
 * the earliest by `update_time` of those whose `node_id` is the document's
 * id, as the query above finds it. /api/stats/computeNodes reads every
 * revision anyway, and asks this of every person and post at once for the
 * line the search box shows under an unpublished person
 * (shared/searchLine.ts).
 *
 * Not a document the declarations automation created: a post readers agreed
 * on is still their reading until a reviewer approves it, or
 * `approveWaitingEdge` does once its page is live. */
export function writtenByImportOrReviewed(
  doc: Written,
  first: { update_automatic?: unknown; update_user?: unknown } | undefined,
): boolean {
  if (doc.revision_id) return true;
  return (
    first?.update_automatic === true && first.update_user !== DECLARATION_ACTOR
  );
}
