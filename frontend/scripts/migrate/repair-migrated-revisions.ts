import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: make the December 2025 backfill's revisions usable.
 *
 * `data/scrapers/src/scripts/create_revisions.py` minted a revision for every
 * node and edge that did not have one yet, and got two things wrong.
 *
 * It stored `node_id` as a document reference where everything else stores a
 * plain id string. `/api/revisions/byNode` finds a document's history with
 * `where("node_id", "==", nodeId)`, passing a string, and Firestore compares a
 * reference to a string as unequal — so those revisions come back from no query
 * at all. The document's history reads as empty and the change cannot be
 * approved through the UI.
 *
 * And it deleted `source` and `target` from the data before writing
 * (`for removable in ["user", "date", "source", "target"]`), which is harmless
 * for a node and ruinous for an edge: 621 edge revisions describe a link
 * without saying what it links. Those two fields are restored from the edge the
 * revision belongs to, which is where the backfill copied them from.
 *
 * The scraper script is fixed in the same change, so a re-run writes neither
 * defect.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/repair-migrated-revisions.ts            # dry run
 *   npx tsx scripts/migrate/repair-migrated-revisions.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/repair-migrated-revisions.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: adminProjectFromEnv() });

type Reference = FirebaseFirestore.DocumentReference;

/** Whether `node_id` was stored as a reference rather than as an id. */
function isReference(value: unknown): value is Reference {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Reference).id === "string" &&
    typeof (value as Reference).path === "string"
  );
}

async function migrate() {
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // The edges the revisions belong to, for the fields the backfill stripped.
  // One read of the collection beats 621 point reads.
  const edges = new Map<string, FirebaseFirestore.DocumentData>();
  const edgesSnap = await db.collection("edges").get();
  for (const doc of edgesSnap.docs) edges.set(doc.id, doc.data());
  console.log(`Loaded ${edges.size} edges.`);

  const revisionsSnap = await db.collection("revisions").get();
  console.log(`Scanning ${revisionsSnap.docs.length} revisions.`);

  let batch = db.batch();
  let pending = 0;
  let rekeyed = 0;
  let restored = 0;
  let unrestorable = 0;

  for (const doc of revisionsSnap.docs) {
    const data = doc.data();
    if (!isReference(data.node_id)) continue;

    const targetId = data.node_id.id;
    const update: Record<string, unknown> = { node_id: targetId };
    rekeyed++;

    // Only edge revisions lost anything; a node revision never had source or
    // target to begin with.
    const isEdgeRevision = data.node_id.path.startsWith("edges/");
    if (isEdgeRevision) {
      const edge = edges.get(targetId);
      const revisionData = data.data;
      const missing =
        revisionData &&
        typeof revisionData === "object" &&
        (revisionData.source === undefined ||
          revisionData.target === undefined);

      if (missing && edge) {
        update["data.source"] = edge.source;
        update["data.target"] = edge.target;
        restored++;
      } else if (missing) {
        // The edge was deleted after the backfill ran, so there is nowhere left
        // to read the two fields from. The revision is orphaned either way.
        unrestorable++;
      }
    }

    if (commit) {
      batch.update(doc.ref, update);
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
    `${commit ? "Rewrote" : "Would rewrite"} node_id as an id on ${rekeyed} ` +
      `revision(s), and ${commit ? "restored" : "would restore"} source/target ` +
      `on ${restored} edge revision(s).`,
  );
  if (unrestorable > 0) {
    console.log(
      `  ${unrestorable} edge revision(s) have lost their edge, so source and ` +
        `target cannot be recovered; their node_id is still corrected.`,
    );
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
