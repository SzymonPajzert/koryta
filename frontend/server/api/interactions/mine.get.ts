import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { logger } from "firebase-functions/logger";
import { getUser } from "~~/server/utils/auth";
import { countProposals, scanMyProposals } from "~~/server/utils/myProposals";
import {
  nameVotes,
  scanMyVotes,
  type MyVote,
  type ScannedVote,
} from "~~/server/utils/myVotes";
import {
  matchesStoredStatus,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  page: z.coerce.number().int().min(1).default(1),
  /** A chip on the card: the votes, or the proposals in one stored state. */
  filter: z
    .enum(["all", "votes", "pending", "approved", "rejected"])
    .default("all"),
});

export type InteractionFilter = z.infer<typeof queryValidator>["filter"];

export type Interaction =
  | { kind: "proposal"; at: string; proposal: Proposal }
  | { kind: "vote"; at: string; vote: MyVote };

export type InteractionCounts = ProposalCounts & { votes: number };

export type MyInteractions = {
  items: Interaction[];
  /** The filtered set, which is what paging walks through. */
  total: number;
  /** Over everything scanned, before the filter and before the page slice, so
   * the chips do not move while the reader pages. */
  counts: InteractionCounts;
  /** Which of the two scans stopped at its cap, so older ones are missing. */
  truncated: { proposals: boolean; votes: boolean };
  /** The votes could not be read, so the list is the proposals alone. */
  votesFailed?: true;
};

type Scanned =
  | { kind: "proposal"; at: string; proposal: Proposal }
  | { kind: "vote"; at: string; vote: ScannedVote };

/**
 * What the signed-in user did on the site, newest first: the changes they
 * proposed, and the people they voted on. The card on /profil.
 *
 * Both are read whole, up to their caps, and paged in memory, as the proposals
 * alone were: the chips count everything and the filters page through their
 * own matches. Names are read for the votes on the page only.
 *
 * The uid comes from the verified token and there is no parameter for it, so
 * this cannot be pointed at somebody else's record.
 */
export default defineEventHandler(async (event): Promise<MyInteractions> => {
  const user = await getUser(event);
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  setResponseHeader(event, "Cache-Control", "private, no-store");

  // The votes need a composite index that is deployed by hand. Without it
  // the card still has the proposals to show, so a failed read of the votes
  // is logged and reported rather than taking the proposals down with it.
  const [mine, voted] = await Promise.all([
    scanMyProposals(db, user.uid),
    scanMyVotes(db, user.uid).catch((error: unknown) => {
      logger.error("[api/interactions/mine] could not read the votes", {
        uid: user.uid,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ]);

  const proposals: Scanned[] = mine.proposals.map((proposal) => ({
    kind: "proposal",
    at: proposal.updateTime ?? "",
    proposal,
  }));
  const votes: Scanned[] = (voted?.votes ?? []).map((vote) => ({
    kind: "vote",
    at: vote.updatedAt,
    vote,
  }));

  const filter = query.filter;
  const matching =
    filter === "votes"
      ? votes
      : filter === "all"
        ? [...proposals, ...votes].sort((a, b) => time(b.at) - time(a.at))
        : proposals.filter(
            (row) =>
              row.kind === "proposal" &&
              matchesStoredStatus(row.proposal.status, filter),
          );

  const offset = (query.page - 1) * query.limit;
  const page = matching.slice(offset, offset + query.limit);
  const named = await nameVotes(
    db,
    page.flatMap((row) => (row.kind === "vote" ? [row.vote] : [])),
  );
  let next = 0;
  const items = page.map((row): Interaction =>
    row.kind === "vote" ? { ...row, vote: named[next++]! } : row,
  );

  return {
    items,
    total: matching.length,
    counts: { ...countProposals(mine.proposals), votes: votes.length },
    truncated: { proposals: mine.truncated, votes: !!voted?.truncated },
    ...(voted ? {} : { votesFailed: true as const }),
  };
});

/** An instant as a number, so the two lists can be merged; a revision stored
 * with no readable time goes to the end. */
function time(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}
