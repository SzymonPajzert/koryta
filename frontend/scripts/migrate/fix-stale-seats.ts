import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Move the seats the register disagrees with to the region it names.
 *
 * 13 companies on the site are seated in the wrong place. ELZAT of Mikołów is
 * filed under Tarnów, Centrum Medyczne Żelazna of Warsaw under Olsztyn: their
 * stored seat predates the current register and is simply wrong. The company
 * ingest resolves them correctly now but deliberately will not act - a second
 * seat from a different region is a disagreement, not a second fact, so it logs
 * the conflict and leaves the stored edge alone (see `findSeatFromAnotherRegion`
 * in `server/api/ingest/company.post.ts`). This is the hand that resolves it.
 *
 * IT MOVES THE EDGE, it does not delete and recreate. The edge is the same
 * fact - this company sits somewhere - stated about the wrong region, so what
 * it needs is a correction, not a removal and a replacement. Keeping the
 * document keeps its revision history, its `published` flag and its
 * `references`, and the site never sees the company with two seats or none.
 *
 * TWO SHAPES OF EDGE, exactly as `split-seat-edges.ts` found:
 *
 *   a random id, from before ids were derived -> `update` the `source`.
 *     Nothing reads an edge's id; `findEdge` queries on (source, target, type).
 *
 *   `edge_<source>_<target>_seat` -> the document must MOVE. Leaving it at an
 *     id naming the old region is not untidiness, it is a live hazard: if that
 *     region ever legitimately becomes an owner or seat of this company,
 *     `createEdge` computes that same id, `findEdge` misses because the source
 *     no longer matches, and `createRevisionTransaction` does `batch.set` -
 *     silently overwriting the seat this script just corrected.
 *
 * THE REVISIONS ARE NOT OPTIONAL, and for the reason `split-seat-edges.ts`
 * gives about `data.type`: `applyRevision` layers a revision's data over the
 * document, so an edge moved here whose revisions still say the old region
 * reverts the next time anybody approves one. Every revision pointing at the
 * edge has its `data.source` corrected, and a moved edge has its revisions
 * repointed by `node_id` in the same batch.
 *
 * Revisions are corrected, never deleted. Deleting the last revision for an id
 * is what mints a phantom node: `functions/src/revisions.ts` reacts to an empty
 * revision list with `nodes/<node_id>.set({revisions: null}, {merge: true})`,
 * and `set` with merge creates the document - so a typeless, nameless node
 * appears under the edge's id. Repointing is an update, and it resolves to the
 * new id, which has revisions.
 *
 * WHAT IT WILL NOT DO:
 *   - touch a company with more than one seat. 65 arrive with a duplicate pair
 *     from before ids were derived; that is a different repair and collapsing
 *     them here would hide it.
 *   - move onto an id that is already taken. Checked first, and refused.
 *   - invent a region. A register TERYT with no node is reported and skipped -
 *     run `create-region-nodes.ts` first if there are any.
 *
 * The register's answer comes from the same payload the ingest would receive,
 * so the two cannot disagree about where a company belongs:
 *
 *   cd data/pipelines
 *   uv run koryta CompaniesPayloads --no-backup --refresh :ProcessWiki \
 *     --output stderr 2>/tmp/companies.jsonl
 *   cd ../frontend
 *   npx tsx scripts/migrate/fix-stale-seats.ts /tmp/companies.jsonl
 *
 * Usage:
 *   npx tsx scripts/migrate/fix-stale-seats.ts <file>            # dry run
 *   npx tsx scripts/migrate/fix-stale-seats.ts <file> --commit
 *   npx tsx scripts/migrate/fix-stale-seats.ts <file> --prod --commit
 *
 * Afterwards: POST /api/stats/computeNodes, so `seatNodeIds` and every
 * employee's `targetNodeIds` pick up the region that actually holds them.
 */

/** What the register says about one company's seat. */
export type Row = { krs: string; teryt: string };

/** The payload rows in a `CompaniesPayloads` dump.
 *
 * Takes the text rather than a path so it can be tested without a file, the
 * way `seed-public-institutions.ts` exposes its name list.
 *
 * Splits on `\r` as well as `\n`, and skips anything that is not JSON:
 * `koryta --output stderr` writes its rows to the stream tqdm draws progress
 * bars on, so a real dump carries hundreds of "Downloading files: 4it [...]"
 * lines between the payloads. Same parser shape as `create-region-nodes.ts`.
 */
export function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
      if (typeof row?.payload === "string") row = JSON.parse(row.payload);
    } catch {
      continue;
    }
    // `teryt_code` is what the pipeline emits; the uploader renames it to
    // `teryt` before posting, so accept whichever reached the file.
    const teryt = row?.teryt_code ?? row?.teryt;
    if (!row?.krs || typeof teryt !== "string" || !teryt.trim()) continue;
    const krs = String(row.krs).padStart(10, "0");
    // First wins. A dump re-run into the same file states each company twice,
    // and the two agree - taking one is what stops the edge being "moved" to
    // where it already is.
    if (seen.has(krs)) continue;
    seen.add(krs);
    rows.push({ krs, teryt: teryt.trim() });
  }
  return rows;
}

/** The region a seat TERYT resolves to, exactly as the ingest resolves it.
 *
 * Reimplemented rather than imported: `findRegionByTeryt` is not exported and
 * queries Firestore per call. The rule has to be the same one, or this script
 * would "correct" a seat to a region the next ingest disagrees with - so it is
 * the same two candidates in the same order. Exact code first, then the powiat
 * above it: a seat TERYT comes from `get_teryt` and is six digits, which
 * matches no gmina node (`Regions` mints those as WOJ+POW+GMI+RODZ) and falls
 * through to the powiat, which is where the site records a seat anyway.
 */
export function resolveRegionId(
  teryt: string,
  hasNode: (id: string) => boolean,
  regionIdByTeryt: (teryt: string) => string | undefined,
): string | null {
  const candidates = teryt.length > 4 ? [teryt, teryt.slice(0, 4)] : [teryt];
  for (const code of candidates) {
    if (hasNode(`teryt${code}`)) return `teryt${code}`;
    const byField = regionIdByTeryt(code);
    if (byField) return byField;
  }
  return null;
}

export type SeatPlan =
  | { action: "agrees" }
  /** A random id, from before ids were derived. Nothing reads an edge's id -
   * `findEdge` queries on (source, target, type) - so the document stays where
   * it is and keeps its revision pointer, `published` flag and `references`. */
  | { action: "update"; to: string }
  /** `edge_<source>_<target>_seat`. Leaving it at an id naming the old region
   * is not untidiness, it is a live hazard: if that region ever legitimately
   * becomes an owner or seat of this company, `createEdge` computes that same
   * id, `findEdge` misses because the source no longer matches, and
   * `createRevisionTransaction` does `batch.set` - silently overwriting the
   * seat this script just corrected. */
  | { action: "move"; to: string; newId: string };

/** What to do with one seat, given where the register puts the company. */
export function seatPlan(
  edge: { id: string; source: string; target: string },
  registerRegionId: string,
): SeatPlan {
  if (edge.source === registerRegionId) return { action: "agrees" };
  const derivedId = `edge_${edge.source}_${edge.target}_seat`;
  if (edge.id !== derivedId) return { action: "update", to: registerRegionId };
  return {
    action: "move",
    to: registerRegionId,
    newId: `edge_${registerRegionId}_${edge.target}_seat`,
  };
}

/** The ids a move would land on that a document already holds.
 *
 * A move is `batch.set` at the new id, and `set` overwrites whatever is there
 * without a word - so any of these refuses the whole run before it writes.
 * `exists` is the lookup, passed in so the check runs without Firestore.
 */
export async function takenMoveTargets(
  plans: Iterable<SeatPlan>,
  exists: (id: string) => Promise<boolean>,
): Promise<string[]> {
  const taken: string[] = [];
  for (const plan of plans) {
    if (plan.action !== "move") continue;
    if (await exists(plan.newId)) taken.push(plan.newId);
  }
  return taken;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

  if (!file) {
    console.error(
      "Usage: npx tsx scripts/migrate/fix-stale-seats.ts <companies.jsonl> [--commit] [--prod]",
    );
    process.exit(1);
  }

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "koryta-pl";
  }

  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");

  const rows = parseRows(readFileSync(file, "utf8"));
  console.info(`${rows.length} companies with a register seat in ${file}`);

  const nodes = await db.collection("nodes").get();
  const nodeById = new Map(nodes.docs.map((d) => [d.id, d.data()]));
  const placeByKrs = new Map<string, string>();
  const regionByTeryt = new Map<string, string>();
  for (const doc of nodes.docs) {
    const data = doc.data();
    if (data.type === "place" && data.krsNumber) {
      placeByKrs.set(String(data.krsNumber).padStart(10, "0"), doc.id);
    } else if (data.type === "region" && data.teryt) {
      regionByTeryt.set(String(data.teryt), doc.id);
    }
  }
  console.info(
    `${placeByKrs.size} companies and ${regionByTeryt.size} regions on the site`,
  );

  const resolveRegion = (teryt: string) =>
    resolveRegionId(
      teryt,
      (id) => nodeById.has(id),
      (code) => regionByTeryt.get(code),
    );

  const seatsByPlace = new Map<
    string,
    FirebaseFirestore.QueryDocumentSnapshot[]
  >();
  const edges = await db.collection("edges").get();
  for (const doc of edges.docs) {
    const edge = doc.data();
    if (edge.type !== "seat" || !edge.target) continue;
    // A seat somebody has already removed is not one this script has to move.
    if (edge.deleted === true) continue;
    seatsByPlace.set(edge.target, [
      ...(seatsByPlace.get(edge.target) ?? []),
      doc,
    ]);
  }

  const stale: {
    doc: FirebaseFirestore.QueryDocumentSnapshot;
    placeId: string;
    from: string;
    to: string;
    plan: SeatPlan;
  }[] = [];
  const counts = { agree: 0, notOnSite: 0, noSeat: 0, noRegion: 0, multi: 0 };

  for (const row of rows) {
    const placeId = placeByKrs.get(row.krs);
    if (!placeId) {
      counts.notOnSite += 1;
      continue;
    }
    const seats = seatsByPlace.get(placeId) ?? [];
    if (seats.length === 0) {
      counts.noSeat += 1;
      continue;
    }
    if (seats.length > 1) {
      // The 65 duplicate pairs, plus Koleje Śląskie claimed by two real
      // regions. Named rather than counted only, because collapsing them is a
      // different repair and this script must not appear to have done it.
      counts.multi += 1;
      continue;
    }
    const regionNodeId = resolveRegion(row.teryt);
    if (!regionNodeId) {
      counts.noRegion += 1;
      continue;
    }
    const seat = seats[0]!;
    const from = seat.data().source as string;
    if (from === regionNodeId) {
      counts.agree += 1;
      continue;
    }
    const plan = seatPlan(
      { id: seat.id, source: from, target: placeId },
      regionNodeId,
    );
    stale.push({ doc: seat, placeId, from, to: regionNodeId, plan });
  }

  console.info(`\n  ${counts.agree} seats agree with the register`);
  console.info(`  ${counts.notOnSite} companies are not on the site`);
  console.info(`  ${counts.noSeat} have no seat edge yet`);
  console.info(`  ${counts.multi} have more than one seat  (left alone)`);
  console.info(`  ${counts.noRegion} name a region with no node  (left alone)`);
  console.info(`\n${stale.length} seats to move:`);

  const nameOf = (id: string) => nodeById.get(id)?.name ?? id;
  for (const item of stale) {
    console.info(
      `  ${String(nameOf(item.placeId)).slice(0, 44).padEnd(46)}` +
        `${nameOf(item.from)} -> ${nameOf(item.to)}`,
    );
  }
  if (stale.length === 0) return;

  // Every revision pointing at one of these edges, so `data.source` moves with
  // it. Read whole rather than `where("collection","==","edges")`: that field
  // is set on 302 of the 47,684 stored revisions, so the narrow query would
  // miss almost all of them.
  const revisionsByTarget = new Map<
    string,
    FirebaseFirestore.QueryDocumentSnapshot[]
  >();
  const staleIds = new Set(stale.map((s) => s.doc.id));
  for (const doc of (await db.collection("revisions").get()).docs) {
    const nodeId = doc.data().node_id;
    if (typeof nodeId !== "string" || !staleIds.has(nodeId)) continue;
    revisionsByTarget.set(nodeId, [
      ...(revisionsByTarget.get(nodeId) ?? []),
      doc,
    ]);
  }

  const derived = stale.filter((s) => s.plan.action === "move");
  const inPlace = stale.filter((s) => s.plan.action === "update");
  console.info(`\n  ${inPlace.length} carry a random id  -> update in place`);
  console.info(`  ${derived.length} carry a derived id -> must move`);
  console.info(
    `  ${[...revisionsByTarget.values()].flat().length} revisions to correct`,
  );

  // A target id already in use would be silently overwritten by `set`.
  const collisions = await takenMoveTargets(
    derived.map((s) => s.plan),
    async (id) => (await db.collection("edges").doc(id).get()).exists,
  );
  if (collisions.length) {
    console.error(
      `\n${collisions.length} target ids are already taken; refusing to overwrite:`,
    );
    for (const id of collisions) console.error(`  ${id}`);
    process.exit(1);
  }

  if (!commit) {
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  // One batch per edge, so an edge is never half-moved: a batch is atomic, and
  // an interrupted run resumes because the predicate is "the source still
  // disagrees with the register".
  for (const item of stale) {
    const data = item.doc.data();
    const revisions = revisionsByTarget.get(item.doc.id) ?? [];
    const batch = db.batch();
    const isDerived = item.plan.action === "move";
    const newId = item.plan.action === "move" ? item.plan.newId : item.doc.id;

    if (isDerived) {
      batch.set(db.collection("edges").doc(newId), {
        ...data,
        source: item.to,
      });
      batch.delete(item.doc.ref);
    } else {
      batch.update(item.doc.ref, { source: item.to });
    }
    for (const revision of revisions) {
      batch.update(
        revision.ref,
        isDerived
          ? { node_id: newId, "data.source": item.to }
          : { "data.source": item.to },
      );
    }
    await batch.commit();
  }

  console.info(`\nMoved ${stale.length} seats.`);
  console.info("Re-run the dry run: it must report 0 seats to move.");
  console.info(
    "Then recompute stats (POST /api/stats/computeNodes) so seatNodeIds and " +
      "every employee's targetNodeIds follow the company.",
  );
}

// Importable by the tests, which check the parser and the move/update decision
// without touching Firestore. Same guard as `seed-public-institutions.ts`.
if (process.argv[1]?.endsWith("fix-stale-seats.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
