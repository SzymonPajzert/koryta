import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { buildStructuralFilterOps } from "~~/server/utils/nodeFilters";

const queryValidator = z.object({
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  companyTeryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
  hasWikipedia: z.enum(["all", "yes", "no"]).optional(),
});

export type ProgressStats = {
  /** People matching the structural filters, regardless of status. */
  total: number;
  /** Published (approved) people. */
  approved: number;
  /** Not published yet, but already looked at: voted on or annotated.
   *
   * Deliberately not "or has a revision waiting for approval". Every person
   * the scrapers ingest arrives as an unapproved revision, so
   * `revisions.has_unapproved` is set on all 5190 unpublished people and on
   * none of the published ones - counting it would restate `toCheck` under a
   * second name. Only 30 of those 5190 have a hand-written latest revision,
   * and telling them apart costs a read of every one of the revisions. If
   * that number is ever wanted, /api/admin/summary already computes it as
   * `unapprovedManual`. */
  reviewed: number;
  /** Not published and untouched by the community. */
  toCheck: number;
  /** People at least one human voted on. */
  withVotes: number;
  /** People with at least one note. */
  withNotes: number;
};

/** What the counters below read, on top of whatever the filters ask for. */
const COUNTER_FIELDS = [
  "stats.isApproved",
  "stats.votes.humanVoted",
  "stats.notesCount",
];

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
      withVotes: 0,
      withNotes: 0,
    };

    const { ops, fields, empty } = await buildStructuralFilterOps(
      db,
      { ...query, type: "person" },
      "all",
    );
    if (empty) return zero;

    // Fetch all people once and filter in memory: the counts need several
    // overlapping predicates, and the in-memory ops never hit missing-index
    // or multiple-array-filter limits of Firestore queries.
    //
    // Projected down to the leaf fields actually read, because that scan is
    // the whole cost of this endpoint - 6077 documents as of the July 2026
    // export, on every cache miss, for every distinct combination of filters.
    // Asking for the `stats` map whole pulled 4.18 MB; the counters alone are
    // 0.55 MB, and a place filter, which needs the target-id arrays too, 2.0
    // MB. Against the emulator over loopback that was ~600 ms down to ~350;
    // the read count does not change, but the bytes do.
    const snapshot = await db
      .collection("nodes")
      .where("type", "==", "person")
      .select(...new Set([...COUNTER_FIELDS, ...fields]))
      .get();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodes: any[] = snapshot.docs.map((doc) => doc.data());
    for (const op of ops) {
      nodes = op.applyMem(nodes);
    }

    const stats = { ...zero, total: nodes.length };
    for (const node of nodes) {
      const isApproved = node.stats?.isApproved === true;
      const hasVotes = node.stats?.votes?.humanVoted === true;
      const hasNotes = (node.stats?.notesCount ?? 0) > 0;

      if (isApproved) stats.approved++;
      else if (hasVotes || hasNotes) stats.reviewed++;
      else stats.toCheck++;

      if (hasVotes) stats.withVotes++;
      if (hasNotes) stats.withNotes++;
    }

    return stats;
  },
  { maxAge: 300, swr: true },
);
