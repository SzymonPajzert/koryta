import type { Firestore, Query } from "firebase-admin/firestore";
import { pageIsPublic, revisionCollection } from "~~/shared/model";
import { relationSubject, type StoredStatusFilter } from "~~/shared/proposals";
import { nodeTypeOf, targetIdOf } from "~~/server/utils/revisionQueue";

/** How many revisions one scan reads before its answer is a lower bound. The
 * pending queue held 20,956 in the 2026-10-06 export, 20,523 of them the
 * pipeline's, so this takes it whole with room for some weeks of nightly
 * imports; the approved history is longer, and says so. */
export const QUEUE_SCAN_CAP = 30_000;

/** How long one scan is reused: long enough to page through a list and flip
 * its filters, short enough that a proposal filed meanwhile turns up soon. */
const SCAN_TTL_MS = 2 * 60_000;

/** Documents per `getAll`. */
const READ_CHUNK = 500;

/** One revision of a scan, reduced to what the queue filters and groups by. */
export type QueuedRevision = {
  id: string;
  /** The entry it is about - `ProposalSubject.id`. */
  subjectId: string;
  /** Whether that entry is live. */
  published: boolean;
  /** Who filed it, for "Bez moich" - a filter over the scan rather than a scan
   * of its own. Null on the few written before `update_user` was. */
  updateUser: string | null;
};

export type QueueScan = {
  /** Newest first, as the queue lists them. */
  rows: QueuedRevision[];
  /** The scan hit `QUEUE_SCAN_CAP`, so older revisions are not in it. */
  truncated: boolean;
};

type ScanFilters = {
  status: StoredStatusFilter;
  automatic: "true" | "false" | "all";
};

const scans = new Map<
  string,
  { filters: ScanFilters; expires: number; scan: Promise<QueueScan> }
>();

/**
 * Every revision the queue's two Firestore filters match, with the entry each
 * is about and whether that entry is live.
 *
 * What the "Wpis" filter and the grouping ask about is a property of a
 * revision's *target*, which no Firestore clause on `revisions` can reach - and
 * a page of 25 cannot be grouped or filtered without the rest of the list. So
 * the list is read whole, masked to the fields that name a target, and the
 * targets after it, masked to their type and visibility.
 *
 * That is the expensive read the aggregate queue was built to avoid, and it
 * only runs when one of the two asks for it. On the 2026-10-06 export the
 * pending proposals from people cost 433 reads and 391 more for their nodes;
 * the pipeline's cost 20,523 and 5,047, for the 425 of them, on 171 people,
 * that were about a live page. Hence the cache: a reviewer pages through and
 * flips filters on one scan rather than on one each. The rows of a page are
 * still read fresh, so a scan never shows a decision as undecided - see
 * `/api/revisions/queue`.
 */
export function scanQueue(
  db: Firestore,
  filters: ScanFilters,
): Promise<QueueScan> {
  const key = `${filters.status}|${filters.automatic}`;
  const now = Date.now();
  const held = scans.get(key);
  if (held && held.expires > now) return held.scan;

  const scan = readScan(db, filters);
  scans.set(key, { filters, expires: now + SCAN_TTL_MS, scan });
  // A failed read is not kept: the next request tries again.
  scan.catch(() => {
    if (scans.get(key)?.scan === scan) scans.delete(key);
  });
  return scan;
}

/** Brings the scans held up to date with a decision on `revisionId`.
 *
 * Without it the counts the page reads next would still include what the
 * reviewer has just settled, for as long as the scan is held. A scan of pending
 * revisions loses it; one of the state it has moved to cannot be patched -
 * nothing here knows where in its order it goes - so it is dropped and read
 * again when next asked for. A scan of every state is still right. Another
 * server instance's scans catch up when they expire. */
export function forgetQueued(
  revisionId: string,
  decision: "approved" | "rejected",
): void {
  for (const [key, held] of scans) {
    if (held.filters.status === decision) {
      scans.delete(key);
    } else if (held.filters.status === "pending") {
      held.scan = held.scan.then(({ rows, truncated }) => ({
        rows: rows.filter((row) => row.id !== revisionId),
        truncated,
      }));
    }
  }
}

/** For tests: forget every scan. */
export function clearQueueScans(): void {
  scans.clear();
}

async function readScan(
  db: Firestore,
  { status, automatic }: ScanFilters,
): Promise<QueueScan> {
  // The same clauses, and so the same index, as the aggregate queue.
  let query: Query = db.collection("revisions");
  if (automatic !== "all") {
    query = query.where("update_automatic", "==", automatic === "true");
  }
  if (status !== "all") {
    query = query.where("status", "==", status);
  }
  const snapshot = await query
    .orderBy("update_time", "desc")
    .select(
      "node_id",
      "nodeId",
      "collection",
      "data.source",
      "data.target",
      "update_user",
    )
    .limit(QUEUE_SCAN_CAP)
    .get();

  const revisions = snapshot.docs.map((doc) => {
    const data = doc.data();
    const proposed = (data.data ?? {}) as Record<string, unknown>;
    return {
      id: doc.id,
      collection: revisionCollection(data),
      targetId: targetIdOf(doc) ?? "",
      source: idField(proposed.source),
      target: idField(proposed.target),
      updateUser: idField(data.update_user) ?? null,
    };
  });

  // A relation revision that names neither end - one that only moves a date -
  // is read off the stored edge, as the queue's rows read it.
  const bare = revisions.filter(
    (row) =>
      row.collection === "edges" &&
      row.targetId &&
      (!row.source || !row.target),
  );
  const edges = await readMasked(
    db,
    "edges",
    bare.map((row) => row.targetId),
    ["source", "target"],
  );
  for (const row of bare) {
    const edge = edges.get(row.targetId) ?? {};
    row.source ??= idField(edge.source);
    row.target ??= idField(edge.target);
  }

  // A relation's target is only read when its source is not a person, since
  // only then can it decide what the relation is about. Nearly every relation
  // the pipeline proposes starts at a person, which halves its reads.
  const nodeFields = ["type", "published", "deleted"];
  const nodes = await readMasked(
    db,
    "nodes",
    revisions.flatMap((row) =>
      row.collection === "nodes"
        ? [row.targetId]
        : row.source
          ? [row.source]
          : [],
    ),
    nodeFields,
  );
  const targets = await readMasked(
    db,
    "nodes",
    revisions.flatMap((row) =>
      row.collection === "edges" &&
      row.target &&
      !nodes.has(row.target) &&
      nodeTypeOf(nodes.get(row.source ?? "") ?? {}) !== "person"
        ? [row.target]
        : [],
    ),
    nodeFields,
  );
  for (const [id, data] of targets) nodes.set(id, data);

  const end = (id: string | undefined) => {
    const data = id ? nodes.get(id) : undefined;
    return id && data
      ? { id, type: nodeTypeOf(data), published: pageIsPublic(data) }
      : undefined;
  };

  const rows = revisions.map((row): QueuedRevision => {
    const { id, updateUser } = row;
    if (row.collection === "nodes") {
      const data = nodes.get(row.targetId);
      return {
        id,
        subjectId: row.targetId,
        published: data ? pageIsPublic(data) : false,
        updateUser,
      };
    }
    const subject = relationSubject(end(row.source), end(row.target));
    return subject
      ? { id, subjectId: subject.id, published: subject.published, updateUser }
      : { id, subjectId: row.targetId, published: false, updateUser };
  });

  return { rows, truncated: snapshot.size >= QUEUE_SCAN_CAP };
}

/** The documents of `ids` that exist, masked to `fieldMask`, in batches. */
async function readMasked(
  db: Firestore,
  collection: string,
  ids: string[],
  fieldMask: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += READ_CHUNK) {
    chunks.push(wanted.slice(i, i + READ_CHUNK));
  }
  const batches = await Promise.all(
    chunks.map((chunk) =>
      db.getAll(...chunk.map((id) => db.collection(collection).doc(id)), {
        fieldMask,
      }),
    ),
  );

  const found = new Map<string, Record<string, unknown>>();
  for (const snapshot of batches.flat()) {
    if (snapshot.exists) found.set(snapshot.id, snapshot.data() ?? {});
  }
  return found;
}

function idField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
