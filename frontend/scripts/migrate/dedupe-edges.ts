import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { edgeIdentity, type EdgeLike } from "../../server/utils/edges";

/**
 * One-time migration: delete edges that duplicate another one exactly.
 *
 * The person ingest used to look an edge up by `(source, target)` alone, and to
 * do it with a query — which cannot see the writes still sitting in the request's
 * uncommitted batch. A payload carrying several ties between the same pair (two
 * elections in one region, two posts at one company; the employments are even
 * resolved concurrently) therefore wrote one edge per tie and found none of
 * them, leaving copies behind. Two identical `employed` edges are two jobs as
 * far as the graph and the experience calculation are concerned.
 *
 * The write side is fixed in server/utils/edges.ts, which matches on everything
 * that distinguishes one edge from another and derives the document id from it,
 * so a repeat inside one batch lands on the same document. This deletes the
 * copies already written, together with their revisions — a revision of an edge
 * that should never have existed is not history worth keeping, and leaving it
 * would only orphan it.
 *
 * Duplicates are groups that agree on *everything* an edge asserts, not just on
 * the pair and the type: a person can legitimately hold the same post twice.
 * The survivor is a published copy where the group has one, so nothing that was
 * visible on the site disappears.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/dedupe-edges.ts            # dry run
 *   npx tsx scripts/migrate/dedupe-edges.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/dedupe-edges.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** The copy to keep: a published one if the group has any, else the lowest id.
 *
 * Published wins because `revision_id` is what makes an edge visible to a
 * logged out visitor, so keeping an unpublished copy would take a link off the
 * site. The id tie-break is arbitrary but stable, which is what makes a dry run
 * predict what the real run will do.
 */
function pickSurvivor(group: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const published = group.filter((doc) => doc.data().revision_id);
  const candidates = published.length > 0 ? published : group;
  return candidates.reduce((best, doc) => (doc.id < best.id ? doc : best));
}

/** The document id a revision's `node_id` points at, whichever way it is stored.
 *
 * The December 2025 backfill wrote references where everything else writes a
 * plain id; see scripts/migrate/repair-migrated-revisions.ts.
 */
function revisionTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value.split("/").pop();
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id: string }).id;
  }
  return undefined;
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const edgesSnap = await db.collection("edges").get();
  console.log(`Scanning ${edgesSnap.docs.length} edges.`);

  const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of edgesSnap.docs) {
    const identity = edgeIdentity(doc.data() as EdgeLike);
    const group = groups.get(identity);
    if (group) group.push(doc);
    else groups.set(identity, [doc]);
  }

  const redundant = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  let duplicatedGroups = 0;
  const byType: Record<string, number> = {};
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicatedGroups++;
    const survivor = pickSurvivor(group);
    for (const doc of group) {
      if (doc.id === survivor.id) continue;
      redundant.set(doc.id, doc);
      const type = String(doc.data().type);
      byType[type] = (byType[type] ?? 0) + 1;
    }
  }
  console.log(
    `  ${redundant.size} redundant edge(s) across ${duplicatedGroups} group(s): ` +
      (Object.entries(byType)
        .map(([type, count]) => `${type} ${count}`)
        .join(", ") || "none"),
  );

  // Revisions of an edge that is going away. Read after the edges so the set of
  // doomed ids is complete.
  const revisionsSnap = await db.collection("revisions").get();
  const orphanRevisions = revisionsSnap.docs.filter((doc) => {
    const target = revisionTarget(doc.data().node_id);
    return target !== undefined && redundant.has(target);
  });
  console.log(
    `  ${orphanRevisions.length} revision(s) belong to those edges and go with them.`,
  );

  if (commit) {
    let batch = db.batch();
    let pending = 0;
    for (const doc of [...redundant.values(), ...orphanRevisions]) {
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
    `${commit ? "Deleted" : "Would delete"} ${redundant.size} edge(s) and ` +
      `${orphanRevisions.length} revision(s).`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
