import { z } from "zod";
import {
  getFirestore,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { describeRevisions } from "~~/server/utils/revisionQueue";
import {
  emptyProposalCounts,
  matchesStoredStatus,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(["pending", "approved", "rejected", "all"]).default("all"),
  /** Narrow the record to one entry, for the card that entry's own page shows.
   * Applied in memory rather than as a `where`, because a filter on the target
   * alongside the uid equality and the ordering would want a composite index
   * for what is already a capped scan. */
  nodeId: z.string().optional(),
});

/** How far back one person's own record is read. The largest human revision
 * count in production is 94 and the whole human corpus is 1,814 across ten
 * uids, so this covers every real contributor with room to spare while capping
 * what a pipeline account could pull by opening its profile. */
export const MINE_SCAN_CAP = 300;

export type MyProposals = {
  revisions: Proposal[];
  /** The status-filtered set, which is what paging walks through. */
  total: number;
  /** Over everything scanned, before the status filter and before the page
   * slice, so the chips do not move while the reader pages. */
  counts: ProposalCounts;
  truncated: boolean;
};

/**
 * What the signed-in user proposed, and what came of it.
 *
 * With `?nodeId=` it answers the same question about one entry, which is what
 * the card on that entry's page asks: a contributor who is shown no trace of
 * the change they just proposed proposes it again.
 *
 * The uid comes from the verified token and there is no parameter for it, so
 * this cannot be turned into a way to read somebody else's record. Authors are
 * not resolved: the caller is the author, and the reviewing side is `redakcja`
 * here as it is in the notification emails - a contributor does not learn which
 * individual turned them down.
 *
 * `update_automatic !== true` is applied in memory rather than as a `where`,
 * for the same reason `/api/revisions/queue` does it on its per-author path:
 * 1,760 revisions carry no flag at all, and those are exactly the older history
 * a person's own record has to include. One scan on the composite index
 * `(update_user, update_time)`, which already exists.
 */
export default defineEventHandler(async (event): Promise<MyProposals> => {
  const user = await getUser(event);
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  setResponseHeader(event, "Cache-Control", "private, no-store");

  const snapshot = await db
    .collection("revisions")
    .where("update_user", "==", user.uid)
    .orderBy("update_time", "desc")
    .limit(MINE_SCAN_CAP)
    .get();

  const mine = snapshot.docs
    .filter((doc) => doc.get("update_automatic") !== true)
    .filter((doc) => !query.nodeId || revisionNodeId(doc) === query.nodeId);

  const described = await describeRevisions(db, mine, { withAuthors: false });

  const counts = described.reduce<ProposalCounts>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, emptyProposalCounts());

  const matching = described.filter((row) =>
    matchesStoredStatus(row.status, query.status),
  );
  const offset = (query.page - 1) * query.limit;

  return {
    revisions: matching.slice(offset, offset + query.limit),
    total: matching.length,
    counts,
    truncated: snapshot.size >= MINE_SCAN_CAP,
  };
});

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
