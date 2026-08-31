import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * Queue a recomputation of `stats.edges` for nodes whose stored value the
 * trigger never managed to write.
 *
 * Until 31 August 2026 `onEdgeWritten` chunked its transitive-ownership lookup
 * 30 targets at a time and combined it with `type in ("owns", "seat")`.
 * Firestore normalises that to 60 disjunctions and allows 30, so the query
 * threw INVALID_ARGUMENT for **every node with more than 15 distinct edge
 * targets** - and the trigger's catch swallowed it, so those nodes' stats were
 * silently never updated. Production logs show 385 such failures across 85
 * nodes in the week to 31 August, Warszawa and Krakow among them. They do not
 * read as obviously wrong because the ingest pipeline writes `stats.edges` too,
 * so what is stored is whatever the last bulk upload left there.
 *
 * The fix is in `functions/src/edges.ts`. This only queues the affected nodes:
 * it writes a marker into `edgeStatsDirty` and `sweepEdgeStats` does the
 * recomputation a minute later, which keeps one implementation of the
 * calculation rather than a second copy here that could disagree with it.
 *
 * **Deploy the functions first.** Nothing consumes the markers until
 * `sweepEdgeStats` is live, and `firebase deploy --only functions` is manual.
 *
 * It reads the whole `edges` collection once (~44k documents) to work out each
 * node's distinct target count. That is the only way to know which nodes were
 * over the limit, and it is a one-off against a 6.7M-read day.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/remark-edge-stats.ts
 *   npx tsx scripts/migrate/remark-edge-stats.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/remark-edge-stats.ts --prod --commit
 * To queue every node with edges rather than just the ones that were failing
 * (slower, and only worth it if you suspect drift from some other cause):
 *   npx tsx scripts/migrate/remark-edge-stats.ts --prod --all --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const markAll = process.argv.includes("--all");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });
const db = getFirestore(app, "koryta-pl");

/** Kept in step with `functions/src/edges.ts` by hand - two constants in a
 * one-off script is a smaller cost than exporting the function module into a
 * plain tsx run, which would pull firebase-functions in with it. */
const DIRTY_COLLECTION = "edgeStatsDirty";
const TARGETS_PER_QUERY = 15;

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500;

async function main() {
  console.log(
    `Reading edges from ${isProd ? "PRODUCTION" : "the emulator"}...`,
  );

  const edges = await db.collection("edges").get();
  const targetsBySource = new Map<string, Set<string>>();

  for (const doc of edges.docs) {
    const { source, target } = doc.data() as {
      source?: string;
      target?: string;
    };
    if (!source || !target) continue;
    let targets = targetsBySource.get(source);
    if (!targets) {
      targets = new Set();
      targetsBySource.set(source, targets);
    }
    targets.add(target);
  }

  const affected = [...targetsBySource.entries()]
    .filter(([, targets]) => markAll || targets.size > TARGETS_PER_QUERY)
    .map(([source, targets]) => ({ source, targets: targets.size }))
    .sort((a, b) => b.targets - a.targets);

  console.log(`  ${edges.size.toLocaleString()} edges`);
  console.log(
    `  ${targetsBySource.size.toLocaleString()} distinct source nodes`,
  );
  console.log(
    `  ${affected.length.toLocaleString()} to queue` +
      (markAll
        ? " (--all)"
        : ` (more than ${TARGETS_PER_QUERY} distinct targets)`),
  );
  for (const { source, targets } of affected.slice(0, 10)) {
    console.log(`    ${source} — ${targets} targets`);
  }
  if (affected.length > 10) {
    console.log(`    ... and ${affected.length - 10} more`);
  }

  if (!commit) {
    console.log("\nDry run. Pass --commit to write the markers.");
    return;
  }

  let written = 0;
  for (let i = 0; i < affected.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const { source } of affected.slice(i, i + BATCH_LIMIT)) {
      batch.set(db.collection(DIRTY_COLLECTION).doc(source), {
        at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    written += Math.min(BATCH_LIMIT, affected.length - i);
    console.log(`  queued ${written}/${affected.length}`);
  }

  console.log(
    `\nQueued ${written} nodes. sweepEdgeStats drains 500 a minute, so give it ` +
      `about ${Math.ceil(written / 500)} minute(s), then check the function logs.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
