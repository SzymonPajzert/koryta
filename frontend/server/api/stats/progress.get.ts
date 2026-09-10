import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { buildStructuralFilterOps } from "~~/server/utils/nodeFilters";
import {
  combineProgressCounts,
  scanProgress,
  zeroProgress,
  type ProgressStats,
} from "~~/server/utils/progressStats";

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
});

// Re-exported because the components fetching this endpoint import the type
// from it - see app/composables/stats/useStats.ts. The definition, and the
// arithmetic behind every one of these numbers, lives in
// server/utils/progressStats.ts.
export type { ProgressStats };

/** What the counters below read, on top of whatever the filters ask for. */
const COUNTER_FIELDS = [
  "stats.isApproved",
  "stats.votes.humanVoted",
  "stats.notesCount",
];

/** The same six counters, without reading a single person document.
 *
 * Only correct when nothing but `type == person` narrows the set, because
 * every predicate here has to be one Firestore can answer - which is why the
 * filtered path below still scans.
 *
 * An aggregation is billed one read per 1,000 index entries it scans, so a
 * `count()` over 9,302 people costs ten reads rather than 9,302. Four of them
 * plus one projected read of the people who carry a note - 444 notes exist in
 * the whole database, so that is a few hundred documents - answers the lot for
 * around 40 reads. The scan this replaces was 38% of every Firestore read the
 * site made.
 *
 * Every predicate is positive on purpose. `stats.isApproved` is absent on any
 * person no revision has written since the trigger in functions/src/nodes.ts
 * started maintaining it, and a Firestore equality filter does not match a
 * document that lacks the field - see `nodeOwnedFields` in
 * server/utils/revisions.ts, which exists because of that. So the unapproved
 * side of each counter is derived by subtraction from a total, never asked for
 * with `== false`.
 *
 * Returns null when Firestore has no index for one of the queries, which is
 * what the caller falls back to the scan for: firestore.indexes.json is
 * deployed by hand, so this file can be live before the indexes it needs are.
 */
async function countProgress(
  db: FirebaseFirestore.Firestore,
): Promise<ProgressStats | null> {
  const people = db.collection("nodes").where("type", "==", "person");

  try {
    const [total, approved, voted, votedApproved, noted] = await Promise.all([
      people.count().get(),
      people.where("stats.isApproved", "==", true).count().get(),
      people.where("stats.votes.humanVoted", "==", true).count().get(),
      people
        .where("stats.votes.humanVoted", "==", true)
        .where("stats.isApproved", "==", true)
        .count()
        .get(),
      // Read as documents rather than counted, because the three counters a
      // note contributes to - withNotes, and whether its person is already
      // approved or already voted on - would otherwise be four more
      // aggregations and four more composite indexes. There are only a few
      // hundred of these documents.
      people
        .where("stats.notesCount", ">", 0)
        .select("stats.isApproved", "stats.votes.humanVoted")
        .get(),
    ]);

    return combineProgressCounts({
      total: total.data().count,
      approved: approved.data().count,
      voted: voted.data().count,
      votedAndApproved: votedApproved.data().count,
      noted: noted.docs.map((doc) => ({
        isApproved: doc.get("stats.isApproved") === true,
        humanVoted: doc.get("stats.votes.humanVoted") === true,
      })),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 9) {
      console.warn(
        "[stats/progress] falling back to the scan - a composite index this " +
          "needs is not deployed yet:",
        (error as Error).message,
      );
      return null;
    }
    throw error;
  }
}

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

    const { ops, fields, empty } = await buildStructuralFilterOps(
      db,
      { ...query, type: "person" },
      "all",
    );
    if (empty) return zeroProgress;

    // Nothing but the type op, i.e. no filters at all - which is where the
    // reads were. `countProgress` answers it without reading a person.
    if (ops.length === 1) {
      const counted = await countProgress(db);
      if (counted) return counted;
    }

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

    return scanProgress(nodes);
  },
  { maxAge: 300, swr: true },
);
