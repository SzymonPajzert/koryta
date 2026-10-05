import { getFirestore } from "firebase-admin/firestore";
import type { DocumentReference } from "firebase-admin/firestore";
import { defineEventHandler } from "h3";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { fetchOptionsValidator, paginate } from "~~/server/utils/fetch";
import { normalizeUpdateTime } from "~~/shared/revisions";
import { pageIsPublic } from "~~/shared/model";
import type { NodeType } from "~~/shared/model";

/** How many proposals one page of the queue holds. */
const DEFAULT_LIMIT = 25;

/** Fields nobody needs to see diffed: they are what the edge *is*, not what the
 * proposal changes about it, and every proposal restates them identically. */
const STRUCTURAL_FIELDS = new Set(["source", "target", "type"]);

const queryValidator = fetchOptionsValidator.extend({
  /** Restrict to one edge type, e.g. `election`. */
  type: z.string().optional(),
});

export type PendingEdgeChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export type PendingEdgeEndpoint = {
  id: string;
  name: string | null;
  type: NodeType | null;
};

export type PendingEdgeRevision = {
  /** The revision document. Content-addressed for a proposal, so a nightly
   * re-run overwrites this rather than adding another. */
  id: string;
  edgeId: string;
  edgeType: string | null;
  updateTime: string | null;
  updateUser: string;
  automatic: boolean;
  /** Whether the edge is currently on the public site. A proposal does not
   * change this either way; it is here because it decides how much a wrong
   * answer costs. */
  published: boolean;
  source: PendingEdgeEndpoint;
  target: PendingEdgeEndpoint;
  changes: PendingEdgeChange[];
};

/** The changes to edges that nobody has acted on.
 *
 * These come from the ingest, which proposes rather than applies when it cannot
 * vouch for what it found - a candidacy whose electoral committee is not one the
 * scrapers' curated table names, which is most of them. Nothing surfaced them:
 * /admin/rewizje lists `nodes`, and a revision stores an edge id under
 * `node_id` like every other revision, so `collection` is the only thing that
 * tells the two apart.
 *
 * Admin-only, because it reads through the admin SDK and so bypasses the
 * Firestore rules, which deny `/edges` to the client outright.
 *
 * Rendered by the „Zmiany powiązań” section of /admin/rewizje (#powiazania).
 * Not to be confused with /admin/krawedzie, which lists edges that are ready
 * to be published.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden",
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const db = getFirestore("koryta-pl");
  const pending = db
    .collection("revisions")
    .where("collection", "==", "edges")
    .where("status", "==", "pending")
    .orderBy("update_time", "desc");

  const [snapshot, countSnapshot] = await Promise.all([
    paginate(pending, { ...query, limit: query.limit ?? DEFAULT_LIMIT }).get(),
    pending.count().get(),
  ]);

  if (snapshot.empty) {
    return { revisions: [] as PendingEdgeRevision[], total: 0 };
  }

  // The edges the proposals are about, read once. A proposal is only meaningful
  // next to what the edge says now - that difference is the whole review.
  const edgeIds = [...new Set(snapshot.docs.map((doc) => doc.data().node_id))];
  const edgeDocs = await db.getAll(
    ...edgeIds.map((id) => db.collection("edges").doc(String(id))),
  );
  const edges = new Map<string, Record<string, unknown>>();
  for (const doc of edgeDocs) {
    if (doc.exists) edges.set(doc.id, doc.data() ?? {});
  }

  // Both ends of every edge, so the queue reads as "Jan Kowalski -> Powiat
  // leszczyński" rather than as two Firestore ids.
  const nodeIds = new Set<string>();
  for (const edge of edges.values()) {
    if (typeof edge.source === "string") nodeIds.add(edge.source);
    if (typeof edge.target === "string") nodeIds.add(edge.target);
  }
  const nodes = new Map<
    string,
    { name: string | null; type: NodeType | null }
  >();
  if (nodeIds.size > 0) {
    const refs: DocumentReference[] = [...nodeIds].map((id) =>
      db.collection("nodes").doc(id),
    );
    for (const doc of await db.getAll(...refs)) {
      const data = doc.data();
      nodes.set(doc.id, {
        name: typeof data?.name === "string" ? data.name : null,
        type: (data?.type as NodeType | undefined) ?? null,
      });
    }
  }

  function endpoint(id: unknown): PendingEdgeEndpoint {
    const key = String(id ?? "");
    return { id: key, ...(nodes.get(key) ?? { name: null, type: null }) };
  }

  const revisions: PendingEdgeRevision[] = [];
  for (const doc of snapshot.docs) {
    const revision = doc.data();
    const edge = edges.get(String(revision.node_id));
    // The edge has been deleted since the proposal was filed. Nothing left to
    // review, and showing a change to a document that is gone is worse than not
    // showing it.
    if (!edge) continue;

    const proposed = (revision.data ?? {}) as Record<string, unknown>;
    const changes: PendingEdgeChange[] = [];
    for (const [field, to] of Object.entries(proposed)) {
      if (STRUCTURAL_FIELDS.has(field)) continue;
      const from = edge[field];
      if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
      changes.push({ field, from: from ?? null, to });
    }

    revisions.push({
      id: doc.id,
      edgeId: String(revision.node_id),
      edgeType: typeof edge.type === "string" ? edge.type : null,
      updateTime: normalizeUpdateTime(revision.update_time),
      updateUser: String(revision.update_user ?? ""),
      automatic: revision.update_automatic === true,
      published: pageIsPublic(edge),
      source: endpoint(edge.source),
      target: endpoint(edge.target),
      changes,
    });
  }

  const filtered = query.type
    ? revisions.filter((r) => r.edgeType === query.type)
    : revisions;

  return { revisions: filtered, total: countSnapshot.data().count };
});
