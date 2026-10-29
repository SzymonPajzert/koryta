import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { nameChunksToWrite, searchableText } from "../../../shared/search";
import { reportRemaining } from "../remaining";

/**
 * Re-index every searchable name whose stored `nameChunksLower` is not the
 * one `generateChunksLower` gives it now: above all the names the
 * punctuation of a register name used to cut wrongly.
 *
 * The index cut a name at its spaces only, so a quote or a bracket stayed on
 * the word beside it and every prefix of that word began with it. „krasne”
 * found no STADNINA KONI "KRASNE", „sanikom” no PRZEDSIĘBIORSTWO GOSPODARKI
 * KOMUNALNEJ "SANIKOM" (Lubawka), „kościuszko” no HUTA"KOŚCIUSZKO": on 10-27
 * and 10-28 a check of the Treasury list on the site read companies the site
 * has as missing. `searchableText` in `shared/search.ts` now cuts a word at
 * anything that is not a letter, a digit or a hyphen. The town in the bracket a
 * company or region name ends in goes into the prefixes of the whole name and
 * into marked chunks of its own, which only a query of several words asks for
 * (`QUALIFIER`, `townChunk`).
 *
 * Measured against the 2026-10-28 export, of 22,806 people, places and
 * regions: 6,839 to re-index - 6,811 places, 25 regions (a powiat's seat, a
 * Warsaw district's city) and 3 people („D'obyrn”, „ks. Michał”, a pseudonym
 * in brackets). Every other stored index already matched the cut before this
 * one, the hyphen re-index (`reindex-hyphenated-names.ts`) included. The index
 * shrinks, 1,019,242 chunks to 989,041, of which 55,728 are towns' marked ones.
 *
 * In this order, and back to back: roll the site out, deploy the function, run
 * this. The site first, because the old code reads the new index worse than
 * the new code reads the old one. Replayed over the 10-28 export, the old code
 * against the new index lost two people searched for by their full name, a hit
 * from 6 of the queries in the log, and 3,114 of the 6,811 companies with
 * punctuation in their name typed out in full. The new code against the old
 * index lost no person and nothing from the log, and 1,543 of those companies,
 * until this has run. The site means koryta.pl, not autopush alone, and the
 * order holds however the index gets rewritten: a deploy of the function by
 * itself re-indexes every node the next time anything writes it, which the
 * stats pass does to all of them, and rolling the site back afterwards leaves
 * the old code reading the new index. The function before this, because the trigger
 * (`onNodeWritten`, `functions/src/nodes.ts`) rewrites the index on any write
 * that finds it out of date by its own rule: while the deployed one still cuts
 * the old way, each write here would be answered by the old index a moment
 * later. So `--commit` checks before it writes in bulk. It stores the first
 * punctuated name's new index less its last chunk, and waits for the trigger to
 * complete it. The new rule puts back exactly the new index, and only then
 * does the run go on. Answered with anything else, the run stops, and that
 * node is left with the deployed trigger's own index, as it was before.
 *
 * Each write is the field alone, conditional on the node being as it was
 * read: a rename landing in between fails the run rather than being answered
 * with the old name's index, and a re-run picks up from there. Each fires the
 * trigger once, which finds the index up to date and writes nothing.

 *
 * Run on production on 2026-10-29, and archived. A count coming back means
 * something writes `nameChunksLower` by the old cut again: an onNodeWritten
 * deployed from before it, or a writer that builds the index by hand.
 *
 * Usage, against the running dev:prod-data emulator (`--no-trigger` where the
 * functions emulator is not running, so nothing would answer the check; it is
 * refused with `--prod`):
 *   npx tsx scripts/migrate/archive/reindex-punctuated-names.ts            # dry run
 *   npx tsx scripts/migrate/archive/reindex-punctuated-names.ts --commit
 * Against production, once the function is deployed:
 *   npx tsx scripts/migrate/archive/reindex-punctuated-names.ts --prod
 *   npx tsx scripts/migrate/archive/reindex-punctuated-names.ts --prod --commit
 */

/** The kinds `/api/search` reads, which are the kinds the trigger indexes. */
const SEARCHED = new Set(["person", "place", "region"]);

/** How long `--commit` waits for the trigger to answer its check, and how
 * often it looks. A deployed trigger answers within seconds; a cold start can
 * take a few more. */
const CHECK_TIMEOUT_MS = 90_000;
const CHECK_POLL_MS = 3_000;

/** One node's new index, and whether its punctuation is what made it new. */
export type Reindex = {
  id: string;
  type: string;
  name: string;
  chunks: string[];
  punctuated: boolean;
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
    rewrites.push({ id, type, name, chunks, punctuated: punctuated(name) });
  }
  return rewrites;
}

/** Whether the cut of 2026-10-28 reads the name differently from the one
 * before it, which trimmed, flattened and lowercased. */
function punctuated(name: string): boolean {
  return (
    searchableText(name) !== name.trim().replace(/\s+/g, " ").toLowerCase()
  );
}

/** What the check makes of the index it reads back off the node it wrote
 * `stale` to: `done` once the trigger has put back `expected`, `waiting` while
 * the node still holds what was written, and `old` for anything else - an
 * index the deployed trigger worked out by another rule. */
export function checkVerdict(
  stored: unknown,
  stale: string[],
  expected: string[],
): "done" | "waiting" | "old" {
  const read = JSON.stringify(stored);
  if (read === JSON.stringify(expected)) return "done";
  if (read === JSON.stringify(stale)) return "waiting";
  return "old";
}

/** "6,811 place, 25 region" - how many of each kind. */
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

/** Writes `one` less its last chunk and waits for the trigger to complete
 * it. True once it has; false, after saying why, when the run must stop. */
async function triggerCutsTheNewWay(
  ref: DocumentReference,
  snapshot: QueryDocumentSnapshot,
  one: Reindex,
): Promise<boolean> {
  const stale = one.chunks.slice(0, -1);
  await ref.update(
    { nameChunksLower: stale },
    { lastUpdateTime: snapshot.updateTime },
  );
  const deadline = Date.now() + CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_POLL_MS));
    const stored = (await ref.get()).get("nameChunksLower");
    const verdict = checkVerdict(stored, stale, one.chunks);
    if (verdict === "done") return true;
    if (verdict === "old") {
      console.error(
        `The trigger rewrote ${one.id} by another rule: the onNodeWritten ` +
          "in front of this database still cuts names the old way. " +
          (process.argv.includes("--prod")
            ? "Deploy the functions (firebase deploy --only functions:onNodeWritten)"
            : "Build the functions (npm --prefix functions run build), so the emulator loads the new trigger,") +
          " and run this again.",
      );
      return false;
    }
  }
  // Nothing answered. Leave the node as the run would have, and stop: a
  // database with no trigger in front of it is not the one this was written
  // for.
  await ref.update({ nameChunksLower: one.chunks });
  console.error(
    `No trigger answered for ${one.id} in ${CHECK_TIMEOUT_MS / 1000}s. ` +
      "Pass --no-trigger to re-index a database that has none.",
  );
  return false;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const noTrigger = process.argv.includes("--no-trigger");
  if (isProd && noTrigger) {
    // Production has the trigger, and skipping the check is how a run would
    // write its whole index for the deployed trigger to undo.
    throw new Error("--no-trigger is for an emulator without functions");
  }

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
  // Firestore cannot ask for a name holding a quote - but not the bodies.
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
  const punctuatedOnes = rewrites.filter((one) => one.punctuated);
  const other = rewrites.filter((one) => !one.punctuated);

  console.log(`Punctuated names to re-index: ${byType(punctuatedOnes)}`);
  console.log(`Other out-of-date indexes: ${byType(other)}`);
  for (const one of rewrites.slice(0, 10)) {
    console.log(`  ${one.id} ${JSON.stringify(one.name)}`);
  }

  if (!commit) {
    console.log("Dry run - nothing written.");
    reportRemaining({
      punctuated: punctuatedOnes.length,
      other: other.length,
    });
    return;
  }
  if (rewrites.length === 0) {
    console.log("Nothing to re-index.");
    return;
  }

  // Checked on a punctuated name: on any other the old cut and the new one
  // agree, so the old trigger would complete it just the same. Where there is
  // none, there is nothing the two would write differently.
  const probe = noTrigger ? undefined : punctuatedOnes[0];
  if (probe) {
    const doc = docs.get(probe.id)!;
    if (!(await triggerCutsTheNewWay(doc.ref, doc, probe))) {
      process.exitCode = 1;
      return;
    }
    console.log(`The trigger cuts names the new way (checked on ${probe.id}).`);
  }

  let batch = db.batch();
  let pending = 0;
  let written = probe ? 1 : 0;
  for (const one of rewrites) {
    if (one === probe) continue;
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
// guard as `reindex-hyphenated-names.ts`.
if (process.argv[1]?.endsWith("reindex-punctuated-names.ts")) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
