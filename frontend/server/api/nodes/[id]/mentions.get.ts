import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { fetchEdgesForNode } from "~~/server/utils/edgePublication";
import { asArray, pageIsPublic } from "~~/shared/model";
import { normalizeUrl, normalizeUrlIgnoringPage } from "~~/shared/url";

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

  /** One card per article. The same article reaches this list more than once
   * in three ways, and each pass folds one of them:
   *
   * - one node, named by edges stored both ways round, or cited by several of
   *   this node's relations;
   * - two nodes for one url, which `normalizeUrl` calls the same address -
   *   the 2026-09-29 export holds five such pairs;
   * - a node at a numbered page of an article that is on the list at its own
   *   address, under the same title: `/artykuly/56911/?page=1#komentarz`
   *   folds into `/artykuly/56911/` on Dariusz Bielski's page - the second
   *   page of its comments, and the article. The title has to be there and
   *   agree, and one of the two has to have no `page` at all, because a site
   *   may number its pages with `page`: „Aktualności” at `?page=2` and at
   *   `?page=3` are two lists of news. The title could not decide on its own
   *   either - five different Facebook pages are all stored as "Facebook",
   *   and two PKW candidates' pages share a title too.
   */
  const byNode = collapse(mentions, (mention) => `id:${mention.nodeId}`);
  const byAddress = collapse(byNode, (mention) =>
    mention.sourceURL
      ? `url:${normalizeUrl(mention.sourceURL)}`
      : `id:${mention.nodeId}`,
  );
  const unpaged = new Set(
    byAddress.filter((mention) => !paged(mention)).map(titleKey),
  );
  const cards = collapse(byAddress, (mention) => {
    const key = titleKey(mention);
    return key && unpaged.has(key) ? `title:${key}` : `id:${mention.nodeId}`;
  });

  // Newest first, undated last: this reads as a press cuttings file, so recency
  // is the order somebody wants it in.
  return {
    mentions: cards.sort((a, b) => {
      if (a.publishedDate === b.publishedDate) {
        return (a.name ?? "").localeCompare(b.name ?? "", "pl");
      }
      if (!a.publishedDate) return 1;
      if (!b.publishedDate) return -1;
      return a.publishedDate < b.publishedDate ? 1 : -1;
    }),
  } satisfies NodeMentions;
});

/** `mentions` with one card for each `key`: of the cards that share one, the
 * preferred, in the place of the first. */
function collapse(
  mentions: NodeMention[],
  key: (mention: NodeMention) => string,
): NodeMention[] {
  const kept = new Map<string, NodeMention>();
  for (const mention of mentions) {
    const card = key(mention);
    const seen = kept.get(card);
    if (!seen || preferred(mention, seen)) kept.set(card, mention);
  }
  return Array.from(kept.values());
}

/** Whether `candidate` is the better card of two for one article.
 *
 * The published one first - it is what the public would be shown, and what
 * decides whether the card is drawn as a draft. Then the one at the article's
 * own address rather than at a page of its comments. */
function preferred(candidate: NodeMention, kept: NodeMention): boolean {
  if (candidate.published !== kept.published) return candidate.published;
  return paged(kept) && !paged(candidate);
}

/** The article's address without its page number, and its title - or
 * undefined for a card that lacks either, which is folded by address alone. */
function titleKey(mention: NodeMention): string | undefined {
  if (!mention.sourceURL || !mention.name) return undefined;
  return JSON.stringify([
    normalizeUrlIgnoringPage(mention.sourceURL),
    mention.name,
  ]);
}

function paged(mention: NodeMention): boolean {
  return (
    !!mention.sourceURL &&
    normalizeUrl(mention.sourceURL) !==
      normalizeUrlIgnoringPage(mention.sourceURL)
  );
}

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
