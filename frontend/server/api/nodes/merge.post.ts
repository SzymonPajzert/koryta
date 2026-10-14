import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { documentId } from "~~/server/utils/documentId";
import {
  applyNodeMerge,
  mergeRefusal,
  planNodeMerge,
  resolveMergedNode,
  type MergePlan,
} from "~~/server/utils/merge";
import { z } from "zod";

const bodyValidator = z.object({
  /** The page that turned out to be a second copy. It is the one that goes. */
  duplicate_id: documentId,
  /** The page that stays, and that the duplicate's relations move onto. */
  survivor_id: documentId,
  reason: z.string().trim().min(1, "Powód scalenia jest wymagany"),
  /** Report what would happen and write nothing. The dialog asks for this
   * first, because the count of relations that would be removed is the one
   * thing worth reading before agreeing to a merge. */
  dry_run: z.boolean().optional(),
});

export type NodesMerged = {
  plan: MergePlan;
  /** False for a dry run, true once the merge is written. */
  applied: boolean;
};

/** Folds one page into another, on an administrator's own authority.
 *
 * The pipeline identifies a person by the name it happened to pick that run, so
 * one human filed under two spellings - "Andrzej Golimont" and "Andrzej Marcin
 * Golimont", both `rejestr.io/osoby/383093` - is two pages, each holding half
 * of what is known. Neither is wrong, so neither can be deleted: the point is
 * to end up with one page holding both halves and no relation stated twice.
 *
 * Admin rather than a review queue, and for the same reason `/api/edges/delete`
 * is: this is not a claim somebody disagrees with, it is a page that should
 * never have existed, and making an admin file a proposal against themselves
 * adds a queue entry to a verdict that was never in doubt. What it does leave
 * behind is a merge entry in the audit log naming every relation it moved,
 * which is what an undo would need.
 *
 * The survivor is resolved through its own `merged_into` first, so merging into
 * a page that was itself merged away lands on the page a reader would actually
 * reach rather than building a chain nothing follows.
 */
export default defineEventHandler(async (event): Promise<NodesMerged> => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const survivor = await resolveMergedNode(db, body.survivor_id);
  const duplicate = await db.collection("nodes").doc(body.duplicate_id).get();

  const refusal = mergeRefusal(
    { duplicate_id: body.duplicate_id, survivor_id: survivor.id },
    duplicate,
    survivor.snapshot,
  );
  if (refusal) throw createError({ statusCode: 400, message: refusal });

  const plan = await planNodeMerge(db, body.duplicate_id, survivor.id);

  if (body.dry_run) return { plan, applied: false };

  // Re-read as one map so `applyNodeMerge` writes from what it planned over,
  // rather than reading every edge a second time.
  const storedEdges = new Map<string, Record<string, unknown>>();
  // Both ends of every verdict: the relation being moved, and - for an
  // `enriched` one - the survivor's relation that is about to learn from it,
  // which `applyNodeMerge` has to read before it can write the fuller version.
  const edgeIds = [
    ...new Set(
      plan.edges.flatMap((edge) =>
        edge.disposition === "enriched" && edge.duplicate_of
          ? [edge.edge_id, edge.duplicate_of]
          : [edge.edge_id],
      ),
    ),
  ];
  if (edgeIds.length > 0) {
    const docs = await db.getAll(
      ...edgeIds.map((id) => db.collection("edges").doc(id)),
    );
    for (const doc of docs) {
      if (doc.exists) storedEdges.set(doc.id, doc.data() ?? {});
    }
  }

  const storedVotes = new Map<string, Record<string, unknown>>();
  if (plan.votes.length > 0) {
    const docs = await db.getAll(
      ...plan.votes.map((vote) => db.collection("votes").doc(vote.from_id)),
    );
    for (const doc of docs) {
      if (doc.exists) storedVotes.set(doc.id, doc.data() ?? {});
    }
  }

  const batch = db.batch();
  applyNodeMerge(
    db,
    batch,
    user,
    plan,
    body.reason,
    storedEdges,
    survivor.snapshot?.data(),
    storedVotes,
  );
  await batch.commit();

  // The entity and graph endpoints are cached per handler for six hours, so
  // both pages would otherwise keep their old relations for the rest of the
  // day. Same clear as /api/edges/delete.
  await useStorage("cache").clear("nitro:handlers");

  return { plan, applied: true };
});
