import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: delete votes that are about nothing.
 *
 * A vote has to name what it is about, in `nodeId` or `extractionId`. 299 do
 * neither, so nothing can aggregate them: `onVoteWritten` logs a warning and
 * returns, `computeNodeStats` skips a vote with no `nodeId`, and the
 * backfill's `orderBy("extractionId")` cannot see them. They are counted by
 * nobody and displayed by nobody.
 *
 * Nearly all of them are the pre-2025 vote format — `scores` keyed by user and
 * a `reference.external_id` that resolves to no document in the database any
 * more. The remaining three are ordinary category votes whose `nodeId` was
 * written as an empty string.
 *
 * They are not harmful, only dead: /api/stats/votes reads the collection whole
 * and hands all of them to the browser, and `computeNodes` reads it whole on
 * every recompute. Deleting them is the cheapest way to stop paying for
 * documents no reader will ever use.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/delete-untargeted-votes.ts            # dry run
 *   npx tsx scripts/migrate/delete-untargeted-votes.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/delete-untargeted-votes.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: adminProjectFromEnv() });

async function migrate() {
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const snapshot = await db.collection("votes").get();
  console.log(`Scanning ${snapshot.docs.length} votes.`);

  const doomed: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let legacyFormat = 0;
  let emptyTarget = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Falsy rather than absent: three of them store an empty string.
    if (data.nodeId || data.extractionId) continue;

    doomed.push(doc);
    if (data.categoryVotes) emptyTarget++;
    else legacyFormat++;
  }

  console.log(
    `  ${doomed.length} untargeted: ${legacyFormat} in the pre-2025 format, ` +
      `${emptyTarget} category vote(s) with an empty target.`,
  );

  if (commit) {
    let batch = db.batch();
    let pending = 0;
    for (const doc of doomed) {
      batch.delete(doc.ref);
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  }

  console.log(
    `${commit ? "Deleted" : "Would delete"} ${doomed.length} vote(s).`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
