import type { Firestore } from "firebase-admin/firestore";
import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchEdgesClose, fetchNodesByIds } from "~~/server/utils/fetch";
import {
  edgesCitingArticles,
  nodesMentionedByArticles,
} from "~~/server/utils/topics";
import type { Edge, EdgeType, Person, Company, Region } from "~~/shared/model";

/** The relation kinds worth drawing around somebody the article names.
 *
 * A `mentions` or `tagged` edge has an article or a topic at its far end and
 * neither is drawn here, so following one would fetch a node only to throw it
 * away; a `comment` is not a relation between people at all.
 */
const NEIGHBOUR_EDGE_TYPES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  "employed",
  "connection",
  "owns",
  "election",
]);

/** The people a set of articles puts on the record.
 *
 * Two things go in. The articles' `references` give the relations somebody drew
 * from them, which are the edges; the articles' `mentions` give the people they
 * name, who are nodes whether or not a relation has been drawn from them yet -
 * somebody who has just been recorded as named in a story should appear in it,
 * and waiting for a relation would mean they only ever appear once the work of
 * connecting them is already done.
 *
 * Neither the articles nor the topic are drawn: `getNodesNoStats` builds nodes
 * for people, places and regions only. That is the point - what a reader wants
 * from a story is who is in it, not a diagram of our filing.
 *
 * Unlike `/api/graph/local/[id]` there is no BFS. What the articles say *is*
 * the answer, so every node reached is wanted and nothing is reached by
 * traversal - except for the one hop `expandMentions` asks for, below.
 */
export async function graphForArticles(
  db: Firestore,
  articleIds: string[],
  includeDrafts: boolean,
  options: {
    /** Draw each named person's immediate connections around them.
     *
     * Somebody recorded as mentioned and nothing else is a dot on an empty
     * canvas: the graph says they are in the story and nothing more. Their own
     * relations are the context that makes the dot worth looking at - who they
     * work for, who they sit on a board with - so a page about one article asks
     * for them.
     *
     * People only, and only those the article names. A place is the hub of an
     * unbounded number of relations - a ministry has thousands - so expanding
     * one would bury the article's own people in its staff list, and the second
     * hop out from a person is where a local graph stops being local anyway.
     *
     * A story's page does not ask: it already draws every article's people, so
     * a hop out from each of them is that many times more of a graph that is
     * usually crowded to begin with.
     */
    expandMentions?: boolean;
  } = {},
): Promise<GraphLayout> {
  const [cited, mentioned] = await Promise.all([
    edgesCitingArticles(db, articleIds, includeDrafts),
    nodesMentionedByArticles(db, articleIds, includeDrafts),
  ]);

  const fromArticles = Array.from(
    new Set([
      ...cited.flatMap((edge) => [edge.source, edge.target]),
      ...mentioned,
    ]),
  );
  const nodesRaw = await fetchNodesByIds(fromArticles);

  let edgesRaw: (Edge & { id: string })[] = cited;
  if (options.expandMentions) {
    const named = new Set(mentioned);
    const namedPeople = nodesRaw
      .filter((node) => node.type === "person" && node.id && named.has(node.id))
      .map((node) => node.id as string);

    const neighbours = (await fetchEdgesClose(namedPeople)).filter(
      (edge) =>
        NEIGHBOUR_EDGE_TYPES.has(edge.type) &&
        edge.deleted !== true &&
        (includeDrafts || edge.visibility),
    ) as (Edge & { id: string })[];

    // By id, because a relation citing the article is also a relation the
    // person has, and the cited one is the copy that has already been checked.
    const byId = new Map(edgesRaw.map((edge) => [edge.id, edge]));
    for (const edge of neighbours)
      if (!byId.has(edge.id)) byId.set(edge.id, edge);
    edgesRaw = Array.from(byId.values());

    const reached = new Set(fromArticles);
    const far = edgesRaw
      .flatMap((edge) => [edge.source, edge.target])
      .filter((id) => !reached.has(id));
    if (far.length) nodesRaw.push(...(await fetchNodesByIds(far)));
  }

  const people: Record<string, Person> = {};
  const places: Record<string, Company> = {};
  const regions: Record<string, Region> = {};
  for (const node of nodesRaw) {
    if (!node.id) continue;
    // A draft endpoint is only drawn for someone who may see drafts, or a story
    // would advertise the existence of pages they cannot open.
    if (!includeDrafts && !node.visibility) continue;
    if (node.type === "person") people[node.id] = node;
    else if (node.type === "place") places[node.id] = node;
    else if (node.type === "region") regions[node.id] = node;
  }

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));

  const edges = getEdges(
    edgesRaw.filter(
      (edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target),
    ),
  );
  const nodeGroups = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );

  return { edges, nodes: getNodes(nodeGroups, nodesNoStats), nodeGroups };
}
