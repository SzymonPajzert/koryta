import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import {
  EDGE_PUBLISH_CHUNK,
  edgeRevisionsForMany,
  publishEdgeInBatch,
  resolveEdgeEndpoints,
  unpublishEdgeInBatch,
} from "~~/server/utils/edgePublication";
import type { Edge } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  /** Capped at the batch size a single commit can carry, so a request either
   * fits or is refused rather than being silently half-applied. */
  edge_ids: z.array(z.string().min(1)).min(1).max(EDGE_PUBLISH_CHUNK),
  published: z.boolean(),
});

/** Puts relations on the site, or takes them off it.
 *
 * Bulk because that is how the decision is actually made: a reviewer publishes
 * a page and the relations that came with it in one go. Publishing also
 * approves the newest revision each edge already holds - usually the one it
 * was written by - which is what makes "zatwierdź powiązania razem z węzłem"
 * one click rather than two screens. A proposal to change an edge is not held
 * by it and stays in the queue; see `publishCandidateRevision`.
 *
 * The endpoints-must-be-published rule is enforced here and not only in the
 * form that greys the ineligible ones out: the check the UI ran is already
 * stale by the time the request lands, and it is the only thing standing
 * between the public graph and an edge pointing at a page nobody can open.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const ids = Array.from(new Set(body.edge_ids));
  const refs = ids.map((id) => db.collection("edges").doc(id));
  const snaps = await db.getAll(...refs);

  const missing = snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
  if (missing.length > 0) {
    throw createError({
      statusCode: 404,
      message: `Nie ma powiązań o id: ${missing.join(", ")}`,
    });
  }

  const edges = snaps.map((snap) => ({
    id: snap.id,
    ...(snap.data() as Edge),
  }));

  if (!body.published) {
    const batch = db.batch();
    for (const edge of edges) {
      unpublishEdgeInBatch(
        db,
        batch,
        db.collection("edges").doc(edge.id),
        user,
      );
    }
    await batch.commit();
    await useStorage("cache").clear("nitro:handlers");
    return { published: false, edge_ids: ids, approved: [] };
  }

  // Refused as a whole rather than per edge. A partial success would leave the
  // reviewer reading a list of ids to work out what did and did not happen,
  // and the form has already filtered these out - reaching this is a race, not
  // the normal path.
  const endpoints = await resolveEdgeEndpoints(db, edges);
  const blocked = edges
    .map((edge) => endpoints.get(edge.id))
    .filter((state) => state && !state.publishable);
  if (blocked.length > 0) {
    const names = blocked
      .flatMap((state) => state!.blockedBy)
      .map((node) => node.name ?? node.id);
    throw createError({
      statusCode: 400,
      message: `Nie można opublikować powiązania, którego druga strona nie jest opublikowana: ${Array.from(
        new Set(names),
      ).join(", ")}.`,
    });
  }

  const deleted = edges.filter((edge) => edge.deleted === true);
  if (deleted.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Nie można opublikować usuniętego powiązania: ${deleted
        .map((edge) => edge.id)
        .join(", ")}.`,
    });
  }

  const revisions = await edgeRevisionsForMany(
    db,
    edges.map((edge) => edge.id),
  );

  const batch = db.batch();
  const approved: string[] = [];
  edges.forEach((edge) => {
    const result = publishEdgeInBatch(
      db,
      batch,
      db.collection("edges").doc(edge.id),
      edge as unknown as Record<string, unknown>,
      revisions.get(edge.id) ?? [],
      user,
    );
    if (result.approvedRevision) approved.push(result.approvedRevision);
  });
  await batch.commit();

  // The graph and entity endpoints are cached per handler, so a relation
  // published now would otherwise stay missing for another six hours.
  await useStorage("cache").clear("nitro:handlers");

  return { published: true, edge_ids: ids, approved };
});
