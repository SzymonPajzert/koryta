import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * One-time migration: give extraction votes their own target field.
 *
 * Historically every vote stored its target under `nodeId`, so votes on
 * extraction facts pointed `nodeId` at an extraction document. That forced
 * readers to guess which collection an id belonged to. This moves those votes
 * to a dedicated `extractionId` field (and clears `nodeId`), leaving node votes
 * untouched — after which every category vote sets exactly one target.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate-vote-target-fields.ts            # dry run
 *   npx tsx scripts/migrate-vote-target-fields.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate-vote-target-fields.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // Which ids are extractions. `select()` fetches only document refs.
  const extractionIds = new Set<string>();
  const extractionsSnap = await db.collection("extractions").select().get();
  extractionsSnap.forEach((doc) => extractionIds.add(doc.id));
  console.log(`Loaded ${extractionIds.size} extraction ids.`);

  const votesSnap = await db.collection("votes").get();
  console.log(`Scanning ${votesSnap.docs.length} vote documents.`);

  let batch = db.batch();
  let pending = 0;
  let migrated = 0;

  for (const doc of votesSnap.docs) {
    const data = doc.data();

    // Only category votes that still store their target under nodeId, where
    // that id actually belongs to an extraction. Node votes and already
    // migrated votes are left as-is.
    if (!data.categoryVotes) continue;
    if (data.extractionId) continue;
    if (typeof data.nodeId !== "string" || !extractionIds.has(data.nodeId)) {
      continue;
    }

    migrated++;
    if (commit) {
      batch.update(doc.ref, {
        extractionId: data.nodeId,
        nodeId: FieldValue.delete(),
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
    `${commit ? "Migrated" : "Would migrate"} ${migrated} extraction vote(s) ` +
      `from nodeId to extractionId.`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
