import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeUpdateTime } from "../../shared/revisions";

/**
 * One-time migration: retype the region→company `owns` edges that hold a
 * company's seat to `seat`.
 *
 * `owns` meant two different things and nobody had to choose, because only one
 * of them was ever written. A region→company edge was the company's *seat* -
 * `regionsByPlaceId` says so outright, and it is what the „Siedziba spółki"
 * filter and the location column on /eksploruj read. Real ownership existed on
 * 115 place→place edges and nowhere else.
 *
 * Ingesting the register's shareholder lists ends that. KRS names a gmina, a
 * powiat or a województwo as the owner of 1,675 companies, and those edges run
 * region→company too. Left as `owns` they would be indistinguishable from a
 * seat, and worse than indistinguishable: `regionsByPlaceId` resolves two
 * claimants by TERYT length, so Gmina Miasta Gdańsk (`teryt2261`, 4 chars)
 * holding 10.7% of Gdynia-seated PKP SKM (`teryt2262`, 4 chars) would tie, and
 * the company's displayed location would depend on which region the loop
 * reached first.
 *
 * So the seat gets its own type and `owns` keeps only its honest meaning.
 *
 * IT HAS RUN, on 2026-08-29. The 02:00 export that day holds 3,962
 * region→place `owns` edges and no `seat` edge; the next morning's holds 3,628
 * `seat` edges under those same random ids and 334 at `edge_<s>_<t>_seat`, each
 * with its revisions repointed - which only this script does. The company
 * upload that started at 13:45 the same day was the first to write shareholder
 * edges, and since then every region→place `owns` edge is one: 1,799 on the
 * 2026-10-09 export, 1,795 of them a region that day's `companies_merged`
 * lists among that company's owners.
 *
 * So the predicate is no longer "region→place `owns`". Run with that predicate
 * today, this script would turn every shareholder into a second seat - 1,661
 * of them in a region other than the company's seat. It now retypes an `owns`
 * edge only if it was CREATED BEFORE `SPLIT_LIVE_AT`, the creation time being
 * the edge's earliest revision. That is the one fact that separates the two:
 * both are `{source, target, type: "owns"}` written by the same uploader, field
 * for field. The instant sits in the gap the data leaves - the newest seat the
 * old code wrote is from 2026-08-27T18:44Z, and the first edge the new code
 * wrote is from 2026-08-29T13:45Z, an owner. An edge with no revision to date
 * it by is reported and left alone: none exists today, and guessing would be
 * guessing at a seat.
 *
 * WHEN A SEAT FOR THE PAIR ALREADY EXISTS. The 10-06 dry run stopped on 38 taken
 * `_seat` ids (41 on 10-09). Every one is a powiat that both seats and owns the
 * company - mostly powiat hospitals and bus companies - so there was nothing to
 * move: the `owns` edge is the register's shareholder and the `seat` edge is the
 * seat. 35 were written by one company ingest request, the owner first and the
 * seat 100-250 ms later: `createEdge`'s guard against writing a seat beside an
 * `owns` edge queries Firestore, which cannot see the owner edge still sitting in
 * that request's batch. The other 6 seats are ones this script moved on 08-29,
 * with an owner edge for the same powiat written afterwards. Created after the
 * split, all 41 now count as shareholders and are left alone.
 *
 * For a seat that genuinely is stored as `owns` (none today), a seat edge for
 * the same pair is handled rather than overwritten:
 *
 *   the stored seat says the same thing - every field equal but the type and
 *     the revision pointer - so the `owns` copy is DROPPED, and its revisions
 *     are repointed to the seat, `data.type` with them. Repointed, not deleted,
 *     for the reason `fix-stale-seats.ts` gives: deleting the last revision for
 *     an id is what mints a phantom node.
 *   anything else - the two disagree about `published`, `deleted`, dates or
 *     references, the pair has several seats, the company is seated in another
 *     region, or the `_seat` id is held by something else - is printed in full
 *     and skipped, for a hand to decide.
 *
 * Nothing is ever written over: a move uses `create`, which fails rather than
 * replace a document that appeared at the new id after the plan was made, and a
 * drop re-reads the seat inside a transaction before deleting anything.
 *
 * WHAT THIS TOUCHES, and what it deliberately does not:
 *
 *   region→place, created before the split   retyped to `seat`.
 *   region→place, created after it           left as `owns`: shareholders.
 *   region→region                            left as `owns`. The hierarchy is
 *                         not the confusing case - a województwo does contain a
 *                         powiat - and no ownership edge will ever be written
 *                         between two regions, so it cannot collide. If it is
 *                         ever retyped it must be `contains`, never `seat`:
 *                         giving the hierarchy the seat type puts child regions
 *                         straight back into the bucket `regionsByPlaceId` reads.
 *   place→place                              left as `owns`. Already the honest
 *                         meaning.
 *
 * THE REVISIONS ARE NOT OPTIONAL. 3,900 revisions pointed at the seats and
 * every one carried `data.type: "owns"`. `applyRevision` layers revision data
 * over the document, so an edge retyped here and left with an `owns` revision
 * silently reverts the next time anybody approves it. Same reasoning as
 * `unwrap-array-fields.ts`.
 *
 * TWO SHAPES OF EDGE, because `edgeDocumentId` derives the id from
 * source+target+type for a state edge:
 *
 *   a random id, from before the ids were derived (3,628 on 08-29). Nothing
 *     reads the id - `findEdge` queries on (source, target, type) - so `update`
 *     is enough and the document, its revision pointer, its `published` flag
 *     and its `references` all stay put.
 *   `edge_<source>_<target>_owns` (334). Those must move, and not for tidiness:
 *     the KRS work writes `createEdge(region, company, "owns")` for a gmina
 *     owner, `edgeDocumentId` computes that same id, `findEdge` misses on the
 *     type, and `createRevisionTransaction` does `batch.set` - overwriting the
 *     seat. The common case, since a gmina usually owns the company seated in
 *     it.
 *
 * NO --reverse any more. It undid the retype for every region→place seat,
 * which stopped being an undo once shareholders arrived: it would fold the
 * 1,582 seats the ingest has written since into the type the 1,799 owners use,
 * and land 41 of them on an owner's id.
 *
 * ORDER, as it was: the readers - `computeNodes.post.ts`, `functions/edges.ts`,
 * `nodeFilters.ts` and `companyLocation.ts` - accept `owns` *and* `seat`, so
 * the site was correct before, during and after.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/split-seat-edges.ts            # dry run
 *   npx tsx scripts/migrate/split-seat-edges.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/split-seat-edges.ts --prod             # dry run
 *   npx tsx scripts/migrate/split-seat-edges.ts --prod --commit
 */

const FROM = "owns";
const TO = "seat";

/** No `owns` edge created at or after this instant holds a seat.
 *
 * Any instant between the newest seat the old code wrote
 * (2026-08-27T18:44:41Z) and the first edge the new code wrote
 * (2026-08-29T13:45:25Z, an owner) draws the same line; see the docstring. */
export const SPLIT_LIVE_AT = "2026-08-29T00:00:00.000Z";

/** Firestore's own cap is 500; the repo has settled on 400. */
const BATCH_SIZE = 400;

/** An edge document with its id, as read. */
export type StoredEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
} & Record<string, unknown>;

/** When an edge was written: its earliest revision's `update_time`, in ms.
 *
 * Null when no revision carries a time that parses, which is reported rather
 * than guessed at. */
export function edgeCreatedAt(updateTimes: unknown[]): number | null {
  let earliest: number | null = null;
  for (const raw of updateTimes) {
    const iso = normalizeUpdateTime(raw);
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ms)) continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

/** Keys that differ between two copies of one fact without the fact differing:
 * the type is what this migration changes, and each copy points at its own
 * revision. */
const NOT_THE_ASSERTION = new Set(["id", "type", "revision_id"]);

/** A field value reduced to something two documents can be compared by.
 *
 * Blank is blank, whoever wrote it: /api/edges/create stores `""` and `false`
 * where the ingest stores nothing, as `edgeIdentity` already allows for. A
 * Timestamp compares by its instant and a DocumentReference by its path - both
 * would otherwise compare by their internals. */
function comparable(value: unknown): unknown {
  if (value === undefined || value === null || value === "" || value === false)
    return null;
  if (Array.isArray(value)) {
    return value.length === 0 ? null : value.map(comparable);
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.toDate === "function") {
      return (object.toDate as () => Date)().toISOString();
    }
    if (typeof object.path === "string" && "firestore" in object) {
      return `ref:${object.path}`;
    }
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, comparable(object[key])]),
    );
  }
  return value;
}

/** The fields on which a stored `owns` copy and a stored seat disagree. */
export function differences(
  owns: Record<string, unknown>,
  seat: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(owns), ...Object.keys(seat)]);
  return [...keys]
    .filter((key) => !NOT_THE_ASSERTION.has(key))
    .filter(
      (key) =>
        JSON.stringify(comparable(owns[key])) !==
        JSON.stringify(comparable(seat[key])),
    )
    .sort();
}

export type SeatPlan =
  /** Created after the split: the register's shareholder. Left alone. */
  | { action: "shareholder" }
  /** No revision to date it by. Reported, left alone. */
  | { action: "undated" }
  /** A random id: the type is the only thing that changes. */
  | { action: "update" }
  /** `edge_<s>_<t>_owns`: set at the `_seat` id, delete the old one. */
  | { action: "move"; newId: string }
  /** A seat for the pair already says the same: delete this copy, repoint its
   * revisions to that seat. */
  | { action: "drop"; into: string }
  /** Something a hand has to decide; printed in full. */
  | { action: "skip"; reason: string; others: string[] };

/** What to do with one region→place `owns` edge.
 *
 * `seatsOfCompany` is every stored `seat` edge whose target is this company,
 * removed ones included. `takenBy` is whatever document holds this edge's
 * `_seat` id, if one does.
 */
export function planSeat(
  edge: StoredEdge,
  createdAt: number | null,
  context: { seatsOfCompany: StoredEdge[]; takenBy?: StoredEdge },
): SeatPlan {
  if (createdAt === null) return { action: "undated" };
  if (createdAt >= Date.parse(SPLIT_LIVE_AT)) return { action: "shareholder" };

  const { source, target } = edge;
  const newId = `edge_${source}_${target}_${TO}`;
  const twins = context.seatsOfCompany.filter((seat) => seat.source === source);

  if (twins.length > 1) {
    return {
      action: "skip",
      reason: `${twins.length} seats are already stored for this pair`,
      others: twins.map((seat) => seat.id),
    };
  }
  const twin = twins[0];
  if (twin) {
    const differ = differences(edge, twin);
    if (differ.length > 0) {
      return {
        action: "skip",
        reason: `the stored seat disagrees about ${differ.join(", ")}`,
        others: [twin.id],
      };
    }
    return { action: "drop", into: twin.id };
  }

  // A removed seat is not a competing claim, as `findSeatFromAnotherRegion`
  // in the company ingest also reads it.
  const elsewhere = context.seatsOfCompany.filter(
    (seat) => seat.deleted !== true,
  );
  if (elsewhere.length > 0) {
    return {
      action: "skip",
      reason: `the company is already seated in ${elsewhere.map((seat) => seat.source).join(", ")}`,
      others: elsewhere.map((seat) => seat.id),
    };
  }

  if (edge.id !== `edge_${source}_${target}_${FROM}`)
    return { action: "update" };
  if (context.takenBy) {
    return {
      action: "skip",
      reason: `${newId} is already held by a ${String(context.takenBy.type)} edge`,
      others: [context.takenBy.id],
    };
  }
  return { action: "move", newId };
}

function asStored(doc: FirebaseFirestore.DocumentSnapshot): StoredEdge {
  return { ...doc.data(), id: doc.id } as StoredEdge;
}

/** An edge as one line a person can read: a reference by its path and a
 * timestamp by its instant, rather than the SDK's internals. */
function printable(edge: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(edge).map(([key, value]) => {
        const object = value as Record<string, unknown> | null;
        if (object && typeof object === "object") {
          if (typeof object.toDate === "function") {
            return [key, (object.toDate as () => Date)().toISOString()];
          }
          if (typeof object.path === "string" && "firestore" in object) {
            return [key, object.path];
          }
        }
        return [key, value];
      }),
    ),
  );
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  if (process.argv.includes("--reverse")) {
    console.error(
      "--reverse is gone: undoing the retype would fold the seats written " +
        "since 2026-08-29 into the shareholders' type. See the docstring.",
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

  console.info(`Reading nodes to tell a region from a company...`);
  const nodesSnapshot = await db.collection("nodes").get();
  const nodeType: Record<string, string | undefined> = {};
  for (const doc of nodesSnapshot.docs) {
    nodeType[doc.id] = doc.data().type;
  }
  console.info(`  ${nodesSnapshot.size} nodes`);

  console.info(`Reading ${FROM} and ${TO} edges...`);
  const edgesSnapshot = await db
    .collection("edges")
    .where("type", "==", FROM)
    .get();
  const seatSnapshot = await db
    .collection("edges")
    .where("type", "==", TO)
    .get();
  console.info(`  ${edgesSnapshot.size} ${FROM} edges`);
  console.info(`  ${seatSnapshot.size} ${TO} edges`);

  const seatsByCompany = new Map<string, StoredEdge[]>();
  const seatById = new Map<string, StoredEdge>();
  for (const doc of seatSnapshot.docs) {
    const seat = asStored(doc);
    seatById.set(seat.id, seat);
    seatsByCompany.set(seat.target, [
      ...(seatsByCompany.get(seat.target) ?? []),
      seat,
    ]);
  }

  const regionToPlace: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const counts = { regionToRegion: 0, placeToPlace: 0, otherOrUnknown: 0 };
  for (const doc of edgesSnapshot.docs) {
    const { source, target } = doc.data();
    const sourceType = nodeType[source];
    const targetType = nodeType[target];
    if (sourceType === "region" && targetType === "place") {
      regionToPlace.push(doc);
    } else if (sourceType === "region" && targetType === "region") {
      counts.regionToRegion += 1;
    } else if (sourceType === "place" && targetType === "place") {
      counts.placeToPlace += 1;
    } else {
      // An endpoint that is missing or is neither: reported, never guessed at.
      counts.otherOrUnknown += 1;
    }
  }

  // The revisions that point at each edge: they date it, and `data.type` moves
  // with it. Every revision, not `where("collection","==","edges")`: that field
  // is missing from most of the old ones. One full read, once.
  console.info(`Reading revisions...`);
  const revisionsByTarget = new Map<
    string,
    FirebaseFirestore.QueryDocumentSnapshot[]
  >();
  const allRevisions = await db.collection("revisions").get();
  for (const doc of allRevisions.docs) {
    const nodeId = doc.data().node_id;
    if (typeof nodeId !== "string") continue;
    const list = revisionsByTarget.get(nodeId);
    if (list) list.push(doc);
    else revisionsByTarget.set(nodeId, [doc]);
  }
  console.info(`  ${allRevisions.size} revisions`);

  const revisionsOf = (id: string) => revisionsByTarget.get(id) ?? [];
  const createdAt = new Map(
    regionToPlace.map((doc) => [
      doc.id,
      edgeCreatedAt(revisionsOf(doc.id).map((r) => r.data().update_time)),
    ]),
  );

  // Whatever holds a would-be `_seat` id, read only for the edges that would
  // move: before the split, with a derived id.
  const splitLive = Date.parse(SPLIT_LIVE_AT);
  const wouldMove = regionToPlace.filter((doc) => {
    const at = createdAt.get(doc.id);
    const { source, target } = doc.data();
    return (
      at !== null &&
      at !== undefined &&
      at < splitLive &&
      doc.id === `edge_${source}_${target}_${FROM}`
    );
  });
  const takenById = new Map<string, StoredEdge>();
  for (let i = 0; i < wouldMove.length; i += 100) {
    const refs = wouldMove.slice(i, i + 100).map((doc) => {
      const { source, target } = doc.data();
      return db.collection("edges").doc(`edge_${source}_${target}_${TO}`);
    });
    for (const doc of await db.getAll(...refs)) {
      if (doc.exists) takenById.set(doc.id, asStored(doc));
    }
  }

  const plans = regionToPlace.map((doc) => {
    const edge = asStored(doc);
    return {
      doc,
      edge,
      plan: planSeat(edge, createdAt.get(doc.id) ?? null, {
        seatsOfCompany: seatsByCompany.get(edge.target) ?? [],
        takenBy: takenById.get(`edge_${edge.source}_${edge.target}_${TO}`),
      }),
    };
  });
  const having = (action: SeatPlan["action"]) =>
    plans.filter((item) => item.plan.action === action);

  const shareholders = having("shareholder");
  const alsoSeat = shareholders.filter(({ edge }) =>
    (seatsByCompany.get(edge.target) ?? []).some(
      (seat) => seat.source === edge.source,
    ),
  );
  const atSeatId = alsoSeat.filter(({ edge }) =>
    seatById.has(`edge_${edge.source}_${edge.target}_${TO}`),
  );
  const updates = having("update");
  const moves = having("move");
  const drops = having("drop");
  const skips = having("skip");
  const undated = having("undated");
  const legacy = updates.length + moves.length + drops.length + skips.length;

  console.info(`\nOf the ${edgesSnapshot.size} ${FROM} edges:`);
  console.info(`  region -> place  ${regionToPlace.length}`);
  console.info(
    `    created after the split, shareholders    ${shareholders.length}  left alone`,
  );
  console.info(
    `      of which the same region is the seat   ${alsoSeat.length}  (${atSeatId.length} beside edge_<s>_<t>_${TO})`,
  );
  console.info(
    `    no revision to date it by                ${undated.length}  left alone`,
  );
  console.info(`    created before the split, seats          ${legacy}`);
  console.info(
    `      random id                -> update     ${updates.length}`,
  );
  console.info(`      derived id, id free      -> move       ${moves.length}`);
  console.info(`      a seat already says it   -> drop       ${drops.length}`);
  console.info(`      disagrees with a seat    -> skipped    ${skips.length}`);
  console.info(`  region -> region ${counts.regionToRegion}  left alone`);
  console.info(`  place  -> place  ${counts.placeToPlace}  left alone`);
  console.info(`  other/unknown    ${counts.otherOrUnknown}  left alone`);

  for (const { edge, plan } of skips) {
    if (plan.action !== "skip") continue;
    console.info(`\nSkipped ${edge.id}: ${plan.reason}`);
    const others = plan.others.map(
      (id) => seatById.get(id) ?? takenById.get(id),
    );
    for (const stored of [edge, ...others]) {
      if (!stored) continue;
      console.info(`  ${printable(stored)}`);
      for (const revision of revisionsOf(stored.id)) {
        const r = revision.data();
        console.info(
          `    revision ${revision.id} ${normalizeUpdateTime(r.update_time)} ` +
            `${r.update_user ?? "?"} status=${r.status ?? "-"}`,
        );
      }
    }
  }
  for (const { edge } of undated) {
    console.info(`\nUndated, left alone: ${printable(edge)}`);
  }

  // `data.type` on the revisions of edges retyped in place, so approving one
  // cannot revert the edge. Moved and dropped edges have every revision
  // repointed in their own batch.
  const updateRevisions = updates
    .flatMap(({ doc }) => revisionsOf(doc.id))
    .filter((revision) => revision.data().data?.type === FROM);
  const revisionsMoving = [...moves, ...drops].reduce(
    (sum, { doc }) => sum + revisionsOf(doc.id).length,
    0,
  );
  const writes =
    updates.length +
    updateRevisions.length +
    moves.length * 2 +
    drops.length +
    revisionsMoving;
  console.info(
    `\n${writes} document writes: ${updates.length} retyped in place, ` +
      `${moves.length} moved, ${drops.length} dropped, ` +
      `${updateRevisions.length + revisionsMoving} revisions.`,
  );

  if (!commit) {
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }
  if (writes === 0) {
    console.info("\nNothing to write.");
    return;
  }

  console.info(`\nRetyping ${FROM} -> ${TO}...`);

  // A. random-id seats: the type is the only thing that changes.
  await inBatches(db, updates, (batch, { doc }) => {
    batch.update(doc.ref, { type: TO });
  });
  await inBatches(db, updateRevisions, (batch, revision) => {
    batch.update(revision.ref, { "data.type": TO });
  });

  // B. derived-id seats: create at the new id, delete the old, repoint the
  // revisions. One batch per edge, so an edge is never half-moved, and an
  // interrupted run resumes because the predicate is "still the old type".
  // `create`, not `set`: a document that appeared at the new id since the
  // plan was made fails the batch instead of being replaced.
  let moved = 0;
  for (const { doc, plan } of moves) {
    if (plan.action !== "move") continue;
    const batch = db.batch();
    batch.create(db.collection("edges").doc(plan.newId), {
      ...doc.data(),
      type: TO,
    });
    batch.delete(doc.ref, { lastUpdateTime: doc.updateTime });
    for (const revision of revisionsOf(doc.id)) {
      batch.update(revision.ref, { node_id: plan.newId, "data.type": TO });
    }
    try {
      await batch.commit();
      moved += 1;
    } catch (error) {
      console.error(`  left ${doc.id} alone: ${String(error)}`);
    }
  }
  console.info(`  moved ${moved} of ${moves.length} derived-id edges`);

  // C. copies a stored seat already says: delete the copy and repoint its
  // revisions to the seat, after reading both again inside the transaction.
  let dropped = 0;
  for (const { doc, plan } of drops) {
    if (plan.action !== "drop") continue;
    try {
      await db.runTransaction(async (tx) => {
        const seatRef = db.collection("edges").doc(plan.into);
        const [seat, owns] = await Promise.all([
          tx.get(seatRef),
          tx.get(doc.ref),
        ]);
        if (!seat.exists || seat.data()?.type !== TO) {
          throw new Error(`${plan.into} is no longer a ${TO} edge`);
        }
        if (!owns.exists || owns.data()?.type !== FROM) {
          throw new Error(`${doc.id} is no longer a ${FROM} edge`);
        }
        const differ = differences(owns.data() ?? {}, seat.data() ?? {});
        if (differ.length > 0) {
          throw new Error(`they now disagree about ${differ.join(", ")}`);
        }
        tx.delete(doc.ref);
        for (const revision of revisionsOf(doc.id)) {
          tx.update(revision.ref, { node_id: plan.into, "data.type": TO });
        }
      });
      dropped += 1;
    } catch (error) {
      console.error(`  left ${doc.id} alone: ${String(error)}`);
    }
  }
  console.info(`  dropped ${dropped} of ${drops.length} copies`);

  console.info(
    `\nDone. Re-run the dry run: it must report no seat created before the split.`,
  );
  console.info(
    "Then recompute stats (POST /api/stats/computeNodes) so seatNodeIds is populated.",
  );
}

async function inBatches<T>(
  db: FirebaseFirestore.Firestore,
  items: T[],
  apply: (batch: FirebaseFirestore.WriteBatch, item: T) => void,
) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of chunk) apply(batch, item);
    await batch.commit();
    console.info(`  ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
  }
}

// Importable by the tests, which check the plan without touching Firestore.
// Same guard as `fix-stale-seats.ts`.
if (process.argv[1]?.endsWith("split-seat-edges.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
