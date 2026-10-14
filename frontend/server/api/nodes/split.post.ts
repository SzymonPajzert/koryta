import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { documentId } from "~~/server/utils/documentId";
import { createRevisionTransaction } from "~~/server/utils/revisions";
import { recordAudit } from "~~/server/utils/audit";
import {
  countDispositions,
  edgesTouching,
  planEdgeMoves,
  resolveMergedNode,
  type MergeEdgePlan,
  type MergeDisposition,
} from "~~/server/utils/merge";
import { personEditSchema } from "~~/shared/api";
import { z } from "zod";

const bodyValidator = z.object({
  /** The page that turned out to be two people. */
  node_id: documentId,
  reason: z.string().trim().min(1, "Powód rozdzielenia jest wymagany"),
  /** Record that this page is two people and stop there. What separates them
   * is a judgement about individual relations, and the person who can make it
   * is not always the person who noticed. */
  mark_only: z.boolean().optional(),
  /** The relations that belong to the *other* person. Everything not listed
   * stays where it is, which is the safe default: a relation nobody has
   * attributed is still attributed to the page it was found on. */
  edge_ids: z.array(documentId).optional(),
  /** Where those relations go. Either a page an admin has already made by hand
   * - the usual case, because noticing the collapse and creating the second
   * person is one sitting - or a new one described here. */
  into_id: documentId.optional(),
  into_person: personEditSchema
    .partial()
    .extend({ name: z.string().min(1) })
    .optional(),
  dry_run: z.boolean().optional(),
});

export type NodeSplit = {
  node_id: string;
  /** The page the selected relations went to, created if it had to be. */
  into_id?: string;
  created_into: boolean;
  edges: MergeEdgePlan[];
  counts: Record<MergeDisposition, number>;
  marked: boolean;
  applied: boolean;
};

/** Takes one page apart into the two people it was all along.
 *
 * The mirror image of `/api/nodes/merge`, and the harder direction. A merge can
 * be justified from what is stored - two pages carrying one `rejestrIo` are one
 * person, and nothing else has to be decided. A split cannot: relations carry
 * no record of which register entry they were read off, so no query can say
 * that this post belongs to the Michał Nowak born in 1961 and that candidacy to
 * the one born in 1972. Only a person can, which is why this endpoint asks for
 * the list rather than working it out.
 *
 * Hence `mark_only`. Noticing that a page is two people takes a moment; telling
 * their forty relations apart takes an afternoon, and the two rarely happen
 * together. A marked page keeps a note of who said so and why until somebody
 * gets to it.
 *
 * Everything not listed in `edge_ids` stays put. That is deliberate: a relation
 * nobody has attributed is still evidence about the page it was found on, and
 * leaving it is recoverable in a way that moving it on a guess is not.
 */
export default defineEventHandler(async (event): Promise<NodeSplit> => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const nodeRef = db.collection("nodes").doc(body.node_id);
  const nodeDoc = await nodeRef.get();
  if (!nodeDoc.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma strony o id: ${body.node_id}`,
    });
  }
  if (typeof nodeDoc.data()?.merged_into === "string") {
    throw createError({
      statusCode: 400,
      message:
        `Strona ${body.node_id} została scalona z ` +
        `${nodeDoc.data()?.merged_into}; rozdzielaj tę, która została.`,
    });
  }

  const at = new Date().toISOString();

  if (body.mark_only) {
    if (body.dry_run) {
      return {
        node_id: body.node_id,
        created_into: false,
        edges: [],
        counts: countDispositions([]),
        marked: true,
        applied: false,
      };
    }
    const batch = db.batch();
    batch.update(nodeRef, {
      needs_split: { reason: body.reason, at, user: user.uid },
    });
    recordAudit(
      db,
      {
        action: "split",
        collection: "nodes",
        target_id: body.node_id,
        user: user.uid,
        reason: body.reason,
      },
      batch,
    );
    await batch.commit();
    return {
      node_id: body.node_id,
      created_into: false,
      edges: [],
      counts: countDispositions([]),
      marked: true,
      applied: true,
    };
  }

  if (!body.into_id && !body.into_person) {
    throw createError({
      statusCode: 400,
      message:
        "Podaj stronę, na którą przenieść powiązania, albo dane nowej osoby.",
    });
  }
  if (body.into_id && body.into_person) {
    throw createError({
      statusCode: 400,
      message: "Podaj albo istniejącą stronę, albo dane nowej - nie oba naraz.",
    });
  }

  const edgeIds = body.edge_ids ?? [];
  // Read before anything is written, and checked against this page rather than
  // trusted: an id from a stale dialog could name a relation that has since
  // moved, and re-pointing that one would take a fact off a third page.
  const touching = await edgesTouching(db, body.node_id);
  const byId = new Map(touching.map((doc) => [doc.id, doc]));
  const missing = edgeIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Te powiązania nie należą już do tej strony: ${missing.join(", ")}`,
    });
  }
  const moving = edgeIds.map((id) => byId.get(id)!);

  // An existing destination is resolved through its own merges first, so
  // splitting onto a page that was merged away lands where a reader would.
  const destination = body.into_id
    ? await resolveMergedNode(db, body.into_id)
    : undefined;
  if (body.into_id && !destination?.snapshot?.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma strony o id: ${body.into_id}`,
    });
  }
  if (destination?.id === body.node_id) {
    throw createError({
      statusCode: 400,
      message: "Nie można rozdzielić strony na nią samą.",
    });
  }

  const batch = db.batch();
  let intoId = destination?.id;
  let createdInto = false;

  if (!intoId) {
    const intoRef = db.collection("nodes").doc();
    intoId = intoRef.id;
    createdInto = true;
    if (!body.dry_run) {
      createRevisionTransaction(
        db,
        batch,
        user,
        intoRef,
        { ...body.into_person, type: "person" },
        // Approved because an admin separating two people has reviewed the one
        // they are describing, but not published: the new page starts as a
        // draft so that whoever splits can check it reads right before it is
        // in front of anybody.
        { approve: true, published: false },
      );
    }
  }

  // A page that does not exist yet holds nothing, so nothing can collide with
  // it - which is why a split onto a fresh person never reports a duplicate.
  const destinationEdges = createdInto ? [] : await edgesTouching(db, intoId!);
  const edges = planEdgeMoves(moving, destinationEdges, body.node_id, intoId!);
  const counts = countDispositions(edges);

  if (body.dry_run) {
    return {
      node_id: body.node_id,
      into_id: createdInto ? undefined : intoId,
      created_into: createdInto,
      edges,
      counts,
      marked: false,
      applied: false,
    };
  }

  const moved: string[] = [];
  for (const edge of edges) {
    // Only a move here. A relation the destination already states is left on
    // the page it came from rather than removed: this is a split, and the case
    // for removing it is the merge's case, which nobody has made.
    if (edge.disposition !== "moved" && edge.disposition !== "review") continue;
    const stored = byId.get(edge.edge_id)!.data();
    const update: Record<string, string> = {};
    if (stored.source === body.node_id) update.source = intoId!;
    if (stored.target === body.node_id) update.target = intoId!;
    batch.update(db.collection("edges").doc(edge.edge_id), update);
    moved.push(edge.edge_id);
  }

  // The mark is answered by the split that follows it.
  batch.update(nodeRef, { needs_split: FieldValue.delete() });

  recordAudit(
    db,
    {
      action: "split",
      collection: "nodes",
      target_id: body.node_id,
      user: user.uid,
      reason: body.reason,
      merge: { into: intoId!, moved, collapsed: [] },
    },
    batch,
  );

  await batch.commit();
  await useStorage("cache").clear("nitro:handlers");

  return {
    node_id: body.node_id,
    into_id: intoId,
    created_into: createdInto,
    edges,
    counts,
    marked: false,
    applied: true,
  };
});
