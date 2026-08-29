import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { auditActions, isRemovalAction } from "~~/shared/audit";
import type { AuditAction } from "~~/shared/audit";
import { generateEntityUrl } from "~/composables/slugs";
import { edgeTypeLabels } from "~~/shared/edges";
import { nodeTypes, type Edge, type NodeType } from "~~/shared/model";
import { z } from "zod";

/** One decision, as the log renders it. */
export type AuditRow = {
  id: string;
  action: AuditAction;
  collection: "nodes" | "edges";
  target_id: string;
  /** What the entry is called. Null when the target has since been hard
   * deleted, or was never there - the row still stands, because the decision
   * was still made. */
  targetName: string | null;
  /** Where to read it. Null for a relation, which has no page of its own, and
   * for a target that is gone. */
  targetPath: string | null;
  /** A relation read as a sentence, since it has no name and no page. Null for
   * a node. */
  targetDetail: string | null;
  revision_id: string | null;
  /** The admin's uid. The page resolves it to a name through the batched
   * lookup every other admin list uses. */
  user: string;
  at: string;
  reason: string | null;
  /** Whether this removal can still be undone - the relation is there and is
   * still marked removed. False once somebody has put it back, so the button
   * goes away rather than 404ing or writing a no-op revision. */
  restorable: boolean;
};

export type AuditLog = {
  entries: AuditRow[];
  /** The `at` of the last row returned. Null when the log is exhausted. */
  nextCursor: string | null;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  action: z.enum(auditActions).optional(),
});

/** The administrator decision log.
 *
 * Read only here and in `collectAdminDecisions`, which takes `user` and `at`
 * and throws the rest away to count contributions. This is the other half: what
 * was actually decided, about which entry, and why.
 *
 * Ordered by `at` alone. `audit` has no composite index and index deploys in
 * this project are manual, so a filter combined with the ordering would pass
 * every local test against the emulator - which creates indexes implicitly -
 * and 500 in production. `action` is therefore filtered in memory, over a
 * bounded scan, the way `deleted` is filtered everywhere else in this codebase.
 */
export default defineEventHandler(async (event): Promise<AuditLog> => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");

  // One over the page when unfiltered, so a full read is distinguishable from
  // the end of the log. Wider when filtering, because the filter runs in memory
  // and a rare decision can sit behind any number of publications.
  const scan = query.action ? SCAN_WITH_FILTER : query.limit + 1;

  // Ordered by `at`, then by document id. Both descending, which is exactly the
  // shape of the automatic single-field index Firestore keeps for every field -
  // it terminates in `__name__` in the matching direction - so this needs no
  // composite index, and `audit` has none declared. The second key is not
  // cosmetic: `at` is stamped per `recordAudit` call, and publishing a hundred
  // relations files up to two hundred rows inside one synchronous loop, tens of
  // which land on the same millisecond. On `at` alone a cursor cannot address a
  // position *inside* such a group, and `startAfter(at)` steps over all of it -
  // so a page that ended mid-group silently lost the rest. The document id
  // breaks every tie, so the cursor is exact and no row can be skipped.
  let q = db
    .collection("audit")
    .orderBy("at", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(scan);
  if (query.cursor) {
    const [at, id] = splitCursor(query.cursor);
    q = q.startAfter(at, id);
  }

  const snap = await q.get();
  const scanned = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<AuditRow, "id">),
  }));

  const matching = query.action
    ? scanned.filter((row) => row.action === query.action)
    : scanned;

  const page = matching.slice(0, query.limit);
  // Where the next page resumes. When the page was truncated it follows the
  // last row *returned*; otherwise it follows the last row *examined*, so a
  // filter for a rare decision keeps paging past the ones it skipped instead of
  // reporting the log exhausted. A short read means there is nothing behind it.
  const truncated = matching.length > query.limit;
  const last = truncated ? page[page.length - 1] : scanned[scanned.length - 1];
  const nextCursor =
    (truncated || scanned.length >= scan) && last
      ? `${last.at}|${last.id}`
      : null;

  // One read of the relations, shared: `resolveTargets` needs them to name the
  // row and `restorable` needs them to know whether the removal still stands,
  // and re-reading would double the cost of every page.
  const edges = await readAll(
    db,
    "edges",
    page
      .filter((row) => row.collection === "edges")
      .map((row) => row.target_id),
  );
  const targets = await resolveTargets(db, page, edges);

  return {
    entries: page.map((row) => {
      const target = targets.get(`${row.collection}/${row.target_id}`);
      return {
        id: row.id,
        action: row.action,
        collection: row.collection,
        target_id: row.target_id,
        targetName: target?.name ?? null,
        targetPath: target?.path ?? null,
        targetDetail: target?.detail ?? null,
        revision_id: row.revision_id ?? null,
        user: row.user,
        at: row.at,
        reason: row.reason ?? null,
        // Still undoable only while the relation is there and still marked
        // removed - so the button goes away once somebody has put it back,
        // rather than 404ing or writing a revision that changes nothing.
        restorable:
          isRemovalAction(row.action) &&
          row.collection === "edges" &&
          (edges.get(row.target_id) as unknown as Edge | undefined)?.deleted ===
            true,
      };
    }),
    nextCursor,
  };
});

/** How many rows to read through when the caller asked for one kind of
 * decision. Filtering in memory means a page of ten rejections can sit behind
 * any number of publications; this bounds what that costs. */
const SCAN_WITH_FILTER = 400;

/** A cursor is `<at>|<document id>`, the two keys the query orders on.
 *
 * `at` is an ISO 8601 timestamp and carries no `|`, so the first one separates
 * the keys. A cursor that has lost its id still positions correctly on the
 * timestamp; it just cannot address a spot inside a same-millisecond group,
 * which is the one thing the id is there for.
 */
function splitCursor(cursor: string): [string, string] {
  const at = cursor.indexOf("|");
  if (at === -1) return [cursor, ""];
  return [cursor.slice(0, at), cursor.slice(at + 1)];
}

/** What each row is about, in one read per collection. */
async function resolveTargets(
  db: FirebaseFirestore.Firestore,
  rows: { collection: string; target_id: string }[],
  edges: Map<string, Record<string, unknown>>,
): Promise<
  Map<
    string,
    { name: string | null; path: string | null; detail: string | null }
  >
> {
  const out = new Map<
    string,
    { name: string | null; path: string | null; detail: string | null }
  >();
  const nodeIds = new Set<string>();
  for (const row of rows) {
    if (row.collection !== "edges") nodeIds.add(row.target_id);
  }

  // A relation is named by its two ends, so their pages have to be read as
  // well - including the ones this log's own rows took off the site.
  for (const edge of edges.values()) {
    const data = edge as unknown as Edge;
    if (typeof data.source === "string") nodeIds.add(data.source);
    if (typeof data.target === "string") nodeIds.add(data.target);
  }
  const nodes = await readAll(db, "nodes", [...nodeIds]);

  const nameOf = (id: string) => {
    const raw = nodes.get(id)?.name;
    return typeof raw === "string" && raw ? raw : null;
  };

  for (const [id, data] of nodes) {
    const type = nodeTypes.includes(data.type as NodeType)
      ? (data.type as NodeType)
      : null;
    const name = nameOf(id);
    out.set(`nodes/${id}`, {
      name,
      path: type ? generateEntityUrl(type, id, name ?? undefined) : null,
      detail: null,
    });
  }

  for (const [id, raw] of edges) {
    const edge = raw as unknown as Edge;
    const label = edge.name || edgeTypeLabels[edge.type] || edge.type;
    const from = nameOf(edge.source) ?? edge.source;
    const to = nameOf(edge.target) ?? edge.target;
    const period = [edge.start_date, edge.end_date].filter(Boolean).join(" - ");
    out.set(`edges/${id}`, {
      name: `${from} - ${label} - ${to}`,
      // A relation has no page. The end it starts from is the nearest thing,
      // and it is where the reader would go to see the relation in context.
      path: nodes.has(edge.source)
        ? (out.get(`nodes/${edge.source}`)?.path ?? null)
        : null,
      detail: period || null,
    });
  }

  return out;
}

/** `getAll` in chunks, the way `resolveEdgeEndpoints` reads its endpoints. */
async function readAll(
  db: FirebaseFirestore.Firestore,
  collection: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(collection).doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists) found.set(snap.id, snap.data() ?? {});
    }
  }
  return found;
}
