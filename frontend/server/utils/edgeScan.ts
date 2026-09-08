import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import type { Edge } from "~~/shared/model";

/** One stored relation, with the id it is filed under. */
export type StoredEdge = Edge & { id: string };

export type EdgeScanResult<Row> = {
  rows: Row[];
  /** Where the next page starts. Null once the collection is exhausted. */
  nextCursor: string | null;
  /** How many edge documents were read to fill this page. Worth handing to the
   * caller: the ratio is the interesting number, and a page that cost 2000
   * reads says most of the collection is not what was being looked for. */
  scanned: number;
  /** Whether the scan stopped on its own budget rather than on the data. */
  truncated: boolean;
};

/** One page of a scanning queue, as it goes over the wire.
 *
 * `edges` rather than `rows` because that is what both endpoints already
 * answered with, and `useScannedQueue` reads it on the other side. */
export type ScannedEdges<Row> = {
  edges: Row[];
} & Omit<EdgeScanResult<Row>, "rows">;

/** What a scanning queue's endpoint accepts: a screenful, and where to resume.
 * Extended rather than restated, so the two queues cannot drift on the cap. */
export const edgeScanQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/** How many edges to read per round trip while filling a page. */
export const EDGE_SCAN_PAGE = 300;

/** The most documents one request will read. */
export const EDGE_SCAN_BUDGET = 3000;

/** A page of relations matching something Firestore cannot be asked for.
 *
 * Both admin queues over `edges` are of this shape: a question the index cannot
 * answer - "is the page at the other end published", "is this field absent" -
 * behind an equality filter it can. So the honest implementation is a scan with
 * a budget, and the honest response says how much of one it was, which is why
 * `scanned` and `truncated` come back beside the rows.
 *
 * The equality filter ordered by document id is served by the automatic
 * single-field index; anything else on `edges` would need a composite index
 * declared, and there are none.
 *
 * @param prepare called once per batch, before it is walked, so that a lookup
 *   the rows need - the names at each end, say - is one multi-get per batch
 *   rather than one per row. It returns the row for an edge, or null to skip
 *   it.
 */
export async function scanEdges<Row>(
  db: Firestore,
  query: {
    field: string;
    value: unknown;
    limit: number;
    cursor?: string | null;
  },
  prepare: (batch: StoredEdge[]) => Promise<(edge: StoredEdge) => Row | null>,
): Promise<EdgeScanResult<Row>> {
  const rows: Row[] = [];
  let cursor = query.cursor ?? null;
  let scanned = 0;
  let exhausted = false;

  while (
    rows.length < query.limit &&
    scanned < EDGE_SCAN_BUDGET &&
    !exhausted
  ) {
    let q = db
      .collection("edges")
      .where(query.field, "==", query.value)
      .orderBy(FieldPath.documentId())
      .limit(EDGE_SCAN_PAGE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    scanned += snap.size;
    if (snap.empty) {
      exhausted = true;
      break;
    }

    const batch = snap.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Edge) }) as StoredEdge,
    );
    const rowFor = await prepare(batch);

    // The cursor follows what was *examined*, not what was returned. Filling
    // the page halfway through a batch and then skipping to the end of it would
    // drop every matching relation behind the break - and silently, so the
    // queue would look complete while holding work back.
    let consumed = 0;
    for (const edge of batch) {
      consumed += 1;
      cursor = edge.id;

      const row = rowFor(edge);
      if (row === null) continue;
      rows.push(row);
      if (rows.length >= query.limit) break;
    }

    // Only a batch read to its end, and short of what was asked for, means
    // there is nothing behind it.
    if (consumed === snap.size && snap.size < EDGE_SCAN_PAGE) exhausted = true;
  }

  return {
    rows,
    nextCursor: exhausted ? null : cursor,
    scanned,
    truncated: !exhausted && rows.length < query.limit,
  };
}
