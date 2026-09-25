import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Query } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { describeRevisions } from "~~/server/utils/revisionQueue";
import { matchesStoredStatus, type Proposal } from "~~/shared/proposals";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
  /** The three states a revision is *stored* in. `superseded` is not one of
   * them - it is a refinement of `approved` worked out from the target - so it
   * is shown on the chip but is not something to filter by. */
  status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
  /** Booleans travel as an enum: `z.coerce.boolean()` reads the string
   * `"false"` as true, which would silently invert this filter. */
  automatic: z.enum(["true", "false", "all"]).default("false"),
  /** One person's proposals, whatever they are and whenever they were filed.
   * This is the mode the contributor table on /eksploruj/statystyki links to. */
  author: z.string().min(1).optional(),
  /** Everybody's proposals but this person's - in practice the reviewer's own,
   * so what somebody else filed is not buried under their edits. */
  excludeAuthor: z.string().min(1).optional(),
  /** One proposal by id, answered alongside the page and independent of every
   * filter, so a permalink still resolves after the decision is made. */
  revision: z.string().min(1).optional(),
});

/** How many of one person's revisions are read before the answer is a lower
 * bound. The busiest human contributor in production has 94; a pipeline uid has
 * tens of thousands, and this is what stops one from being paged through. */
export const AUTHOR_SCAN_CAP = 500;

export type RevisionQueue = {
  revisions: Proposal[];
  total: number;
  /** The scan hit its cap, so `total` is a lower bound and older proposals are
   * not in the answer. Only the per-author path can report this. */
  truncated: boolean;
  /** The proposal named by `?revision=`, when it is not already on this page. */
  pinned: Proposal | null;
  /** True when the answer could only include revisions carrying an explicit
   * `update_automatic` flag, i.e. the ones filed since it started being
   * written. See the note on the two query paths below. */
  flagOnly: boolean;
};

/**
 * The review queue: one row per proposal, newest first, human work by default.
 *
 * ## Why there are two query paths
 *
 * `update_automatic` was written *only when true* until this change, so the
 * collection is in three states rather than two: in the 2026-08-21 export,
 * 42,730 revisions say `true`, 54 say `false`, and 1,760 say nothing at all. A
 * Firestore equality matches none of that third group, and there is no filter
 * for "field is absent".
 *
 * That forces a split:
 *
 * - **Without an author**, the query is `update_automatic == false`. It is
 *   exact and cheap - it reads none of the 42,730 - and it covers every
 *   proposal filed through the propose-a-change dialog since review shipped,
 *   which is the backlog an admin actually works through. It cannot see the
 *   older flagless ones, and the page says so (`flagOnly`) rather than
 *   presenting a partial list as the whole of the history.
 * - **With an author**, the query is `update_user == uid` on the composite
 *   index that already exists, and `update_automatic !== true` is applied in
 *   memory. That sees everything the person ever proposed, flag or no flag -
 *   which is the point of a per-person view, and why the contributor table
 *   links to this mode rather than to the aggregate one.
 *
 * `excludeAuthor` is a clause of the query on the first path, not a filter
 * over its answer: dropping one person's rows from a page Firestore already
 * cut would leave short pages and a total that counts them anyway. On the
 * second it is applied in memory with the rest, which it can only empty.
 *
 * Backfilling the flag was considered and rejected. The uid that wrote 1,447 of
 * the 1,760 flagless revisions is both the owner's admin account and the
 * account the pipeline runs as, so nothing stored on the document tells an old
 * pipeline write from an old human one. Guessing would fill the queue with
 * thousands of rows nobody proposed, which is the failure this page exists to
 * fix, one level up.
 */
export default defineEventHandler(async (event): Promise<RevisionQueue> => {
  const caller = await getUser(event);
  if (!caller.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  // Uids, emails and display names. Never cached, never shared - the same
  // reasoning /api/stats/activity applies to its identified branch.
  setResponseHeader(event, "Cache-Control", "private, no-store");

  const page = query.author
    ? await byAuthor(db, query)
    : await byFilter(db, query);

  return {
    ...page,
    pinned: query.revision
      ? await onePinned(db, query.revision, page.revisions)
      : null,
  };
});

type QueryOptions = z.infer<typeof queryValidator>;

/** One person's proposals, read whole and filtered in memory.
 *
 * No `status` clause in Firestore on purpose: the revisions that carry no
 * status are precisely the history a per-person view exists to show, and an
 * equality would match none of them.
 */
async function byAuthor(
  db: Firestore,
  query: QueryOptions,
): Promise<Omit<RevisionQueue, "pinned">> {
  const snapshot = await db
    .collection("revisions")
    .where("update_user", "==", query.author!)
    .orderBy("update_time", "desc")
    .limit(AUTHOR_SCAN_CAP)
    .get();

  const docs = snapshot.docs.filter(
    (doc) =>
      matchesAutomatic(doc, query) &&
      doc.get("update_user") !== query.excludeAuthor,
  );

  // Status is resolved against the target, which needs the join, so the whole
  // scanned set is described before it can be filtered on status. The cap is
  // what keeps that bounded: describing 500 rows is two `getAll` calls.
  const described = await describeRevisions(db, docs, { withAuthors: true });
  const matching = described.filter((row) =>
    matchesStoredStatus(row.status, query.status),
  );

  const offset = (query.page - 1) * query.limit;
  return {
    revisions: matching.slice(offset, offset + query.limit),
    total: matching.length,
    truncated: snapshot.size >= AUTHOR_SCAN_CAP,
    flagOnly: false,
  };
}

/** The aggregate queue: an exact Firestore query, paged by Firestore.
 *
 * Every revision this path can match carries an explicit `update_automatic`,
 * and every one of those also carries a `status` - the two fields were written
 * by the same code paths - so filtering on the stored status here is exact
 * rather than an approximation.
 */
async function byFilter(
  db: Firestore,
  query: QueryOptions,
): Promise<Omit<RevisionQueue, "pinned">> {
  let base: Query = db.collection("revisions");
  if (query.automatic !== "all") {
    base = base.where("update_automatic", "==", query.automatic === "true");
  }
  if (query.status !== "all") {
    base = base.where("status", "==", query.status);
  }
  // An inequality ordered by another field, which Firestore serves from an
  // index with `update_user` after `update_time` - one per combination of the
  // clauses above, in firestore.indexes.json. It also leaves out the few
  // revisions written before `update_user` was, which name nobody to review.
  if (query.excludeAuthor) {
    base = base.where("update_user", "!=", query.excludeAuthor);
  }

  const ordered = base.orderBy("update_time", "desc");
  const offset = (query.page - 1) * query.limit;

  const [snapshot, count] = await Promise.all([
    ordered.offset(offset).limit(query.limit).get(),
    ordered.count().get(),
  ]);

  return {
    revisions: await describeRevisions(db, snapshot.docs, {
      withAuthors: true,
    }),
    total: count.data().count,
    truncated: false,
    flagOnly: query.automatic !== "all",
  };
}

/** The permalinked proposal, when it is not already on the page. */
async function onePinned(
  db: Firestore,
  revisionId: string,
  onPage: Proposal[],
): Promise<Proposal | null> {
  if (onPage.some((row) => row.id === revisionId)) return null;
  const snapshot = await db.collection("revisions").doc(revisionId).get();
  if (!snapshot.exists) return null;
  const [described] = await describeRevisions(db, [snapshot], {
    withAuthors: true,
  });
  return described ?? null;
}

function matchesAutomatic(
  doc: { get(field: string): unknown },
  query: QueryOptions,
): boolean {
  if (query.automatic === "all") return true;
  const automatic = doc.get("update_automatic") === true;
  return automatic === (query.automatic === "true");
}
