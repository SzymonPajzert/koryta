import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { INTERNAL_FIELDS } from "../../server/utils/revisions";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: give documents whose `revision_id` points nowhere a real
 * revision to point at.
 *
 * `revision_id` names the revision that was published. Two things read it and
 * disagree when it is invented rather than written: `pageIsPublic` only asks
 * whether it is set, so the document looks published, while
 * `computeRevisionsObj` compares it against the document's newest revision to
 * decide whether a change is still awaiting approval — and a pointer that
 * resolves to nothing never matches, so the document claims a pending change
 * forever. `/api/revisions/byNode` reports an `approvedRevisionId` that cannot
 * be fetched.
 *
 * The region seeding in `data/scrapers/src/analysis/payloads/region.py` used the
 * field as an "approved" flag, filling in the region's own id (`teryt02`) and
 * `rev_<edge_id>` for the tree's `owns` edges. That is 390 region nodes and 375
 * edges, plus 15 regions pointing at a neighbouring region's revision.
 *
 * Rather than clear the pointer — which would unpublish 405 regions and take
 * them off the site for logged out visitors — this writes the revision that
 * should have existed, from the document as it stands, and points at that. The
 * payload no longer carries the field, so nothing re-creates the problem.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/repair-revision-pointers.ts            # dry run
 *   npx tsx scripts/migrate/repair-revision-pointers.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/repair-revision-pointers.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: adminProjectFromEnv() });

/** Attributed to the pipeline rather than to a person, since no person made
 * this edit — the same distinction `computeVoteStats` draws for votes. */
const AUTHOR = "pipeline";

/** The id a link field points at, whatever shape it was stored in. */
function pointsAt(value: unknown): string | undefined {
  if (typeof value === "string") return value.split("/").pop();
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id: string }).id;
  }
  return undefined;
}

async function repair(
  db: FirebaseFirestore.Firestore,
  collection: string,
  /** Which revision belongs to which document, by revision id. */
  revisionOwner: Map<string, string>,
): Promise<number> {
  const snapshot = await db.collection(collection).get();
  console.log(`Scanning ${snapshot.docs.length} ${collection}.`);

  let batch = db.batch();
  let pending = 0;
  let repaired = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.revision_id) continue;

    const target = pointsAt(data.revision_id);
    // Already pointing at one of its own revisions: nothing to do.
    if (target !== undefined && revisionOwner.get(target) === doc.id) continue;

    repaired++;
    if (!commit) continue;

    // The document's own fields, minus the bookkeeping a revision does not
    // carry - the same split `baseNodeFields` makes when a revision is written
    // from a node.
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }

    const revisionRef = db.collection("revisions").doc();
    batch.set(revisionRef, {
      node_id: doc.id,
      data: revisionData,
      update_time: Timestamp.now(),
      update_user: AUTHOR,
      update_automatic: true,
    });
    batch.update(doc.ref, { revision_id: revisionRef });
    pending += 2;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    `  ${commit ? "Wrote" : "Would write"} a revision for ${repaired} ` +
      `${collection} whose revision_id resolved to nothing of theirs.`,
  );
  return repaired;
}

async function migrate() {
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // Read the revisions once: the check is "does this revision belong to that
  // document", which is a lookup rather than a query per document.
  const revisionOwner = new Map<string, string>();
  const revisionsSnap = await db.collection("revisions").get();
  for (const doc of revisionsSnap.docs) {
    const owner = pointsAt(doc.data().node_id);
    if (owner) revisionOwner.set(doc.id, owner);
  }
  console.log(`Loaded ${revisionOwner.size} revisions.`);

  const nodes = await repair(db, "nodes", revisionOwner);
  const edges = await repair(db, "edges", revisionOwner);

  console.log(
    `${commit ? "Repaired" : "Would repair"} ${nodes + edges} document(s).`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
