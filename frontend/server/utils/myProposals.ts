import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { describeRevisions } from "~~/server/utils/revisionQueue";
import {
  emptyProposalCounts,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

/** How far back one person's own record is read. The largest human revision
 * count in production is 94 and the whole human corpus is 1,814 across ten
 * uids, so this covers every real contributor with room to spare while capping
 * what a pipeline account could pull by opening its profile. */
export const MINE_SCAN_CAP = 300;

/**
 * What one user proposed, newest first, described as the review queue
 * describes it. `nodeId` narrows it to one entry.
 *
 * `update_automatic !== true` is applied in memory rather than as a `where`,
 * for the same reason `/api/revisions/queue` does it on its per-author path:
 * 1,760 revisions carry no flag at all, and those are exactly the older history
 * a person's own record has to include. One scan on the composite index
 * `(update_user, update_time)`, which already exists.
 */
export async function scanMyProposals(
  db: Firestore,
  uid: string,
  nodeId?: string,
): Promise<{ proposals: Proposal[]; truncated: boolean }> {
  const snapshot = await db
    .collection("revisions")
    .where("update_user", "==", uid)
    .orderBy("update_time", "desc")
    .limit(MINE_SCAN_CAP)
    .get();

  const mine = snapshot.docs
    .filter((doc) => doc.get("update_automatic") !== true)
    .filter((doc) => !nodeId || revisionNodeId(doc) === nodeId);

  return {
    proposals: await describeRevisions(db, mine, { withAuthors: false }),
    truncated: snapshot.size >= MINE_SCAN_CAP,
  };
}

/** Proposals by state, for the summary chips. */
export function countProposals(proposals: Proposal[]): ProposalCounts {
  return proposals.reduce<ProposalCounts>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, emptyProposalCounts());
}

/** The target a revision names.
 *
 * Two spellings are in the data - `/api/revisions/byNode` queries both - so a
 * filter that only knew `node_id` would silently drop the older half of
 * somebody's record for an entry.
 */
function revisionNodeId(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): string | undefined {
  const underscore = doc.get("node_id");
  if (typeof underscore === "string") return underscore;
  const camel = doc.get("nodeId");
  return typeof camel === "string" ? camel : undefined;
}
