import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";
import type { Edge, EdgeType, NodeType } from "~~/shared/model";

/** One relation an article is cited by, as the article page lists it. */
export type SourcedEdge = {
  id: string;
  type: EdgeType;
  name: string | null;
  source: string;
  target: string;
  sourceName: string | null;
  targetName: string | null;
  /** Needed to build each end's url, which is why this resolves its own
   * endpoints rather than calling `resolveEdgeEndpoints` - that one answers a
   * reviewer's question about publishability and does not carry the type. */
  sourceType: NodeType | null;
  targetType: NodeType | null;
  start_date?: string;
  end_date?: string;
  published: boolean;
  /** Every article this relation rests on, this one included. A claim can be
   * supported by several, and the article page says how many others there are
   * rather than implying it stands on this one alone. */
  references: string[];
};

const queryValidator = z.object({
  articleId: z.string().min(1),
});

/** The relations that cite an article.
 *
 * `Edge.references` holds them, and this is the only way to ask the question
 * from the article's end. The local graph cannot answer it: `fetchEdgesClose`
 * returns the edges an article is the `source` or `target` of, and an edge that
 * merely cites the article is neither. `useEdges` filtered that set for
 * `references.includes(id)` and so was guaranteed to find nothing, which is why
 * "Artykuł stanowi źródło dla:" had never rendered a row.
 *
 * A signed in reader sees relations that are still drafts, the same rule the
 * graph endpoint applies - see `wantsLatest`. Everyone else sees the published
 * ones.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const includeDrafts = await wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const snapshot = await db
    .collection("edges")
    .where("references", "array-contains", query.articleId)
    .get();

  const edges = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Edge) }))
    .filter((edge) => edge.deleted !== true)
    .filter((edge) => (includeDrafts ? true : pageIsPublic(edge)));

  const endpointIds = Array.from(
    new Set(edges.flatMap((edge) => [edge.source, edge.target])),
  );
  const snaps = endpointIds.length
    ? await db.getAll(
        ...endpointIds.map((nodeId) => db.collection("nodes").doc(nodeId)),
      )
    : [];
  const nodes = new Map(snaps.map((snap) => [snap.id, snap.data()]));

  const nameOf = (nodeId: string) => {
    const name = nodes.get(nodeId)?.name;
    return typeof name === "string" ? name : null;
  };
  const typeOf = (nodeId: string) =>
    (nodes.get(nodeId)?.type as NodeType | undefined) ?? null;

  const sourced: SourcedEdge[] = edges.map((edge) => ({
    id: edge.id,
    type: edge.type,
    name: typeof edge.name === "string" && edge.name ? edge.name : null,
    source: edge.source,
    target: edge.target,
    sourceName: nameOf(edge.source),
    targetName: nameOf(edge.target),
    sourceType: typeOf(edge.source),
    targetType: typeOf(edge.target),
    start_date: edge.start_date,
    end_date: edge.end_date,
    published: pageIsPublic(edge),
    references: Array.isArray(edge.references) ? edge.references : [],
  }));

  // Drafts first: on an article page they are the rows somebody still has to
  // act on, and everything else is already settled.
  sourced.sort((a, b) => {
    if (a.published !== b.published) return a.published ? 1 : -1;
    return (a.sourceName ?? "").localeCompare(b.sourceName ?? "", "pl");
  });

  return { edges: sourced };
});
