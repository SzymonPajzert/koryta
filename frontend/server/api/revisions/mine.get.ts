import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  countProposals,
  MINE_SCAN_CAP,
  scanMyProposals,
} from "~~/server/utils/myProposals";
import {
  matchesStoredStatus,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

export { MINE_SCAN_CAP };

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
 * What the signed-in user proposed, and what came of it, for one entry: the
 * card that entry's own page shows (`?nodeId=`). A contributor who is shown no
 * trace of the change they just proposed proposes it again. /profil reads the
 * whole record through `/api/interactions/mine`, beside the votes.
 *
 * The uid comes from the verified token and there is no parameter for it, so
 * this cannot be turned into a way to read somebody else's record. Authors are
 * not resolved: the caller is the author, and the reviewing side is `redakcja`
 * here as it is in the notification emails - a contributor does not learn which
 * individual turned them down.
 */
export default defineEventHandler(async (event): Promise<MyProposals> => {
  const user = await getUser(event);
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  setResponseHeader(event, "Cache-Control", "private, no-store");

  const { proposals, truncated } = await scanMyProposals(
    db,
    user.uid,
    query.nodeId,
  );

  const matching = proposals.filter((row) =>
    matchesStoredStatus(row.status, query.status),
  );
  const offset = (query.page - 1) * query.limit;

  return {
    revisions: matching.slice(offset, offset + query.limit),
    total: matching.length,
    counts: countProposals(proposals),
    truncated,
  };
});
