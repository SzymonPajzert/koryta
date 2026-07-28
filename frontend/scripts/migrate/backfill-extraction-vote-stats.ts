import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeVoteStats } from "../../shared/stats";
import type { VoteDocument } from "../../shared/model";

/**
 * One-time migration: give every extraction a `stats.votes` aggregate.
 *
 * The `onVoteWritten` trigger already maintains `stats.votes` on extraction
 * documents, exactly as it does for nodes — but only from the first vote
 * onwards. A fact nobody has voted on carries no `stats` field at all, and
 * Firestore cannot query for an absent field, so `stats.votes.humanVoted ==
 * false` would match nothing rather than matching the backlog. That makes the
 * review flow unable to ask the server for unreviewed facts.
 *
 * This seeds the aggregate on every existing extraction: recomputed from the
 * votes collection where votes exist (which also repairs facts voted on before
 * the trigger covered extractions), and `humanVoted: false` where they don't.
 * New documents are seeded at ingest by /api/ingest/extraction.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/backfill-extraction-vote-stats.ts            # dry run
 *   npx tsx scripts/backfill-extraction-vote-stats.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/backfill-extraction-vote-stats.ts --prod --commit
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

  // Every vote that targets an extraction, grouped by fact. `orderBy` skips the
  // node votes, which never set this field.
  const votesByExtraction = new Map<string, VoteDocument[]>();
  const votesSnap = await db.collection("votes").orderBy("extractionId").get();
  for (const doc of votesSnap.docs) {
    const vote = doc.data() as VoteDocument;
    if (!vote.extractionId) continue;
    const existing = votesByExtraction.get(vote.extractionId);
    if (existing) existing.push(vote);
    else votesByExtraction.set(vote.extractionId, [vote]);
  }
  console.log(
    `Loaded ${votesSnap.docs.length} extraction vote(s) across ` +
      `${votesByExtraction.size} fact(s).`,
  );

  const extractionsSnap = await db.collection("extractions").get();
  console.log(`Scanning ${extractionsSnap.docs.length} extraction(s).`);

  let batch = db.batch();
  let pending = 0;
  let seeded = 0;
  let recomputed = 0;
  let unchanged = 0;

  for (const doc of extractionsSnap.docs) {
    const votes = votesByExtraction.get(doc.id);
    const current = doc.data().stats?.votes;

    // Facts with votes get the real aggregate; the rest only need the field to
    // exist so they are reachable by an equality filter. Already-seeded facts
    // with no votes are left alone.
    let voteStats: Record<string, unknown>;
    if (votes) {
      voteStats = computeVoteStats(votes);
    } else if (current?.humanVoted === undefined) {
      voteStats = { humanVoted: false };
    } else {
      unchanged++;
      continue;
    }

    // Rewriting an identical aggregate costs a write and changes nothing, and
    // this doubles as a repair tool for facts the trigger missed — so a run
    // that finds nothing to fix should be free.
    if (sameVoteStats(current, voteStats)) {
      unchanged++;
      continue;
    }
    if (votes) recomputed++;
    else seeded++;

    if (commit) {
      batch.update(doc.ref, { "stats.votes": voteStats });
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    `${commit ? "Wrote" : "Would write"} stats.votes on ${
      seeded + recomputed
    } extraction(s): ${recomputed} recomputed from votes, ${seeded} seeded ` +
      `as unreviewed. ${unchanged} already up to date.`,
  );
}

/** Shallow compare of two vote aggregates; every value is a primitive. */
function sameVoteStats(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown>,
): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
