import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { nameChunksToWrite } from "../../shared/search";
import { reportRemaining } from "./remaining";

/**
 * Re-index every searchable name whose stored `nameChunksLower` is not the
 * one `generateChunksLower` gives it now: the names a hyphen cuts, and the
 * few the trigger never redid.
 *
 * The index used to cut a name at its spaces only, so nothing after the
 * first hyphen of a word was a chunk: "kamysz" found no Kosiniak-Kamysz, and
 * "kanalizacyjne" no Przedsiębiorstwo Wodno-Kanalizacyjne. It mattered more
 * once the person ingest started renaming "Bogusława Kupczak Wiśniowska" to
 * the hyphen PKW gives (`learnsName`): a page "wiśniowska" found would have
 * stopped being found by it. `generateChunksLower` in `shared/search.ts` now
 * indexes each part of a hyphenated word too, and `nameMatchesTokens` cuts
 * words at hyphens the same way.
 *
 * The trigger (`onNodeWritten`, `functions/src/nodes.ts`) used to recompute
 * the index only when the name changed, and now does on any write that finds
 * it out of date (`nameChunksToWrite`). So a page the ingest renames is
 * re-indexed by the rename itself - that was true before too - and any page
 * is on its next write, once the function is deployed. This is for the pages
 * nothing writes. It is the trigger's own rule, so it also takes the names
 * with a newline, a tab or a doubled space that the whitespace fix of
 * 2026-08-31 said would heal on their next write, and which mostly had not.
 *
 * Measured against the 2026-10-11 export, of 18,034 people, places and
 * regions: 658 hyphenated names to re-index (41 people, 586 places, 31
 * regions) and 25 others (24 places, 1 person), 683 writes. 262 hyphenated
 * names keep their index, the hyphen standing alone between two spaces
 * ("Ewa Kukulska - Zając"). The index grows by 4,804 chunks over 777,634.
 *
 * Deploy the function first: run before it, this is still correct, but the
 * old trigger would index every page the ingest renames afterwards the old
 * way, and those would need it again.
 *
 * Done: the 2026-10-28 export holds no index this cut would change. That day
 * the cut took punctuation off a word as well, and this plan is the trigger's
 * own rule, so its dry run counts those names too, under whichever line their
 * hyphen puts them (970 hyphenated and 5,869 other on 10-28), until
 * `reindex-punctuated-names.ts` has run. That one checks the deployed trigger
 * before it writes. This one, written when the deployed trigger still
 * re-indexed only on a rename, checks nothing: run before the function is
 * deployed, every write it made would be undone by the trigger a moment later.
 * Use the other.
 *
 * Each write is the field alone, conditional on the node being as it was
 * read: a rename landing in between fails the run rather than being answered
 * with the old name's index, and a re-run picks up from there. Each fires the
 * trigger once, which finds the index up to date and writes nothing.
 *
 * Usage, against the running dev:prod-data emulator:
 *   npx tsx scripts/migrate/reindex-hyphenated-names.ts            # dry run
 *   npx tsx scripts/migrate/reindex-hyphenated-names.ts --commit
 * Against production:
 *   npx tsx scripts/migrate/reindex-hyphenated-names.ts --prod
 *   npx tsx scripts/migrate/reindex-hyphenated-names.ts --prod --commit
 */

/** The kinds `/api/search` reads, which are the kinds the trigger indexes. */
const SEARCHED = new Set(["person", "place", "region"]);

/** One node's new index, and whether it is a hyphen that made it new. */
export type Reindex = {
  id: string;
  type: string;
  name: string;
  chunks: string[];
  hyphenated: boolean;
};

/** The nodes whose stored index is not the one their name gives now, by the
 * trigger's own comparison. Anything search does not read, or without a name
 * to index, is not looked at. */
export function plan(
  nodes: Array<{ id: string; data: Record<string, unknown> }>,
): Reindex[] {
  const rewrites: Reindex[] = [];
  for (const { id, data } of nodes) {
    const { type, name } = data;
    if (typeof type !== "string" || !SEARCHED.has(type)) continue;
    if (typeof name !== "string" || !name) continue;
    const chunks = nameChunksToWrite(name, data.nameChunksLower, type);
    if (!chunks) continue;
    rewrites.push({ id, type, name, chunks, hyphenated: name.includes("-") });
  }
  return rewrites;
}

/** "41 person, 586 place" - how many of each kind. */
function byType(rewrites: Reindex[]): string {
  const counts = new Map<string, number>();
  for (const { type } of rewrites) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${count} ${type}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }

  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );

  // The three fields the decision needs. The whole collection either way -
  // Firestore cannot ask for a name holding a hyphen - but not the bodies.
  const snapshot = await db
    .collection("nodes")
    .select("type", "name", "nameChunksLower")
    .get();
  console.log(`Scanning ${snapshot.docs.length} node(s).`);

  const docs = new Map<string, QueryDocumentSnapshot>(
    snapshot.docs.map((doc) => [doc.id, doc]),
  );
  const rewrites = plan(
    snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
  const hyphenated = rewrites.filter((one) => one.hyphenated);
  const other = rewrites.filter((one) => !one.hyphenated);

  console.log(`Hyphenated names to re-index: ${byType(hyphenated)}`);
  console.log(`Other out-of-date indexes: ${byType(other)}`);
  for (const one of rewrites.slice(0, 10)) {
    console.log(`  ${one.id} ${JSON.stringify(one.name)}`);
  }

  if (!commit) {
    console.log("Dry run - nothing written.");
    reportRemaining({ hyphenated: hyphenated.length, other: other.length });
    return;
  }

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const one of rewrites) {
    const doc = docs.get(one.id)!;
    batch.update(
      doc.ref,
      { nameChunksLower: one.chunks },
      { lastUpdateTime: doc.updateTime },
    );
    pending++;
    if (pending === 400) {
      await batch.commit();
      written += pending;
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    written += pending;
  }

  console.log(`Re-indexed ${written} node(s).`);
  console.log("Re-run the dry run: it must report nothing left to do.");
}

// Importable by the tests, which check the decision without Firestore. Same
// guard as `backfill-name-source.ts`.
if (process.argv[1]?.endsWith("reindex-hyphenated-names.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
