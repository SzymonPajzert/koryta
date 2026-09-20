import { getFirestore } from "firebase-admin/firestore";
import { queueTiers, type QueueTier } from "~~/shared/queueTiers";

/** One difficulty tier, as /pomoc renders it. */
export type QueueTierStat = {
  tier: QueueTier;
  /** Unpublished people filed under this tier, or null where the count could
   * not be taken - see the handler. Never 0 where the answer is unknown: the
   * card drops the number rather than printing „Do sprawdzenia: 0”, which is
   * the one number that would talk a reader out of the task. */
  toCheck: number | null;
  /** A few people already published off this tier, so a reader can see what a
   * finished page looks like before starting one. */
  examples: { id: string; name: string }[];
};

export type QueueTierStats = { tiers: QueueTierStat[] };

/** How many examples to offer per tier. Three: enough that one being an odd
 * case does not misrepresent the tier, few enough to sit on one line. */
const EXAMPLES = 3;

/** How many unpublished people are in each difficulty tier, and a few
 * published examples of each.
 *
 * Counted rather than scanned. An aggregation is billed one read per 1,000
 * index entries it scans, so all six counts here cost a few dozen reads
 * against the 10,261 people they describe - the arithmetic that made
 * /api/stats/progress stop scanning, for the same reason.
 *
 * `stats.queueTier` is written by /api/stats/computeNodes and by nothing else,
 * so these numbers are as old as its last run. That is the right staleness for
 * what they are used for: a backlog of a thousand people does not change
 * meaningfully between two runs, and a reader is being told which task to pick
 * rather than what is left this minute.
 */
export default defineCachedEventHandler(
  async (): Promise<QueueTierStats> => {
    const db = getFirestore("koryta-pl");
    const people = db.collection("nodes").where("type", "==", "person");

    const tiers = await Promise.all(
      queueTiers.map(async (tier): Promise<QueueTierStat> => {
        const inTier = people.where("stats.queueTier", "==", tier);
        try {
          const [toCheck, examples] = await Promise.all([
            inTier.where("published", "==", false).count().get(),
            inTier
              .where("published", "==", true)
              .select("name")
              .limit(EXAMPLES)
              .get(),
          ]);
          return {
            tier,
            toCheck: toCheck.data().count,
            examples: examples.docs.map((doc) => ({
              id: doc.id,
              name: (doc.get("name") as string | undefined) ?? "",
            })),
          };
        } catch (error) {
          // firestore.indexes.json is deployed by hand, so this file can be
          // live before the index it needs is - and a person whose tier
          // nothing has computed yet carries no `stats.queueTier` at all,
          // which no filter matches. Both answer "unknown", which the card
          // renders as no number rather than as none left to do.
          if ((error as { code?: number }).code === 9) {
            console.warn(
              "[stats/queueTiers] no index for tier %d yet: %s",
              tier,
              (error as Error).message,
            );
            return { tier, toCheck: null, examples: [] };
          }
          throw error;
        }
      }),
    );

    return { tiers };
  },
  { maxAge: 300, swr: true },
);
