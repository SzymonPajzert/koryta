import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { requireAdmin } from "~~/server/utils/auth";
import { applyRevision } from "~~/server/utils/revisions";
import {
  edgeRevisionsForMany,
  publishEdgeInBatch,
} from "~~/server/utils/edgePublication";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import type { Revision } from "~~/shared/model";

const bodyValidator = z.object({
  /** `tagged` edges to put live alongside the topic. */
  edgeIds: z.array(z.string().min(1)).max(50).optional(),
});

/** Puts a story, and the tags that put articles in it, on the site.
 *
 * One call because it is one decision, and because the steps only work in this
 * order. A tag is an edge, and no edge may be published while an end of it is a
 * draft - so `/api/edges/unpublished` skipped every tag pointing at a topic
 * nobody had approved yet, and the queue that is supposed to surface the work
 * held it back instead. Doing it from the client would have meant three
 * requests in a fixed sequence with two chances to leave the pair half done.
 *
 * The topic itself needs both halves: a node cannot go live without an approved
 * revision, and a topic somebody proposed has only a pending one.
 */
export default defineEventHandler(async (event) => {
  const topicId = getRouterParam(event, "id");
  if (!topicId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }

  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));
  const user = await requireAdmin(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const topicRef = db.collection("nodes").doc(topicId);
  const topicSnap = await topicRef.get();
  const topic = topicSnap.data();
  if (!topicSnap.exists || topic?.type !== "topic") {
    throw createError({ statusCode: 404, message: "Nie ma takiego tematu." });
  }

  // 1. The topic. Approving its newest pending revision is what gives it the
  //    `revision_id` without which it may not be published at all.
  if (!approvedRevisionId(topic.revision_id) || !pageIsPublic(topic)) {
    const pending = await db
      .collection("revisions")
      .where("node_id", "==", topicId)
      .orderBy("update_time", "desc")
      .limit(10)
      .get();

    const candidate = pending.docs.find(
      (doc) => doc.data().status !== "rejected",
    );
    if (!candidate) {
      throw createError({
        statusCode: 422,
        message: "Temat nie ma rewizji, którą można zatwierdzić.",
      });
    }

    await applyRevision(
      db,
      candidate.ref,
      { id: candidate.id, ...candidate.data() } as Revision,
      user,
      true,
    );
  }

  // 2. The tags. Now that the topic is live both ends of each are, so the rule
  //    holds, and `publishEdgeInBatch` approves the revision each tag already
  //    holds. A proposal to change one stays pending for a reviewer.
  const edgeIds = Array.from(new Set(body.edgeIds ?? []));
  if (edgeIds.length === 0) return { topicId, published: true, tags: 0 };

  const refs = edgeIds.map((id) => db.collection("edges").doc(id));
  const snaps = await db.getAll(...refs);
  const candidates = await edgeRevisionsForMany(db, edgeIds);

  const batch = db.batch();
  let published = 0;
  for (const snap of snaps) {
    const stored = snap.data();
    // Only tags of *this* topic, so a mistyped id cannot publish some unrelated
    // relation on an admin's behalf.
    if (!snap.exists || stored?.type !== "tagged") continue;
    if (stored.target !== topicId || stored.deleted === true) continue;

    publishEdgeInBatch(
      db,
      batch,
      snap.ref,
      stored,
      candidates.get(snap.id) ?? [],
      user,
    );
    published += 1;
  }
  await batch.commit();

  return { topicId, published: true, tags: published };
});
