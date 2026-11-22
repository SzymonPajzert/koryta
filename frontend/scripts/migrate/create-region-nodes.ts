import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Create the region nodes the site is missing, from `RegionPayloads`.
 *
 * The site holds 16 województwa, 380 powiaty and 9 gminy. It needs many more
 * gminy now, because the register's shareholder lists name one as the owner of
 * 1,191 companies and an ownership edge has to point at a node. A real run of
 * `RegionPayloads` reports 985 gminy owning something, against the 9 stored.
 *
 * `RegionPayloads` has emitted these all along - `Regions` mints every gmina
 * with the seven-character `WOJ+POW+GMI+RODZ` id the nine existing ones already
 * use - but nothing consumed it. `koryta_uploader` has no `region` branch:
 * `--type region` falls through to the base `Uploader`, whose `TYPE_URLS` is
 * empty, so `submit_entity` raises `NotImplementedError`. (Since 2026-11-22
 * `koryta_uploader --type region` does this job through `/api/ingest/region`,
 * every gmina, renames and urzędy included; once that has run on production,
 * this script's dry run reports nothing left and it moves to archive/.)
 * Whatever created the 405 nodes on production predates the current uploader,
 * and nothing has posted a region payload since before `data/scrapers` was
 * renamed.
 *
 * So this reads the pipeline's answer from a file, the way
 * `apply-company-categories.ts` does, rather than inventing an API surface for
 * a node type nobody edits:
 *
 *   cd data/pipelines
 *   uv run koryta RegionPayloads --no-backup --refresh :ProcessWiki \
 *     --output stderr 2>/tmp/regions.jsonl
 *   cd ../frontend
 *   npx tsx scripts/migrate/create-region-nodes.ts /tmp/regions.jsonl
 *
 * Each row is `{entity_id, krs, teryt_powiat, payload}` where `payload` is a
 * JSON *string* holding `{node_id, type, name, teryt}` and, below województwo
 * level, an `edge` naming its parent.
 *
 * What it will not do:
 *   - touch a region that already exists. Re-running writes nothing, and the
 *     405 nodes already on the site keep whatever `stats` the recompute gave
 *     them; this only ever adds.
 *   - write a revision. A region is not a claim anybody argues about - it is
 *     the administrative division of Poland - and `RegionPayloads` carries no
 *     `revision_id` on purpose (read its comment about the 405 regions left
 *     pointing at revisions that never existed).
 *   - create an edge whose parent is missing. The node is still created,
 *     because the node is what an ownership edge needs; the hierarchy edge is
 *     a convenience and its absence is reported.
 *
 * The hierarchy edge stays `owns`, not `seat` - see
 * `scripts/migrate/split-seat-edges.ts` for why a województwo containing a
 * powiat is the one reading of `owns` that was always honest.
 *
 * Usage:
 *   npx tsx scripts/migrate/create-region-nodes.ts <file>            # dry run
 *   npx tsx scripts/migrate/create-region-nodes.ts <file> --commit
 *   npx tsx scripts/migrate/create-region-nodes.ts <file> --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!file) {
  console.error(
    "Usage: npx tsx scripts/migrate/create-region-nodes.ts <regions.jsonl> [--commit] [--prod]",
  );
  process.exit(1);
}

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Firestore's own cap is 500; the repo has settled on 400. */
const BATCH_SIZE = 400;

type RegionPayload = {
  node_id: string;
  type: string;
  name: string;
  teryt: string;
  edge?: { edge_id: string; source: string; target: string; type: string };
};

function parse(path: string): RegionPayload[] {
  const rows: RegionPayload[] = [];
  let skipped = 0;
  // Split on \r as well as \n: `koryta --output stderr` writes the payloads to
  // the same stream tqdm draws its progress bars on, and those end in carriage
  // returns. A real dump is 1,381 payloads and 642 lines of
  // "Downloading files: 4it [00:00, 5.23it/s]".
  for (const line of readFileSync(path, "utf8").split(/[\r\n]+/)) {
    const text = line.trim();
    if (!text || !text.startsWith("{")) continue;
    let payload;
    try {
      const row = JSON.parse(text);
      // The pipeline wraps its answer in a `payload` column as a JSON string;
      // accept a bare payload too, so a hand-made file works.
      payload = row.payload ? JSON.parse(row.payload) : row;
    } catch {
      skipped += 1;
      continue;
    }
    if (payload?.type !== "region" || !payload.node_id) continue;
    rows.push(payload as RegionPayload);
  }
  if (skipped) console.info(`  (skipped ${skipped} lines that were not JSON)`);
  return rows;
}

async function main() {
  const db = getFirestore(app, "koryta-pl");

  const payloads = parse(file!);
  console.info(`${payloads.length} region payloads in ${file}`);

  const existing = new Set(
    (await db.collection("nodes").where("type", "==", "region").get()).docs.map(
      (d) => d.id,
    ),
  );
  console.info(`${existing.size} region nodes already on the site`);

  const missing = payloads.filter((p) => !existing.has(p.node_id));
  const byLength = missing.reduce<Record<number, number>>((acc, p) => {
    acc[p.teryt.length] = (acc[p.teryt.length] ?? 0) + 1;
    return acc;
  }, {});
  console.info(`${missing.length} to create:`);
  for (const [len, count] of Object.entries(byLength).sort()) {
    const level =
      len === "2" ? "województwo" : len === "4" ? "powiat" : "gmina";
    console.info(`  ${count} ${level} (teryt length ${len})`);
  }

  const willExist = new Set([...existing, ...missing.map((p) => p.node_id)]);
  const orphaned = missing.filter(
    (p) => p.edge && !willExist.has(p.edge.source),
  );
  if (orphaned.length) {
    console.warn(
      `\n${orphaned.length} have a parent the site does not have; the node is created, the hierarchy edge is not:`,
    );
    for (const p of orphaned.slice(0, 5)) {
      console.warn(`  ${p.node_id} (${p.name}) -> ${p.edge!.source}`);
    }
  }

  const edges = missing.filter((p) => p.edge && willExist.has(p.edge.source));
  const existingEdges = new Set<string>();
  for (let i = 0; i < edges.length; i += 300) {
    const refs = edges
      .slice(i, i + 300)
      .map((p) => db.collection("edges").doc(p.edge!.edge_id));
    for (const doc of await db.getAll(...refs)) {
      if (doc.exists) existingEdges.add(doc.id);
    }
  }
  const newEdges = edges.filter((p) => !existingEdges.has(p.edge!.edge_id));

  console.info(
    `\n${missing.length} nodes + ${newEdges.length} hierarchy edges = ${missing.length + newEdges.length} writes`,
  );

  if (!commit) {
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const p of missing.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection("nodes").doc(p.node_id), {
        name: p.name,
        type: "region",
        teryt: p.teryt,
        published: true,
      });
    }
    await batch.commit();
    console.info(
      `  nodes ${Math.min(i + BATCH_SIZE, missing.length)}/${missing.length}`,
    );
  }

  for (let i = 0; i < newEdges.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const p of newEdges.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection("edges").doc(p.edge!.edge_id), {
        source: p.edge!.source,
        target: p.edge!.target,
        type: p.edge!.type,
        published: true,
      });
    }
    await batch.commit();
    console.info(
      `  edges ${Math.min(i + BATCH_SIZE, newEdges.length)}/${newEdges.length}`,
    );
  }

  console.info(
    `\nDone: ${missing.length} region nodes, ${newEdges.length} edges. Re-run the dry run; it must report 0 to create.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
