import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { buildStructuralFilterOps } from "~~/server/utils/nodeFilters";

const queryValidator = z.object({
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
});

export type ProgressStats = {
  /** People matching the structural filters, regardless of status. */
  total: number;
  /** Published (approved) people. */
  approved: number;
  /** Not published yet, but already looked at: voted on, annotated or with a
   * pending revision. */
  reviewed: number;
  /** Not published and untouched by the community. */
  toCheck: number;
  /** People with a proposed change awaiting approval. */
  pendingRevisions: number;
  /** People at least one human voted on. */
  withVotes: number;
  /** People with at least one note. */
  withNotes: number;
};

/** Aggregate tagging-progress counts for the people matching the current
 * table filters. Status filters (visibility, hideVoted) are deliberately not
 * accepted: the response breaks people down by exactly those statuses.
 *
 * The response does not depend on the requesting user, so it is cached
 * briefly and shared.
 */
export default defineCachedEventHandler(
  async (event): Promise<ProgressStats> => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore("koryta-pl");

    const zero: ProgressStats = {
      total: 0,
      approved: 0,
      reviewed: 0,
      toCheck: 0,
      pendingRevisions: 0,
      withVotes: 0,
      withNotes: 0,
    };

    const { ops, empty } = await buildStructuralFilterOps(
      db,
      { ...query, type: "person" },
      "all",
    );
    if (empty) return zero;

    // Fetch all people once and filter in memory: the counts need several
    // overlapping predicates, and the in-memory ops never hit missing-index
    // or multiple-array-filter limits of Firestore queries.
    const snapshot = await db
      .collection("nodes")
      .where("type", "==", "person")
      .select("type", "parties", "stats", "revisions")
      .get();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodes: any[] = snapshot.docs.map((doc) => doc.data());
    for (const op of ops) {
      nodes = op.applyMem(nodes);
    }

    const stats = { ...zero, total: nodes.length };
    for (const node of nodes) {
      const isApproved = node.stats?.isApproved === true;
      // const hasPending = node.revisions?.has_unapproved === true;
      const hasVotes = node.stats?.votes?.humanVoted === true;
      const hasNotes = (node.stats?.notesCount ?? 0) > 0;

      if (isApproved) stats.approved++;
      else if (hasVotes || hasNotes) stats.reviewed++;
      else stats.toCheck++;

      // if (hasPending) stats.pendingRevisions++;
      if (hasVotes) stats.withVotes++;
      if (hasNotes) stats.withNotes++;
    }

    return stats;
  },
  { maxAge: 300, swr: true },
);
