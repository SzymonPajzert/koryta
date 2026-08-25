import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { normalizePersonName } from "../../shared/names";

/**
 * One-time migration: give every person the folded name they are looked up by.
 *
 * `/api/ingest/person` decides whether it already has somebody by querying for
 * their name, and Firestore can only compare stored values - it cannot fold the
 * two sides of the comparison itself. So the equality was on `name` verbatim,
 * and verbatim is exactly what two sources of the same person disagree about:
 * the graph stores what the register wrote, the payload carries what the
 * scraper read, and "Rafal Trzaskowski" against a stored "Rafał Trzaskowski"
 * read as a person the database did not have. The ingest then created a second
 * node, and every employment, candidacy and mention of that run went onto it -
 * splitting one person's record in two, with the votes and notes left behind on
 * the first.
 *
 * The lookup now compares `nameNormalized`, which is `normalizePersonName` of
 * the stored name. `onNodeWritten` in `functions/src/nodes.ts` maintains it
 * from here on, and `scripts/seed-emulator.ts` computes the same thing so the
 * emulator matches - but a trigger only fires on a write, so the people already
 * stored would never get one until something happened to touch them. This
 * writes it for them.
 *
 * People only. A company is matched on its KRS number, and the folding is
 * about how human names are spelled.
 *
 * Order matters, and the ingest is written not to depend on it: it falls back
 * to the old exact-name query when the normalized one misses, so an ingest run
 * between the trigger's deploy and this script matches as well as it used to
 * rather than duplicating everybody. Deploy the functions first all the same -
 * without them, a person created after this runs has no `nameNormalized` and
 * only the fallback would find them.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-person-name-normalized.ts            # dry run
 *   npx tsx scripts/migrate/backfill-person-name-normalized.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-person-name-normalized.ts --prod --commit
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

  // Only the three fields the predicate needs. The node bodies are the bulk of
  // the collection and none of this reads them.
  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "person")
    .select("name", "nameNormalized")
    .get();
  console.log(`Scanning ${snapshot.docs.length} person node(s).`);

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  let corrected = 0;
  let unchanged = 0;
  // Reported rather than written: a name that folds to nothing is punctuation
  // or an empty string, and a key every such node shares would match them all
  // to each other. They are left without one, which the ingest reads as "not
  // found" - the same answer the exact-name fallback gives.
  const unfoldable: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const name = typeof data.name === "string" ? data.name : "";
    const nameNormalized = normalizePersonName(name);

    if (!nameNormalized) {
      unfoldable.push(doc.id);
      continue;
    }
    if (data.nameNormalized === nameNormalized) {
      unchanged++;
      continue;
    }
    // Not the same thing as a missing one: a stored key that disagrees with the
    // name means the name was edited while the trigger was not deployed, and
    // the person is currently findable under a spelling they no longer have.
    if (typeof data.nameNormalized === "string") corrected++;
    else written++;

    if (commit) {
      batch.update(doc.ref, { nameNormalized });
      pending++;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(`nameNormalized written: ${written}`);
  console.log(`nameNormalized corrected: ${corrected}`);
  console.log(`Already correct: ${unchanged}`);
  console.log(
    `Skipped, name folds to nothing: ${unfoldable.length}` +
      (unfoldable.length > 0 ? ` (${unfoldable.slice(0, 20).join(", ")})` : ""),
  );
  if (!commit) console.log("Dry run — nothing written.");
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
