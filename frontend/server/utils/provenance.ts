import type { Firestore } from "firebase-admin/firestore";

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
 * in the request. A document with no revisions at all is older than the
 * question can be answered for, and does not.
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
    if (first?.update_automatic === true) qualified.add(id);
  }
  return qualified;
}
