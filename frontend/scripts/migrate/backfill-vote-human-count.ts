import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeVoteStats } from "../../shared/stats";
import type { VoteDocument } from "../../shared/model";

/**
 * One-time migration: put `stats.votes.humanCount` on the nodes people voted on.
 *
 * `computeVoteStats` now records how many people voted on a node, not just
 * whether anybody did — the total sums human verdicts and takes the best model,
 * so a 4 is four models agreeing or one reader insisting and the number alone
 * cannot say which. The `onVoteWritten` trigger will write the new field from
 * each node's next vote onwards, which for most of them is never: a node picks
 * up a human vote once and then sits there.
 *
 * RUN THIS AFTER DEPLOYING FUNCTIONS, not before. Nothing in CI deploys them,
 * so until `firebase deploy --only functions` has gone out the trigger in
 * production is still the old build - and the next vote on a node recomputes
 * `stats.votes` without `humanCount`, quietly undoing this for that node.
 * Backfilling first is not harmful, only wasted on whichever nodes get voted
 * on in between.
 *
 * So this recomputes the aggregate for every node that has votes at all. It is
 * a recompute rather than a patch because `computeVoteStats` is the only thing
 * that should decide what the aggregate holds — writing just the one field here
 * would be a second implementation to keep in step with the first.
 *
 * Nodes nobody voted on are skipped rather than given a zero. `humanCount` is
 * absent-means-nobody by design (see `NodeStats`), and `VoteBreakdown` falls
 * back to the older `humanVoted` for aggregates written before this ran, so a
 * missed node degrades to the sentence it showed before rather than to a wrong
 * count.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-vote-human-count.ts            # dry run
 *   npx tsx scripts/migrate/backfill-vote-human-count.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-vote-human-count.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

async function backfill() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // Every vote that targets a node, grouped by node. `orderBy` skips the
  // extraction votes, which never set this field — the same trick
  // backfill-extraction-vote-stats.ts uses in reverse.
  const votesByNode = new Map<string, VoteDocument[]>();
  const votesSnap = await db.collection("votes").orderBy("nodeId").get();
  for (const doc of votesSnap.docs) {
    const vote = doc.data() as VoteDocument;
    if (!vote.nodeId) continue;
    const existing = votesByNode.get(vote.nodeId);
    if (existing) existing.push(vote);
    else votesByNode.set(vote.nodeId, [vote]);
  }
  console.log(
    `Loaded ${votesSnap.docs.length} node vote(s) across ${votesByNode.size} node(s).`,
  );

  let batch = db.batch();
  let pending = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  // Read the nodes in chunks rather than one at a time: this touches every node
  // anybody or any model has ever voted on, which is thousands, and a sequential
  // `get()` each would be thousands of round trips.
  const nodeIds = [...votesByNode.keys()];
  const CHUNK = 300;
  for (let i = 0; i < nodeIds.length; i += CHUNK) {
    const chunk = nodeIds.slice(i, i + CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection("nodes").doc(id)),
      { fieldMask: ["stats.votes"] },
    );

    for (const snap of snaps) {
      if (!snap.exists) {
        // A vote outliving the node it targeted. Not this script's problem —
        // scripts/migrate/delete-untargeted-votes.ts is.
        missing++;
        continue;
      }

      const current = snap.data()?.stats?.votes;
      const voteStats = computeVoteStats(votesByNode.get(snap.id) ?? []);

      // Rewriting an identical aggregate costs a write and changes nothing.
      // This doubles as a repair tool for nodes the trigger missed, so a second
      // run should be free.
      if (sameVoteStats(current, voteStats)) {
        unchanged++;
        continue;
      }
      updated++;

      if (commit) {
        batch.update(snap.ref, { "stats.votes": voteStats });
        pending++;
        if (pending >= 400) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    `${commit ? "Updated" : "Would update"} ${updated} node(s); ` +
      `${unchanged} already correct; ${missing} node(s) voted on but no longer present.`,
  );
}

/** Whether the stored aggregate already says what a recompute would.
 *
 * A shallow `!==` is not enough here, which is the difference from the helper
 * of the same name in backfill-extraction-vote-stats.ts: a node's aggregate
 * carries `models`, an object, so comparing by reference would report every
 * node as changed and make a second run cost a full rewrite of the graph.
 */
function sameVoteStats(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown>,
): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (
      left &&
      right &&
      typeof left === "object" &&
      typeof right === "object" &&
      JSON.stringify(sortedEntries(left)) ===
        JSON.stringify(sortedEntries(right))
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/** An object's entries in a stable order, so two maps that differ only in the
 * order firestore handed them back compare equal. */
function sortedEntries(value: object): [string, unknown][] {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
