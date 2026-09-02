import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * One-time migration: delete every extraction filed under one model tag.
 *
 * `POST /api/ingest/extraction` writes each fact to a fresh
 * `db.collection("extractions").doc()` — it has no dedupe key of any kind, so
 * re-running a pipeline over articles it has already seen files the same fact
 * a second time under whatever tag that run carried. Nothing downstream
 * collapses them: /api/extractions lists both, and the review flow hands the
 * same sentence to a reviewer twice.
 *
 * `v26-mentions-qwen3.8-27b-openrouter` (2026-08-30, 293 facts) overlaps the
 * runs on either side of it. Measured against the 2026-09-02T02:00Z export:
 *
 *   40  facts also present under BOTH `matched31-sample` and
 *       `v26-mentions-qwen3.8-27b-only-matched-koryta-id`, identical down to
 *       `personNodeId` — these are the duplicates
 *  253  facts that exist nowhere else in the collection
 *
 * So deleting the tag whole is not only a de-duplication: it drops 253 facts
 * that no other run produced, 11 of which a human has already reviewed. Pass
 * `--duplicates-only` to remove just the 40 that have a twin under another
 * tag and leave the rest of the tag standing.
 *
 * Votes are deleted with the facts they point at. A vote whose `extractionId`
 * names a document that no longer exists is not reachable by any reader —
 * /api/stats/database still counts it under `onExtractions`, and
 * ekstrakcje/kategoryzacja marks a fact reviewed that is not there — so it
 * would be dead weight of exactly the kind `delete-untargeted-votes.ts`
 * cleared out. 18 votes point into this tag, all from one reviewer.
 *
 * `onVoteWritten` fires for each deleted vote and tries to `update` the
 * aggregate on an extraction this script has already removed. That throws
 * NOT_FOUND, which the trigger catches and logs; one error line per deleted
 * vote is expected and means nothing.
 *
 * There is no code fix to land alongside this one: the cause is that ingest
 * has no idempotency key, which is a change to how facts are addressed rather
 * than a repair, and is not attempted here.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/delete-extraction-tag.ts            # dry run
 *   npx tsx scripts/migrate/delete-extraction-tag.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/delete-extraction-tag.ts --prod --commit
 * Only the facts that have a twin under another tag:
 *   npx tsx scripts/migrate/delete-extraction-tag.ts --duplicates-only
 * Another tag entirely:
 *   npx tsx scripts/migrate/delete-extraction-tag.ts --tag v15_gen_test
 */

const TAG = "v26-mentions-qwen3.8-27b-openrouter";

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const duplicatesOnly = process.argv.includes("--duplicates-only");
const tagArg = process.argv.indexOf("--tag");
const tag = tagArg === -1 ? TAG : process.argv[tagArg + 1];

if (!tag) {
  console.error("--tag needs a value");
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** The fields that make two facts the same fact.
 *
 * Everything the pipeline extracted, plus the article it came from — but not
 * `tag`, `createdAt`, `uploaderUid`, `stats` or the resolved `personNodeId`,
 * which are properties of the run rather than of the claim. `justification`
 * is left out too: it is free text from the model and differs between runs
 * that agree on the fact itself.
 */
function factKey(data: FirebaseFirestore.DocumentData): string {
  return JSON.stringify([
    data.articleUrl ?? null,
    data.fact_type ?? null,
    data.person ?? null,
    data.subject ?? null,
    data.organization ?? null,
    data.role ?? null,
    data.party ?? null,
    data.object ?? null,
    data.relation ?? null,
    data.affair ?? null,
  ]);
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // The whole collection, not a `where("tag", "==", tag)` query: deciding
  // whether a fact is duplicated needs the other tags too, and at ~2k
  // documents reading it whole is one pass instead of two.
  const snapshot = await db.collection("extractions").get();
  console.log(`Scanning ${snapshot.docs.length} extraction(s).`);

  // Which tags each fact appears under, so a fact under `tag` can be asked
  // whether any *other* run also produced it.
  const tagsByFact = new Map<string, Set<string>>();
  for (const doc of snapshot.docs) {
    const key = factKey(doc.data());
    const tags = tagsByFact.get(key);
    if (tags) tags.add(doc.data().tag);
    else tagsByFact.set(key, new Set([doc.data().tag]));
  }

  const inTag = snapshot.docs.filter((doc) => doc.data().tag === tag);
  if (inTag.length === 0) {
    console.log(`No extraction carries tag "${tag}" — nothing to do.`);
    return;
  }

  const elsewhere = new Set<string>();
  const duplicates: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const unique: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const doc of inTag) {
    const otherTags = new Set(tagsByFact.get(factKey(doc.data())));
    otherTags.delete(tag);
    if (otherTags.size > 0) {
      for (const other of otherTags) elsewhere.add(other);
      duplicates.push(doc);
    } else {
      unique.push(doc);
    }
  }
  const doomed = duplicatesOnly ? duplicates : [...duplicates, ...unique];

  console.log(
    `  ${inTag.length} fact(s) tagged "${tag}": ${duplicates.length} also ` +
      `produced by another run (${[...elsewhere].sort().join(", ") || "none"}), ` +
      `${unique.length} produced by this run alone.`,
  );
  if (duplicatesOnly) {
    console.log(
      `  --duplicates-only: keeping the ${unique.length} unique fact(s).`,
    );
  } else if (unique.length > 0) {
    console.log(
      `  WARNING: this removes ${unique.length} fact(s) that exist under no ` +
        `other tag. Pass --duplicates-only to keep them.`,
    );
  }

  // Votes are fetched per fact rather than by reading the collection whole:
  // `extractionId` is indexed, and a few hundred equality queries cost far
  // less than the ~26k-document votes collection.
  const doomedIds = new Set(doomed.map((doc) => doc.id));
  const doomedVotes: FirebaseFirestore.DocumentReference[] = [];
  const reviewedFacts = new Set<string>();
  for (const chunk of chunked([...doomedIds], 30)) {
    const votes = await db
      .collection("votes")
      .where("extractionId", "in", chunk)
      .get();
    for (const vote of votes.docs) {
      doomedVotes.push(vote.ref);
      reviewedFacts.add(vote.data().extractionId as string);
    }
  }
  console.log(
    `  ${doomedVotes.length} vote(s) point at ${reviewedFacts.size} of the ` +
      `fact(s) being deleted; they go with them.`,
  );

  if (commit) {
    let batch = db.batch();
    let pending = 0;
    // Facts and their votes in the same batches: the two are only consistent
    // together, and a batch cannot be half-applied.
    for (const ref of [...doomed.map((doc) => doc.ref), ...doomedVotes]) {
      batch.delete(ref);
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
    `${commit ? "Deleted" : "Would delete"} ${doomed.length} extraction(s) ` +
      `and ${doomedVotes.length} vote(s).`,
  );
}

/** Firestore caps an `in` filter at 30 values. */
function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
