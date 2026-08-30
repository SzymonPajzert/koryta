import type { Firestore } from "firebase-admin/firestore";
import { normalizeUpdateTime } from "~~/shared/revisions";
import type { NodeType, Note, NoteRow, NoteSource } from "~~/shared/model";

type ResolvedNode = { name: string; type: NodeType };

/** `getAll` takes any number of refs but the request has to fit in one call,
 * so the ids are handed to it in batches. */
const NODE_BATCH = 300;

/** How long a resolved node name is reused. Names change when someone edits a
 * node, which is rare next to how often this list is paged and filtered. */
const NAME_CACHE_TTL_MS = 5 * 60_000;

/** Node names seen so far, `null` for ids that resolved to nothing so a broken
 * reference is not looked up again on every request. */
let nameCache: { builtAt: number; names: Record<string, ResolvedNode | null> } =
  { builtAt: 0, names: {} };

/** Forget the resolved names. Only used by tests - nothing in the app needs
 * to, since the cache ages out on its own. */
export function resetNoteNodeNames() {
  nameCache = { builtAt: 0, names: {} };
}

/** Every note entry there is, newest first, with node names joined on.
 *
 * Firestore cannot order or filter on fields nested inside an array, and
 * `sources` is exactly that - so there is no query that returns "the twenty
 * most recent unresolved change requests". The collection is small (it only
 * grows when a reader writes a note), so it is read whole, flattened here and
 * then filtered, sorted and paged in memory by the caller.
 *
 * The notes themselves are re-read every time. Caching them would mean a note
 * written a moment ago is missing from the queue that exists to triage it -
 * and the read is one query. It is the name join that is worth keeping, so
 * that is what the cache holds.
 */
export async function getNoteRows(db: Firestore): Promise<NoteRow[]> {
  const snapshot = await db.collection("notes").get();

  const rows: NoteRow[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as Note;
    // Only fields the author writes. `doc.updateTime` used to stand in for a
    // missing date, but triaging a source *is* a write to the document, so
    // every note without one jumped to the top of the queue the moment an
    // admin touched it - dated by the review rather than by the writing. Notes
    // older than these fields get a `createdAt` from
    // scripts/migrate/backfill-note-timestamps.ts; anything the migration has
    // not reached is left undated rather than given a misleading date.
    const createdAt = normalizeUpdateTime(data.createdAt);
    const updatedAt = normalizeUpdateTime(data.updatedAt);

    // Read as partial: nothing validates what a client writes into `sources`,
    // and this list is searched on, so a note missing its text must not throw.
    const sources: Partial<NoteSource>[] = data.sources ?? [];
    sources.forEach((source, sourceIndex) => {
      rows.push({
        key: `${doc.id}:${sourceIndex}`,
        noteId: doc.id,
        sourceIndex,
        nodeId: data.nodeId,
        nodeName: null,
        nodeType: null,
        userUid: data.userUid,
        createdAt,
        updatedAt,
        note: source.note ?? "",
        url: source.url || null,
        // Entries written before kinds existed are all sources.
        kind: source.kind ?? "source",
        articleNodeId: source.articleNodeId || null,
        adminStatus: source.adminStatus ?? null,
        adminType: source.adminType || null,
        adminTypeDeferred: source.adminTypeDeferred === true,
      });
    });
  }

  const names = await resolveNodes(
    db,
    [...new Set(rows.map((row) => row.nodeId))].filter(Boolean),
  );
  for (const row of rows) {
    const node = names[row.nodeId];
    row.nodeName = node?.name ?? null;
    row.nodeType = node?.type ?? null;
  }

  rows.sort(compareByRecency);
  return rows;
}

/** Newest first by when the note was written, with undated entries - notes
 * the backfill has not reached - at the end. */
function compareByRecency(a: NoteRow, b: NoteRow) {
  if (a.createdAt === b.createdAt) return 0;
  if (!a.createdAt) return 1;
  if (!b.createdAt) return -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

async function resolveNodes(
  db: Firestore,
  ids: string[],
): Promise<Record<string, ResolvedNode | null>> {
  if (nameCache.builtAt + NAME_CACHE_TTL_MS < Date.now()) {
    nameCache = { builtAt: Date.now(), names: {} };
  }
  const known = nameCache.names;

  const unknown = ids.filter((id) => !(id in known));
  for (let i = 0; i < unknown.length; i += NODE_BATCH) {
    const refs = unknown
      .slice(i, i + NODE_BATCH)
      .map((id) => db.collection("nodes").doc(id));
    for (const doc of await db.getAll(...refs)) {
      const data = doc.data();
      if (data?.name) known[doc.id] = { name: data.name, type: data.type };
    }
  }

  // Notes are commonly written on nodes a reader has only proposed, which live
  // in `revisions` and never reach `nodes`. There is no way to fetch those in
  // bulk, so they go one query each - in batches, because a broken join would
  // otherwise mean one query per note.
  const stillUnknown = unknown.filter((id) => !(id in known));
  for (let i = 0; i < stillUnknown.length; i += 20) {
    await Promise.all(
      stillUnknown.slice(i, i + 20).map(async (id) => {
        const snap = await db
          .collection("revisions")
          .where("node_id", "==", id)
          .orderBy("update_time", "desc")
          .limit(1)
          .get();
        const data = snap.docs[0]?.data().data;
        // Remembered either way, so an id that resolves to nothing does not
        // cost a query on every request.
        known[id] = data?.name ? { name: data.name, type: data.type } : null;
      }),
    );
  }

  return known;
}
