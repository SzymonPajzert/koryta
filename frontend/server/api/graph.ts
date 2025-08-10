import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchEntity } from "../utils/fetch";

export default defineEventHandler(async () => {
  const [people, companies, articles] = await Promise.all([
    fetchEntity("employed"),
    fetchEntity("company"),
    fetchEntity("data"),
  ]);

  const nodesNoStats = getNodesNoStats(
    people,
    companies,
    articles,
    partyColors,
  );
  const edges = getEdges(people, companies, articles);
  const nodeGroups = getNodeGroups(nodesNoStats, edges, people, companies);
  const nodes = getNodes(nodeGroups, nodesNoStats);

  // TODO set cache https://firebase.google.com/docs/hosting/manage-cache#set_cache-control
  return { nodesNoStats, edges, nodeGroups, nodes } as GraphLayout;
});
