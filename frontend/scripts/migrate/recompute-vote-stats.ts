import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeVoteStats } from "../../shared/stats";
import type { VoteDocument } from "../../shared/model";

/**
 * Recompute `stats.votes` on every node anybody or any model has voted on.
 *
 * Run this whenever `computeVoteStats` changes what the aggregate means. The
 * `onVoteWritten` trigger writes the new shape from each node's *next* vote
 * onwards, which for most nodes is never - a person picks up a vote once and
 * then sits there - so without this the graph holds two generations of the
 * number at the same time, and `/eksploruj/nowe` sorts on the mixture.
 *
 * What prompted it: the pipeline's contribution stopped being the maximum
 * across models and became the mean over the models that spoke, with
 * `MODELS_OUT_OF_THE_AVERAGE` held back. Nothing recomputes that on its own,
 * and until this has run the ordering of the queue is neither the old rule nor
 * the new one.
 *
 * RUN IT AFTER DEPLOYING FUNCTIONS, not before. Nothing in CI deploys them, so
 * until `firebase deploy --only functions` has gone out the trigger in
 * production is still the old build, and the next vote on a node recomputes
 * `stats.votes` with the old rule - quietly undoing this for that node.
 * Running it first is not harmful, only wasted on whichever nodes are voted on
 * in between.
 *
 * It recomputes rather than patching the fields that changed, because
 * `computeVoteStats` is the only thing that should decide what the aggregate
 * holds; writing individual fields here would be a second implementation to
 * keep in step with the first. Idempotent: a node whose stored aggregate
 * already matches is skipped, so a second run costs reads and no writes, and
 * it doubles as a repair tool for nodes the trigger missed.
 *
 * `backfill-vote-human-count.ts` is the single-purpose ancestor of this script
 * and does the same recompute; this one exists because the operator needs to
 * know which change they are propagating, and that one names a field that is
 * no longer the reason to run it.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/recompute-vote-stats.ts            # dry run
 *   npx tsx scripts/migrate/recompute-vote-stats.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/recompute-vote-stats.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

async function recompute() {
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

recompute()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
