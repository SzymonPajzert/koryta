import type { Firestore } from "firebase-admin/firestore";
import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { withCoCandidates } from "~~/shared/graph/coCandidates";
import { fetchEdgesClose, fetchNodesByIds } from "~~/server/utils/fetch";
import {
  edgesCitingArticles,
  nodesMentionedByArticles,
} from "~~/server/utils/topics";
import type { Edge, EdgeType, Person, Company, Region } from "~~/shared/model";

/** The relation kinds worth drawing around somebody in the story.
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
 * traversal - except for the one hop `expand` asks for, below.
 */
export async function graphForArticles(
  db: Firestore,
  articleIds: string[],
  includeDrafts: boolean,
  options: {
    /** Draw the immediate connections of the people in the story around them.
     *
     * Somebody in the graph and nothing else is a dot on an empty canvas: it
     * says they are in the story and nothing more. Their own relations are the
     * context that makes the dot worth looking at - who they work for, who they
     * sit on a board with.
     *
     * - `"mentions"` expands the people the articles *name*. What an article's
     *   own page asks for: whoever is at the end of a relation drawn from the
     *   article is already there with the relation that put them there.
     * - `"people"` expands every person drawn, however they got in. What a
     *   story asks for: across a dozen articles most people arrive through a
     *   relation citing one of them, and under `"mentions"` those were the ones
     *   left as bare dots.
     *
     * People either way. A place is the hub of an unbounded number of relations
     * - a ministry has thousands - so expanding one would bury the story's own
     * people in its staff list, and the second hop out from a person is where a
     * local graph stops being local anyway.
     *
     * A story pays for this in size: one hop from everybody in it is a much
     * larger graph than the articles alone, and a crowded affair draws a
     * crowded canvas.
     */
    expand?: "mentions" | "people";
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
  if (options.expand) {
    const named = new Set(mentioned);
    const expanding = nodesRaw
      .filter(
        (node) =>
          node.type === "person" &&
          node.id &&
          (options.expand === "people" || named.has(node.id)),
      )
      .map((node) => node.id as string);

    const neighbours = (await fetchEdgesClose(expanding)).filter(
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

  // A story rarely cites a candidacy, so this usually adds nothing; when one
  // does, two of its people who stood on the same list are joined to each other
  // here exactly as they are on a region page.
  return withCoCandidates({
    edges,
    nodes: getNodes(nodeGroups, nodesNoStats),
    nodeGroups,
  });
}
