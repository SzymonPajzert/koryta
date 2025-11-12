import { simulation } from "~~/shared/graph/simulation";
import * as d3 from "d3-force";

type NodeLocation = {
  id: string;
  x?: number;
  y?: number;
};

export default defineEventHandler(async (event) => {
  const graph = await event.$fetch("/api/graph");

  // Hotfix add missing nodes (maybe some of them are removed from DB)
  const edges = graph.edges.filter((edge) => {
    // Filter out empty strings
    return graph.nodes[edge.source] && graph.nodes[edge.target];
  });
  const nodeList: NodeLocation[] = Object.entries(graph.nodes).map(
    ([key, node]) => ({
      id: key,
      // Throw away documents, so they are not clumped in the center
      x: node.type == "document" ? -1000 : undefined,
      y: node.type == "document" ? -1000 : undefined,
    }),
  );

  const simulationFunction = simulation(true);
  simulationFunction(d3, nodeList, edges).restart();

  const layouts = Object.fromEntries(
    nodeList.map((node) => [node.id, { x: node.x!, y: node.y! }]),
  );

  const result: { nodes: Record<string, { x: number; y: number }> } = {
    nodes: layouts,
  };
  return result;
});
