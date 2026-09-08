import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import {
  edgeRevisionsForMany,
  fetchEdgesForNode,
  hasPendingRevision,
  publishCandidateRevision,
  resolveEdgeEndpoints,
} from "~~/server/utils/edgePublication";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import type { EdgeType } from "~~/shared/model";
import { z } from "zod";

/** One relation as the publish dialog needs to render it: what it says, who is
 * on the other end, and whether it may go live at all. */
export type NodeRelation = {
  id: string;
  type: EdgeType;
  name: string | null;
  /** What the relation says read the other way - see `Edge.reverse_name`. Only
   * a `connection` ever has one, and it is what the row prints when this node
   * is the target. */
  reverse_name: string | null;
  /** Which end of the edge the node this was asked about sits on. */
  direction: "outgoing" | "incoming";
  otherId: string;
  otherName: string | null;
  otherPublished: boolean;
  published: boolean;
  /** The revision publishing this relation would approve, when it points at
   * none of its own yet. Null when the edge already has an approved revision,
   * or has no revision at all and will be published on its document alone. */
  revisionToApprove: string | null;
  /** Whether a revision of this relation is genuinely still awaiting a verdict,
   * as opposed to merely not being pointed at. */
  hasPendingRevision: boolean;
  /** Whether the reviewer may tick this relation, which is what greys the row
   * out when false.
   *
   * This is `otherPublished` alone, deliberately - *not* the whole
   * both-ends-published rule. The page this was asked about is the one the
   * reviewer is publishing, so at the moment the dialog renders it is still a
   * draft and the full rule would grey out every row, including the ones about
   * to become perfectly publishable. By the time the edges are sent it is live,
   * because the dialog publishes the node first.
   *
   * The real rule still holds: /api/edges/publish checks both ends itself, and
   * refuses whatever this said. */
  publishable: boolean;
};

export type NodeRelations = {
  relations: NodeRelation[];
  nodePublished: boolean;
};

const queryValidator = z.object({
  nodeId: z.string().min(1),
});

/** The relations hanging off one node, for the reviewer about to publish it.
 *
 * Admin-only, unlike /api/revisions/byNode: this answers which pages are still
 * drafts, which is not something an anonymous caller has any business
 * enumerating.
 */
export default defineEventHandler(async (event): Promise<NodeRelations> => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const [edges, nodeDoc] = await Promise.all([
    fetchEdgesForNode(db, query.nodeId),
    db.collection("nodes").doc(query.nodeId).get(),
  ]);

  const live = edges.filter((edge) => edge.deleted !== true);
  const endpoints = await resolveEdgeEndpoints(db, live);

  // Only the relations a reviewer might act on need their revisions read: one
  // already live, or already pointing at an approved revision, has nothing to
  // settle. Read for the whole batch at once rather than per row.
  const needRevisions = live.filter(
    (edge) => !pageIsPublic(edge) && !approvedRevisionId(edge.revision_id),
  );
  const revisions = await edgeRevisionsForMany(
    db,
    needRevisions.map((edge) => edge.id),
  );

  const relations = live.map((edge): NodeRelation => {
    const state = endpoints.get(edge.id);
    const outgoing = edge.source === query.nodeId;
    const otherId = outgoing ? edge.target : edge.source;
    const otherName = outgoing
      ? (state?.targetName ?? null)
      : (state?.sourceName ?? null);
    const otherPublished = outgoing
      ? (state?.targetPublished ?? false)
      : (state?.sourcePublished ?? false);

    const candidates = revisions.get(edge.id) ?? [];

    return {
      id: edge.id,
      type: edge.type,
      name: typeof edge.name === "string" && edge.name ? edge.name : null,
      reverse_name:
        typeof edge.reverse_name === "string" && edge.reverse_name
          ? edge.reverse_name
          : null,
      direction: outgoing ? "outgoing" : "incoming",
      otherId,
      otherName,
      otherPublished,
      published: pageIsPublic(edge),
      revisionToApprove: publishCandidateRevision(candidates)?.id ?? null,
      hasPendingRevision: hasPendingRevision(candidates),
      // The subject page is the one being published, so only the far end can
      // hold a relation back. A self-edge has no far end, and is therefore
      // never the thing standing in the way.
      publishable: otherId === query.nodeId ? true : otherPublished,
    };
  });

  // Unpublished first, and the ones that are ready before the ones blocked on
  // a draft - the dialog is a work queue, so what needs a decision goes on top.
  relations.sort((a, b) => {
    if (a.published !== b.published) return a.published ? 1 : -1;
    if (a.publishable !== b.publishable) return a.publishable ? -1 : 1;
    return (a.otherName ?? a.otherId).localeCompare(
      b.otherName ?? b.otherId,
      "pl",
    );
  });

  return {
    relations,
    nodePublished: nodeDoc.exists && pageIsPublic(nodeDoc.data() ?? {}),
  };
});
