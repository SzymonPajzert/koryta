import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * One-time migration: give every extraction a `personMatched` flag.
 *
 * The search box finds people the article facts name who have no page of
 * their own (/api/search/facts, built in server/utils/factNames.ts). It reads
 * the facts that can name such a person - every relation, and every fact whose
 * subject matched nobody - instead of the whole collection. The relations are
 * found by `fact_type`. The unmatched ones cannot be: "matched nobody" is
 * `personNodeId` being absent, and Firestore does not filter on a field that
 * is not there. So /api/ingest/extraction writes `personMatched` on every fact
 * from now on, and this writes it onto the ones already stored.
 *
 * Until it has run, the search still finds the other person in a relation -
 * „Piotr Ferster” on Rafał Trzaskowski's page, the report this is for - but not
 * the subject of an older fact that matched nobody. There were 861 of those on
 * the 2026-09-29 export, 239 distinct full names among them (Zbigniew Ziobro,
 * Eva Kaili, Marcin Romanowski...), nearly all from July and August batches.
 *
 * Both values, not only `false`: a flag on some facts and not others would be
 * one more thing to remember about the field, and the whole collection has to
 * be read either way to find the unmatched ones.
 *
 * Nothing is triggered by a write to `extractions`, so this is one read and at
 * most one write per fact.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-person-matched.ts            # dry run
 *   npx tsx scripts/migrate/backfill-person-matched.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-person-matched.ts --prod --commit
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

  // The two fields this needs. The justification is a paragraph of prose on
  // every fact, and there are tens of thousands of them.
  const snapshot = await db
    .collection("extractions")
    .select("personNodeId", "personMatched")
    .get();
  console.log(`Scanning ${snapshot.docs.length} extraction(s).`);

  let batch = db.batch();
  let pending = 0;
  let matched = 0;
  let unmatched = 0;
  let unchanged = 0;

  for (const doc of snapshot.docs) {
    const personMatched = Boolean(doc.get("personNodeId"));
    // A clean run writes nothing: a fact the ingest already flagged, or one
    // an earlier run reached, is left alone.
    if (doc.get("personMatched") === personMatched) {
      unchanged++;
      continue;
    }
    if (personMatched) matched++;
    else unmatched++;

    if (commit) {
      batch.update(doc.ref, { personMatched });
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
    `${commit ? "Wrote" : "Would write"} personMatched on ` +
      `${matched + unmatched} extraction(s): ${matched} matched to a person, ` +
      `${unmatched} matched to nobody. ${unchanged} already up to date.`,
  );
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
