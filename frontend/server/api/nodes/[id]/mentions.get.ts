import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { fetchEdgesForNode } from "~~/server/utils/edgePublication";
import { asArray, pageIsPublic } from "~~/shared/model";

/** One article that names this node. */
export type NodeMention = {
  /** The edge saying so: a `mentions` edge, or a relation of this node that
   * cites the article as its source. */
  edgeId: string;
  nodeId: string;
  name: string | null;
  sourceURL: string | null;
  /** ISO, or null where the article has no date we could read. Firestore
   * timestamps go over the wire as `{_seconds}` otherwise, and every caller
   * would have to know that. */
  publishedDate: string | null;
  /** Whether the relation is live for the public, as opposed to a draft only
   * signed in readers are shown. */
  published: boolean;
};

export type NodeMentions = { mentions: NodeMention[] };

/** The articles that name a person or a company.
 *
 * `useEdges` cannot answer this, and the section on the entity page that tried
 * to has always been empty: it reads `/api/graph/local/[id]`, which builds its
 * node map from people, places and regions only and then drops every edge whose
 * far end is not in it. An article is never in it, so every `mentions` edge was
 * filtered out before the page saw it. The article side of the same join has had
 * its own endpoint for this reason since `/api/articles/[id]/relations`; this is
 * that endpoint read from the other end.
 *
 * Both directions, because `mentions` is stored both ways: this app writes
 * article -> person, `ingest/person.post.ts` writes person -> article and
 * produced most of the ones in the database. Deduped per article, preferring the
 * published copy, since the two writers do not know about each other.
 *
 * An article one of this node's relations cites counts too. The piece that is
 * the evidence for "A sits on B's board" names A and B, but it was recorded as
 * `Edge.references` on that relation, and the `mentions` edges saying so were
 * never written - so the article was listed on neither page. It costs no extra
 * query: the relations are already read here, whole, to find the `mentions`
 * among them, and their references go into the one `getAll` below. Only this
 * app writes `references`, by hand, so that is a few documents a page, not a
 * pipeline's worth.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const visible = (await fetchEdgesForNode(db, id))
    .filter((edge) => edge.deleted !== true)
    .filter((edge) => (includeDrafts ? true : pageIsPublic(edge)));

  /** The end of the edge that is not this node. */
  const farId = (edge: (typeof visible)[number]) =>
    edge.source === id ? edge.target : edge.source;

  /** Each article, and the edge that puts it on this page. The `mentions`
   * come first, so that where a mention and a citation are both live the
   * dedupe below keeps the edge that says exactly this. */
  const found = [
    ...visible
      .filter((edge) => edge.type === "mentions")
      .map((edge) => ({ edge, nodeId: farId(edge) })),
    ...visible.flatMap((edge) =>
      citedIds(edge.references).map((nodeId) => ({ edge, nodeId })),
    ),
  ].filter((entry) => entry.nodeId !== id);

  const articleIds = Array.from(new Set(found.map((entry) => entry.nodeId)));
  const snaps = articleIds.length
    ? await db.getAll(
        ...articleIds.map((nodeId) => db.collection("nodes").doc(nodeId)),
      )
    : [];
  const nodes = new Map(snaps.map((snap) => [snap.id, snap.data()]));

  const mentions: NodeMention[] = [];
  for (const { edge, nodeId } of found) {
    const node = nodes.get(nodeId);
    // Only articles. A `mentions` edge should have one at one end, but the
    // ingest paths have written a few pointing elsewhere, and a card built from
    // a person node would render as an article that is not one. A reference to
    // a page since deleted resolves to nothing and goes the same way.
    if (node?.type !== "article") continue;
    // A draft article is not something to show the public even when the edge
    // saying it is live.
    if (!includeDrafts && !pageIsPublic(node)) continue;
    mentions.push({
      edgeId: edge.id,
      nodeId,
      name: typeof node.name === "string" ? node.name : null,
      sourceURL: typeof node.sourceURL === "string" ? node.sourceURL : null,
      publishedDate: toIsoDate(node.publishedDate),
      published: pageIsPublic(edge),
    });
  }

  /** One card per article, whichever way round the edges saying so were
   * stored and however many relations cite it, preferring the published one -
   * it is what the public would be shown and what decides whether the card is
   * drawn as a draft. */
  const byNode = new Map<string, NodeMention>();
  for (const mention of mentions) {
    const seen = byNode.get(mention.nodeId);
    if (!seen || (!seen.published && mention.published)) {
      byNode.set(mention.nodeId, mention);
    }
  }

  // Newest first, undated last: this reads as a press cuttings file, so recency
  // is the order somebody wants it in.
  return {
    mentions: Array.from(byNode.values()).sort((a, b) => {
      if (a.publishedDate === b.publishedDate) {
        return (a.name ?? "").localeCompare(b.name ?? "", "pl");
      }
      if (!a.publishedDate) return 1;
      if (!b.publishedDate) return -1;
      return a.publishedDate < b.publishedDate ? 1 : -1;
    }),
  } satisfies NodeMentions;
});

/** The ids in a relation's `references` that can name a document.
 *
 * Typed as strings, but `edges/create.post.ts` checks no more than that each is
 * a non-empty one, and older documents hold whatever they were written with.
 * `doc()` throws on an id that is not a string, is empty or has a `/` in it, and
 * here that would be one bad citation on any of the node's relations answering
 * with a 500 - the articles its `mentions` edges name gone with it.
 */
function citedIds(
  value: unknown[] | Record<string, unknown> | undefined,
): string[] {
  return asArray(value).filter(
    (ref): ref is string =>
      typeof ref === "string" && ref !== "" && !ref.includes("/"),
  );
}

/** A stored date as an ISO string, whatever shape it is in.
 *
 * Article dates reach the database as a Firestore `Timestamp`, and - for every
 * article written before `sanitizeFirestoreData` stopped taking value types
 * apart - as a `{_seconds, _nanoseconds}` map. Both are read here so a repaired
 * database and an unrepaired one look the same to the page.
 */
function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as {
    toDate?: () => Date;
    _seconds?: number;
    seconds?: number;
  };
  if (typeof stamp.toDate === "function") {
    return stamp.toDate().toISOString();
  }
  const seconds = stamp._seconds ?? stamp.seconds;
  if (typeof seconds === "number") {
    return new Date(seconds * 1000).toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
