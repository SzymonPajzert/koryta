import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { fetchEdgesForNode } from "~~/server/utils/edgePublication";
import { pageIsPublic } from "~~/shared/model";
import type { NodeType } from "~~/shared/model";

/** The far end of one of an article's own edges. */
export type ArticleRelation = {
  /** The edge, which is what a "remove" acts on. */
  edgeId: string;
  nodeId: string;
  name: string | null;
  nodeType: NodeType | null;
  /** Whether the relation is live for the public, as opposed to a draft only
   * signed in readers are shown. */
  published: boolean;
};

export type ArticleRelations = {
  /** `tagged` edges: the stories this article belongs to. */
  topics: ArticleRelation[];
  /** `mentions` edges: who the article talks about. */
  mentions: ArticleRelation[];
};

/** What an article points at.
 *
 * `/api/graph/local/[id]` cannot answer this. It keeps only the edges whose
 * both ends it drew, and it draws people, places and regions - never an article
 * or a topic - so every edge touching an article is dropped before it is
 * returned. That is why `useEdges` on an article page has always come back
 * empty, and why this endpoint exists rather than the page reusing the graph.
 *
 * A signed in reader is shown drafts, everyone else only what is published -
 * the same rule as the graph endpoint, and what makes an unapproved tag visible
 * to the person who just added it.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = await wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const edges = (await fetchEdgesForNode(db, id))
    .filter((edge) => edge.deleted !== true)
    .filter((edge) => edge.type === "tagged" || edge.type === "mentions")
    // `tagged` only ever points article -> topic, so the other direction would
    // put the article itself on the far end. `mentions` is stored both ways -
    // this page and `useEdgeTypes.ts` write article -> person, while
    // `ingest/person.post.ts` writes person -> article and produced most of the
    // ones in the database - so reading only outgoing edges left the section
    // showing a fraction of what the pipeline had found.
    .filter((edge) => edge.type === "mentions" || edge.source === id)
    .filter((edge) => (includeDrafts ? true : pageIsPublic(edge)));

  /** The end of the edge that is not this article. */
  const farId = (edge: (typeof edges)[number]) =>
    edge.source === id ? edge.target : edge.source;

  const farIds = Array.from(new Set(edges.map(farId)));
  const snaps = farIds.length
    ? await db.getAll(
        ...farIds.map((nodeId) => db.collection("nodes").doc(nodeId)),
      )
    : [];
  const nodes = new Map(snaps.map((snap) => [snap.id, snap.data()]));

  const toRelation = (edge: (typeof edges)[number]): ArticleRelation => {
    const node = nodes.get(farId(edge));
    return {
      edgeId: edge.id,
      nodeId: farId(edge),
      name: typeof node?.name === "string" ? node.name : null,
      nodeType: (node?.type as NodeType | undefined) ?? null,
      published: pageIsPublic(edge),
    };
  };

  const byName = (a: ArticleRelation, b: ArticleRelation) =>
    (a.name ?? "").localeCompare(b.name ?? "", "pl");

  /** One chip per person, whichever way round the edges saying so were stored.
   * The two writers of `mentions` do not know about each other, so an article
   * the pipeline processed and a reader then edited can carry both. */
  const dedupe = (relations: ArticleRelation[]) => {
    const byNode = new Map<string, ArticleRelation>();
    for (const relation of relations) {
      const seen = byNode.get(relation.nodeId);
      // The published one is the one to keep: it is the one the public would be
      // shown, and it is what decides whether the chip is drawn as a draft.
      if (!seen || (!seen.published && relation.published)) {
        byNode.set(relation.nodeId, relation);
      }
    }
    return Array.from(byNode.values());
  };

  return {
    topics: edges
      .filter((edge) => edge.type === "tagged")
      .map(toRelation)
      .sort(byName),
    mentions: dedupe(
      edges.filter((edge) => edge.type === "mentions").map(toRelation),
    ).sort(byName),
  } satisfies ArticleRelations;
});
