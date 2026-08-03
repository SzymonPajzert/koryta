import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: give every note a `createdAt` of its own.
 *
 * Notes carried no timestamp until recently, so /admin/notatki dated them by
 * `doc.updateTime` when the field was missing. Triaging a source is a write to
 * the note document, so that fallback moved a note's date to the moment an
 * admin last touched it: the review queue re-sorted itself as it was reviewed,
 * and the oldest untouched reports drifted to the top the instant anyone
 * marked one resolved.
 *
 * This backfills `createdAt` from the document's creation time, which no write
 * can move, and the fallback is gone from `getNoteRows` in
 * server/utils/notes.ts - so a note the migration has not reached now reads as
 * undated rather than as reviewed-today. `useNotes` in
 * app/composables/notes.ts sets the field on new notes.
 *
 * `createTime` rather than `updateTime` deliberately: for any note an admin has
 * already triaged, `updateTime` is the triage and not the writing, and there is
 * no way to tell those apart after the fact. The creation time is the one
 * honest date left on the document.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-note-timestamps.ts            # dry run
 *   npx tsx scripts/migrate/backfill-note-timestamps.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-note-timestamps.ts --prod --commit
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

  const notesSnap = await db.collection("notes").get();
  console.log(`Scanning ${notesSnap.docs.length} note documents.`);

  let batch = db.batch();
  let pending = 0;
  let backfilled = 0;
  let alreadyDated = 0;

  for (const doc of notesSnap.docs) {
    const data = doc.data();

    // Idempotent: a note that already has the field is left alone, so a second
    // run reports nothing to do.
    if (typeof data.createdAt === "string" && data.createdAt) {
      alreadyDated++;
      continue;
    }

    backfilled++;
    if (commit) {
      // Always set on a stored document, so there is nothing to fall back to
      // and nothing to skip.
      batch.update(doc.ref, {
        createdAt: doc.createTime.toDate().toISOString(),
      });
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
    `${commit ? "Backfilled" : "Would backfill"} createdAt on ${backfilled} ` +
      `note(s); ${alreadyDated} already had one.`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
