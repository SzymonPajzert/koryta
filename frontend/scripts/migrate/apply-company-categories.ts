import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { asArray } from "../../shared/model";
import { companyCategories } from "../../shared/companyCategories";

/**
 * Bring `categories` on company nodes in line with what the pipelines say.
 *
 * `categories` is what the filter on /eksploruj matches with `array-contains`,
 * and it is written by `/api/ingest/company` from the payload the pipelines
 * emit. So the stored set is frozen at the moment a company was last ingested:
 * changing the mapping in
 * `data/pipelines/src/entities/company_categories.py` changes what a *new*
 * upload files a company under and nothing about the companies already stored,
 * and between the two the category reads as wrong rather than as stale.
 *
 * The upload closes that gap, but it means running the whole `Companies`
 * pipeline against production. This does the same job from the pipeline's
 * answer alone: point it at a file of `{krs, categories}` records and it writes
 * the difference. Two pipelines emit that shape - see the usage note below for
 * which to pick.
 *
 * It deliberately holds no mapping of its own. The whole reason the derivation
 * moved to Python is that a PKD prefix list is not enough to decide what a
 * company is, and a second copy of the answer in TypeScript would be a second
 * thing to get wrong.
 *
 * Each change is filed as a **revision**, not as a bare field write. A node and
 * its approved revision are the same snapshot written twice, so a field written
 * past the revision makes the two disagree - and the change then does not show
 * in the node's history, which for a category somebody may have argued about is
 * exactly where it should show. `seed-public-institutions.ts` does the same
 * thing for `isPublic` and is the model for this.
 *
 * What it will not do:
 *   - touch a node carrying `categoriesSource: "manual"`. A person has answered
 *     for that company and the pipelines do not outrank them; this is the same
 *     contract `/api/ingest/company` follows.
 *   - write a company whose stored set already matches. Re-running when nothing
 *     changed writes nothing.
 *   - invent a category. A value the site does not offer is reported and
 *     skipped, because a category no filter can reach is worse than none.
 *   - publish anything. A node's visibility is left exactly as it is, and a
 *     node with no approved revision keeps its draft state.
 *
 * Usage. Produce the input from the pipelines. There are two producers, and
 * which one is right depends on what moved - the rules or the register.
 *
 *   `SiteCompanyCategories` is the cheap one and the usual answer. It recomputes
 *   the categories from the PKD codes the nightly Firestore export already
 *   carries, so it costs one export read and can be run in the same session as
 *   the change to `company_categories.py` that it is applying. That is the whole
 *   point of it: the expensive input is why the mapping and the site drifted two
 *   months apart in the first place.
 *
 *   `CompaniesPayloads` is authoritative and slow. It reads today's register -
 *   a KRS scrape and a wiki rebuild - so take it when a company's *codes* have
 *   changed since it was last ingested, rather than when the rules have.
 *
 *   cd data/pipelines
 *   # `grep '^{'` because `koryta` prints its progress on stdout alongside the
 *   # records, and this script parses every non-blank line as JSON.
 *   .venv/bin/koryta SiteCompanyCategories --output stdout | grep '^{' \
 *     > /tmp/company-categories.jsonl
 *
 * then, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/apply-company-categories.ts --input /tmp/company-categories.jsonl
 *   npx tsx scripts/migrate/apply-company-categories.ts --input ... --commit
 * Against production:
 *   npx tsx scripts/migrate/apply-company-categories.ts --input ... --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const inputPath = argValue("--input");

if (!inputPath) {
  console.error(
    "Missing --input <file>. Expects JSON or JSONL records carrying `krs` and `categories`.",
  );
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

const AUTHOR = "migration:apply-company-categories";

const KNOWN_CATEGORIES = new Set(companyCategories.map((c) => c.value));

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/** KRS numbers are ten digits with leading zeros, and every path that has ever
 * put one through a spreadsheet or a JSON number has lost them. Padded on both
 * sides of the comparison rather than trusted. */
function normalizeKrs(value: unknown): string | undefined {
  if (typeof value === "number") return String(value).padStart(10, "0");
  if (typeof value !== "string") return undefined;
  const digits = value.trim();
  if (!/^\d{1,10}$/.test(digits)) return undefined;
  return digits.padStart(10, "0");
}

/** Same members, in any order: the stored order carries no meaning, and
 * rewriting a document to reorder it would cost a write for nothing. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((value) => seen.has(value));
}

/** The pipeline's answer, keyed by KRS.
 *
 * Accepts JSONL and a JSON array, because the two are what the pipeline can be
 * asked for and telling them apart is cheaper than making the caller care. A
 * record with no `categories` key at all is skipped rather than read as an
 * empty set: it means the producer did not compute one, and an empty array
 * means it did and the answer is none.
 */
function readInput(path: string): Map<string, string[]> {
  const raw = readFileSync(path, "utf8").trim();
  const records: unknown[] = raw.startsWith("[")
    ? JSON.parse(raw)
    : raw
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

  const byKrs = new Map<string, string[]>();
  let skipped = 0;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const row = record as Record<string, unknown>;
    const krs = normalizeKrs(row.krs);
    if (!krs) {
      skipped++;
      continue;
    }
    if (!("categories" in row)) continue;
    byKrs.set(krs, asArray<string>(row.categories as string[]));
  }
  if (skipped) console.warn(`  ${skipped} records had no usable KRS number.`);
  return byKrs;
}

type Stats = {
  matched: number;
  unchanged: number;
  manual: number;
  changed: number;
  unknownCategory: number;
  notOnSite: number;
};

async function main() {
  const wanted = readInput(inputPath!);
  console.log(
    `Read ${wanted.size} companies from ${inputPath}${commit ? "" : " (dry run)"}.`,
  );

  const db = getFirestore(app, "koryta-pl");
  const snapshot = await db
    .collection("nodes")
    .where("type", "==", "place")
    .get();
  console.log(`Scanning ${snapshot.docs.length} place nodes.`);

  const stats: Stats = {
    matched: 0,
    unchanged: 0,
    manual: 0,
    changed: 0,
    unknownCategory: 0,
    notOnSite: 0,
  };
  const seen = new Set<string>();

  let batch = db.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const krs = normalizeKrs(data.krsNumber);
    if (!krs) continue;
    const derived = wanted.get(krs);
    if (derived === undefined) continue;

    seen.add(krs);
    stats.matched++;

    if (data.categoriesSource === "manual") {
      stats.manual++;
      continue;
    }

    const unknown = derived.filter((value) => !KNOWN_CATEGORIES.has(value));
    if (unknown.length > 0) {
      stats.unknownCategory++;
      console.warn(
        `  ${data.name}: pipeline sent unknown categories [${unknown.join(", ")}] - add them to shared/companyCategories.ts first. Skipping.`,
      );
      continue;
    }

    const stored = asArray<string>(data.categories);
    if (sameSet(stored, derived)) {
      stats.unchanged++;
      continue;
    }

    stats.changed++;
    console.log(
      `  ${data.name}: [${stored.join(", ") || "-"}] -> [${derived.join(", ") || "-"}]`,
    );
    if (!commit) continue;

    // A revision is a whole snapshot of what the node should say, so it starts
    // from what is stored and states the one field that changes. The internal
    // fields - the counters, the votes, the revision pointer - belong to the
    // document rather than to any revision, so they stay out of it.
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    revisionData.categories = derived;

    const revisionRef = db.collection("revisions").doc();
    batch.set(revisionRef, {
      node_id: doc.id,
      collection: "nodes",
      data: revisionData,
      update_time: Timestamp.now(),
      update_user: AUTHOR,
      update_automatic: true,
      // Approved as written, on the same terms as the ingest that would
      // otherwise have carried this: the pipelines already publish a company's
      // name, its PKD codes and its ownership without review, and a category
      // is the same kind of claim from the same source. Anyone who disagrees
      // edits it on the page, which pins it against exactly this script.
      status: "approved",
      review_user: AUTHOR,
      review_time: Timestamp.now(),
    });

    // A targeted update rather than the snapshot written back: everything else
    // on the node - the vote aggregates, the edge summaries, whether it is
    // published - belongs to other writers, and a `set` here would delete
    // whatever this script did not happen to carry. `revision_id` is repointed
    // only where the node already had an approved revision; a draft stays a
    // draft.
    const update: Record<string, unknown> = { categories: derived };
    if (data.revision_id) update.revision_id = revisionRef;
    batch.update(doc.ref, update);

    pending += 2;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (commit && pending > 0) await batch.commit();

  stats.notOnSite = [...wanted.keys()].filter((krs) => !seen.has(krs)).length;

  console.log("");
  console.log(`  matched on the site:       ${stats.matched}`);
  console.log(`  already correct:           ${stats.unchanged}`);
  console.log(`  pinned by a person:        ${stats.manual}`);
  console.log(`  unknown category, skipped: ${stats.unknownCategory}`);
  console.log(`  in the file, not on site:  ${stats.notOnSite}`);
  console.log(
    `  ${commit ? "wrote" : "would write"} a revision for: ${stats.changed}`,
  );
}

/** Computed or bookkeeping fields that belong to the node rather than to any
 * revision, mirroring `INTERNAL_FIELDS` in `server/utils/revisions.ts`.
 * Copying them into revision data would freeze a stale snapshot; the list is
 * repeated rather than imported because importing it pulls the whole Nitro
 * alias graph into a plain tsx script. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "nameChunksLower",
]);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
