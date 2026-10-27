import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pageIsPublic, type Edge } from "../../../shared/model";
import { candidacyElections } from "../../../shared/stats";
import { reportRemaining } from "../remaining";

/**
 * Give every person who stood in an election `stats.edges.{all,approved}.elections`.
 *
 * /eksploruj/tabela's „Wybory” filter is a Firestore `array-contains-any` on
 * that field, because the candidacies are edges of their own and a query on
 * `nodes` cannot see them. Firestore does not match a document lacking the
 * field, so until a person carries it they are under no election at all: the
 * filter answers with whoever happens to have been recomputed since it shipped.
 *
 * From here on it is kept by the same code as the rest of `stats.edges`
 * (`computeEdgeStats` in shared/stats.ts): `sweepEdgeStats` recomputes a node a
 * minute after one of its edges is written, and /api/stats/computeNodes does
 * every node. This writes the two fields alone, worked out by that function's
 * own `candidacyElections`, so the answer cannot differ from what the sweeper
 * would write - only people whose stored value differs are touched, about
 * 6,000 of 13,000 on the 2026-10-26 export.
 *
 * **Deploy the functions first** (`firebase deploy --only functions`, which is
 * manual). The sweeper writes `stats.edges` as one map, so while it runs the
 * code from before this field it takes `elections` off every person whose
 * edges move - the night's people step alone touches hundreds. The dry run's
 * count growing back is how that shows.
 *
 * Run on production on 2026-10-27, and archived: its dry run against that
 * day's 09:30 export reports no one left. A count coming back means
 * something writes `stats.edges` without the field again: the sweeper or
 * /api/stats/computeNodes deployed from before it, or a new writer that builds
 * the map by hand.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/archive/backfill-election-stats.ts            # dry run
 *   npx tsx scripts/migrate/archive/backfill-election-stats.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/archive/backfill-election-stats.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

const ALL = "stats.edges.all.elections";
const APPROVED = "stats.edges.approved.elections";

function same(stored: unknown, expected: string[]): boolean {
  // Absent is what a person with no candidacy has until a recompute writes the
  // empty list, and it filters exactly the same - so it is not worth a write.
  const list = Array.isArray(stored) ? stored : [];
  return (
    list.length === expected.length &&
    list.every((key, i) => key === expected[i])
  );
}

async function backfill() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  // Only the fields `candidacyElections` and `pageIsPublic` read: the rest of a
  // candidacy - committee, party, term - is most of its bytes.
  const candidaciesSnap = await db
    .collection("edges")
    .where("type", "==", "election")
    .select(
      "type",
      "source",
      "start_date",
      "position",
      "by_election",
      "elected",
      "published",
      "deleted",
    )
    .get();
  const bySource = new Map<string, Edge[]>();
  for (const doc of candidaciesSnap.docs) {
    const edge = doc.data() as Edge;
    if (!edge.source) continue;
    const list = bySource.get(edge.source) ?? [];
    list.push(edge);
    bySource.set(edge.source, list);
  }
  console.log(
    `Loaded ${candidaciesSnap.size} candidacies of ${bySource.size} node(s).`,
  );

  const peopleSnap = await db
    .collection("nodes")
    .where("type", "==", "person")
    .select(ALL, APPROVED)
    .get();
  console.log(`Scanning ${peopleSnap.size} person node(s).`);

  let batch = db.batch();
  let pending = 0;
  let toWrite = 0;
  let unchanged = 0;
  let withCandidacy = 0;

  for (const doc of peopleSnap.docs) {
    // The same two lists `computeEdgeStats` builds: removed candidacies are no
    // candidacies, and the approved one holds only what is published.
    const live = (bySource.get(doc.id) ?? []).filter((e) => e.deleted !== true);
    const all = candidacyElections(live, doc.id);
    const approved = candidacyElections(live.filter(pageIsPublic), doc.id);
    if (all.length > 0) withCandidacy++;

    if (same(doc.get(ALL), all) && same(doc.get(APPROVED), approved)) {
      unchanged++;
      continue;
    }
    toWrite++;
    if (commit) {
      batch.update(doc.ref, { [ALL]: all, [APPROVED]: approved });
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
    `${commit ? "Wrote" : "Would write"} the elections of ${toWrite} ` +
      `person node(s); ${withCandidacy} stood in at least one election the ` +
      `filter offers. ${unchanged} already up to date.`,
  );
  if (!commit) reportRemaining({ people: toWrite });
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
