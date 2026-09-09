import type { Company, Person } from "~~/shared/model";

/** Every node an edge in `edges` touches, in one round trip per 100 ids.
 *
 * `resolveEdgeEndpoints` answers the same question for the publish dialog, but
 * only in terms of name and published-or-not. A card also needs the person's
 * parties and their stored stats, and the company's ownership, so this keeps
 * the whole document.
 *
 * Written for /api/edges/recentEmployments and pulled out here when
 * /api/edges/anniversaries turned out to want exactly the same thing: both
 * scan `edges` and then have to name both ends of what they kept. Nothing in
 * the module is imported at runtime - the two names above are types - so a
 * suite that fakes `firebase-admin/firestore` for one of those handlers keeps
 * working without knowing this exists.
 */
export async function fetchEdgeEndpointNodes(
  db: FirebaseFirestore.Firestore,
  edges: { source?: string; target?: string }[],
  /** Which fields to read back, for a caller that wants thousands of these.
   *
   * The read count is the same either way - Firestore bills a document, not a
   * field - so this is about what ends up in memory. /api/edges/serviceMilestones
   * has to fetch every node the published employments touch and then holds the
   * result in nitro's in-memory cache, and a node document carries `activity`,
   * `categories` and a `stats` block none of that needs.
   *
   * Omitted by default, which reads the whole document, because that is what
   * /api/edges/recentEmployments did before this argument existed. */
  fieldMask?: string[],
): Promise<Map<string, Person | Company>> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.source) ids.add(edge.source);
    if (edge.target) ids.add(edge.target);
  }

  const nodes = new Map<string, Person | Company>();
  const list = Array.from(ids);
  for (let i = 0; i < list.length; i += 100) {
    const refs = list
      .slice(i, i + 100)
      .map((id) => db.collection("nodes").doc(id));
    const snaps = await (fieldMask
      ? db.getAll(...refs, { fieldMask })
      : db.getAll(...refs));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      nodes.set(snap.id, { id: snap.id, ...snap.data() } as Person | Company);
    }
  }
  return nodes;
}
