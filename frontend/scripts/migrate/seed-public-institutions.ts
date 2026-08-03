import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: mark the public institutions that are not in KRS.
 *
 * `isPublic` is only ever written by the company ingest, which reads KRS — so a
 * ministry, an urząd or a wojewódzki fundusz, none of which have an entry
 * there, has no value at all. Employment at them is therefore left out of the
 * public-sector experience stats, which is the opposite of the truth.
 *
 * The scrapers cannot fix this: there is nothing to scrape. So the answer is
 * curated here, as an explicit list of name prefixes rather than a guess from
 * the shape of a name — a wrong `true` silently inflates every profile that
 * touches the institution, so the list only covers organs of public
 * administration and state or municipal funds, where there is no doubt.
 *
 * Places that merely *look* public (Orlen, Enea, PKP Cargo Connect) are left
 * alone on purpose: they are companies, they do have a KRS entry, and the
 * no-KRS copies of them are unapproved drafts duplicating a scraped node.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/seed-public-institutions.ts            # dry run
 *   npx tsx scripts/migrate/seed-public-institutions.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/seed-public-institutions.ts --prod --commit
 */

/** Name prefixes that identify a public body beyond argument. */
const PUBLIC_PREFIXES = [
  // "Ministerstwo ",
  // Ministry and urząd marszałkowski departments.
  "Departament ",
  "Urząd ",
  // "Miasto ",
  // "Województwo ",
  // "Sejmik ",
  // "Rada Miasta ",
  // "Skarb Państwa",
  // Ochrona środowiska funds, national and voivodeship.
  "NFOŚ",
  "WFOŚ",
  "Agencja Mienia Wojskowego",
  "Agencja Modernizacji i Restrukturyzacji Rolnictwa",
  "Agencja Restrukturyzacji i Modernizacji Rolnictwa",
  "Krajowy Ośrodek Wsparcia Rolnictwa",
  "Krajowy Zasób Nieruchomości",
  "Centralny Ośrodek Informatyki",
  "Centrum Projektów Polska Cyfrowa",
  "Ośrodek Pomocy Społecznej",
  "Dzielnicowe Biuro Finansów Oświaty",
  "Mazowiecki Zarząd Dróg Wojewódzkich",
  "Mazowieckie Biuro Planowania Regionalnego",
  "Zarząd Mienia ",
  "Zarząd Transportu Miejskiego",
];

/** Names with no useful prefix, listed one by one. Warsaw's dzielnica units are
 * here because their names are acronyms rather than the office they are. */
const PUBLIC_NAMES = new Set([
  // "Rząd",
  "OSiR Praga Południe",
  "Szpital Solec",
  // "Targówek (Warszawa)",
  "ZGN Praga-Południe",
]);

export function isPublicInstitution(name: string | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (PUBLIC_NAMES.has(trimmed)) return true;
  const lower = trimmed.toLocaleLowerCase("pl");
  return PUBLIC_PREFIXES.some((prefix) =>
    lower.startsWith(prefix.toLocaleLowerCase("pl")),
  );
}

/** What this migration changes about the node itself.
 *
 * Only these fields, written with `update`. Writing the revision snapshot over
 * the node with `set` - which is what this did until it had wiped the
 * institutions it was meant to mark - deletes everything a revision
 * deliberately leaves out, `stats` among it. A node with no
 * `stats.nodeGroupSize` disappears from `/api/search`, which orders by it, and
 * Firestore returns no document that lacks the field it is ordered on: the
 * WFOŚiGW, Departament and Urząd entries were unfindable for as long as that
 * took to notice.
 *
 * `revisionRef` is passed only when the node was already published, so an
 * unapproved draft stays one.
 */
export function nodeOwnershipUpdate(revisionRef?: {
  id: string;
}): Record<string, unknown> {
  const update: Record<string, unknown> = {
    isPublic: true,
    isPublicSource: "manual",
  };
  if (revisionRef) update.revision_id = revisionRef;
  return update;
}

/** Fields regenerated or managed outside a revision, mirroring
 * `server/utils/revisions.ts` — copying them in would freeze a stale snapshot. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "nameChunksLower",
]);

async function migrate() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }

  const app = initializeApp({ projectId: adminProjectFromEnv() });
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "place")
    .get();
  console.log(`Scanning ${snapshot.docs.length} place nodes.`);

  let batch = db.batch();
  let pending = 0;
  let marked = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Only places KRS cannot answer for, and only ones nobody has answered yet.
    if (data.krsNumber) continue;
    if (data.isPublic === true) continue;
    if (data.isPublicSource === "manual") continue;
    if (!isPublicInstitution(data.name)) continue;

    marked++;
    console.log(`  ${doc.id}  ${data.name}`);
    if (!commit) continue;

    // A revision is a whole snapshot, so it starts from what is stored.
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    revisionData.isPublic = true;
    revisionData.isPublicSource = "manual";

    // A revision, not a bare field write: the node's content and its current
    // revision have to keep saying the same thing, and this change should show
    // up in the node's history like any other. The revision is the content
    // snapshot, so it keeps leaving the internal fields out.
    const revisionRef = db.collection("revisions").doc();
    batch.set(revisionRef, {
      node_id: doc.id,
      data: revisionData,
      update_time: Timestamp.now(),
      update_user: "migration:seed-public-institutions",
      update_automatic: true,
    });
    // The node only gains an answer about its ownership - see
    // `nodeOwnershipUpdate` for why this is not the snapshot written back.
    batch.update(
      doc.ref,
      // Published only if the node already was; an unapproved draft stays one.
      nodeOwnershipUpdate(data.revision_id ? revisionRef : undefined),
    );
    pending += 2;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (commit && pending > 0) await batch.commit();
  console.log(
    commit
      ? `Marked ${marked} institutions as public.`
      : `Would mark ${marked} institutions as public.`,
  );
}

// Importable by the test that checks the name list without touching Firestore.
if (process.argv[1]?.endsWith("seed-public-institutions.ts")) {
  migrate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
