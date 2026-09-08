import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * One-time migration: give every person node a `stats.factsCount`.
 *
 * /eksploruj/tabela offers „Liczba faktów” as a sort, which becomes a Firestore
 * `orderBy stats.factsCount` on the `nodes` collection. Firestore does not sort
 * a document that lacks the field - it drops it - so until every person carries
 * the counter, that sort answers with whichever subset happens to have been
 * through an ingest since the field existed, and says nothing about the rest.
 * Hence the zeroes: a person with no extracted facts has to carry `0` to be in
 * the table at all.
 *
 * From here on the counter is maintained by /api/ingest/extraction, which
 * recounts every person a batch names, and recomputed wholesale by
 * /api/stats/computeNodes.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-facts-count.ts            # dry run
 *   npx tsx scripts/migrate/backfill-facts-count.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-facts-count.ts --prod --commit
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

  // One field of every fact. The justification is a paragraph of prose and
  // there is one per fact, so reading the documents whole to count them would
  // be by far the largest read here.
  const extractionsSnap = await db
    .collection("extractions")
    .select("personNodeId")
    .get();
  const factsByNode = new Map<string, number>();
  for (const doc of extractionsSnap.docs) {
    const personNodeId = doc.get("personNodeId") as string | undefined;
    if (!personNodeId) continue;
    factsByNode.set(personNodeId, (factsByNode.get(personNodeId) ?? 0) + 1);
  }
  console.log(
    `Loaded ${extractionsSnap.docs.length} fact(s), ` +
      `${factsByNode.size} of them matched to a person.`,
  );

  // People only: a fact is matched to a person node and to nothing else, so a
  // company or a region carrying `factsCount: 0` would be a field written onto
  // 8,000 documents to say something that is true of them by construction.
  const peopleSnap = await db
    .collection("nodes")
    .where("type", "==", "person")
    .select("stats.factsCount")
    .get();
  console.log(`Scanning ${peopleSnap.docs.length} person node(s).`);

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  let unchanged = 0;

  for (const doc of peopleSnap.docs) {
    const current = doc.get("stats.factsCount") as number | undefined;
    const count = factsByNode.get(doc.id) ?? 0;
    if (current === count) {
      unchanged++;
      continue;
    }
    written++;
    if (commit) {
      batch.update(doc.ref, { "stats.factsCount": count });
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
    `${commit ? "Wrote" : "Would write"} stats.factsCount on ${written} ` +
      `person node(s); ${factsByNode.size} person(s) have at least one fact. ` +
      `${unchanged} already up to date.`,
  );
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
