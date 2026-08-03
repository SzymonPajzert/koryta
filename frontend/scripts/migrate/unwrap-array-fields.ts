import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  adminProjectFromEnv,
  firestoreDatabaseFromEnv,
} from "../../shared/firebase-env";

/**
 * One-time migration: store array fields as arrays again, not as maps.
 *
 * `sanitizeFirestoreData` used to rewrite *every* array it was given as a map
 * keyed by index (`["PiS"]` -> `{"0": "PiS"}`). The rule it was enforcing is
 * real but narrower: Firestore has no array-of-arrays, so only an array
 * directly inside another array needs that treatment. A top-level array field
 * does not, and rewriting it breaks the queries that read it — `parties`,
 * `activity` and `categories` are matched with `array-contains`, which returns
 * nothing for a map and raises nothing either, so the node silently drops out
 * of the filter. `parties: []` becoming `{}` breaks the opposite filter too,
 * since the "no party" case looks for `parties == []`.
 *
 * The write side is fixed in server/utils/revisions.ts; this repairs the
 * documents already written. Revisions are included deliberately: a revision is
 * written over its node wholesale when approved, so leaving the maps there
 * would undo the repair the first time somebody approves an old revision.
 *
 * Reads already cope with both shapes (`asArray` in server/utils/nodeFilters.ts),
 * so this can be run at any time, and re-run safely — a document already
 * holding an array is skipped.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/unwrap-array-fields.ts            # dry run
 *   npx tsx scripts/migrate/unwrap-array-fields.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/unwrap-array-fields.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: adminProjectFromEnv() });

/** Fields typed as arrays in shared/model.ts, per collection.
 *
 * An allowlist rather than "every map whose keys are numbers": `votes`,
 * `categoryVotes` and `stats` are maps on purpose, and a map that merely
 * happens to be keyed by digits would be destroyed by a general rule. Anything
 * outside the list that *looks* rewritten is reported instead of touched, so a
 * newly added array field shows up here rather than going quietly wrong.
 */
const ARRAY_FIELDS: Record<string, string[]> = {
  // `nameChunksLower` is the search index rather than a model field, but it is
  // an array and is written alongside the rest.
  nodes: ["parties", "activity", "categories", "nameChunksLower"],
  edges: ["references"],
  notes: ["sources"],
};

/** Revisions carry a node's or edge's own fields nested under `data`. */
const REVISION_FIELDS = [
  ...new Set([...ARRAY_FIELDS.nodes!, ...ARRAY_FIELDS.edges!]),
];

/** Whether a stored value is an array that was rewritten as a map.
 *
 * An empty map counts: `parties: {}` has to become `[]` for the "no party"
 * filter, which compares against an empty array, to match it again.
 */
function isRewrittenArray(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.keys(value).every((key) => /^\d+$/.test(key));
}

/** The array a rewritten map stood for, in its original order.
 *
 * Sorted numerically rather than by `Object.keys` order, and tolerant of gaps:
 * the old code dropped null elements, which could leave the indices
 * non-contiguous.
 */
function toArray(map: Record<string, unknown>): unknown[] {
  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value);
}

type Stats = { documents: number; byField: Record<string, number> };

function record(stats: Stats, field: string) {
  stats.byField[field] = (stats.byField[field] ?? 0) + 1;
}

async function unwrapCollection(
  db: FirebaseFirestore.Firestore,
  collection: string,
  fields: string[],
  /** Where the fields live inside the document; revisions nest them in `data`. */
  prefix = "",
): Promise<Stats> {
  const stats: Stats = { documents: 0, byField: {} };
  const unexpected = new Set<string>();

  const snapshot = await db.collection(collection).get();
  console.log(`Scanning ${snapshot.docs.length} ${collection}.`);

  let batch = db.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const container = prefix ? data[prefix] : data;
    if (!container || typeof container !== "object") continue;

    const update: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(container)) {
      if (!isRewrittenArray(value)) continue;
      if (!fields.includes(field)) {
        unexpected.add(field);
        continue;
      }
      update[prefix ? `${prefix}.${field}` : field] = toArray(value);
      record(stats, field);
    }

    if (Object.keys(update).length === 0) continue;
    stats.documents++;

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
    `  ${commit ? "Unwrapped" : "Would unwrap"} ${stats.documents} ${collection}: ` +
      (Object.entries(stats.byField)
        .map(([field, count]) => `${field} ${count}`)
        .join(", ") || "nothing to do"),
  );
  if (unexpected.size > 0) {
    console.log(
      `  Left alone, not a known array field: ${[...unexpected].join(", ")}. ` +
        `If one of these is an array, add it to ARRAY_FIELDS and re-run.`,
    );
  }
  return stats;
}

async function migrate() {
  const db = getFirestore(app, firestoreDatabaseFromEnv());
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  let total = 0;
  for (const [collection, fields] of Object.entries(ARRAY_FIELDS)) {
    total += (await unwrapCollection(db, collection, fields)).documents;
  }
  total += (await unwrapCollection(db, "revisions", REVISION_FIELDS, "data"))
    .documents;

  console.log(
    `${commit ? "Updated" : "Would update"} ${total} document(s) in total.`,
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
