import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async () => {
  const [regions, edges] = await Promise.all([
    fetchNodes("region"),
    fetchEdges(),
  ]);

  // Build target counts (direct connections)
  const targetCounts: Record<string, Set<string>> = {};
  for (const edge of edges) {
    if (!edge.target || !edge.source) continue;
    if (!targetCounts[edge.target]) {
      targetCounts[edge.target] = new Set();
    }
    // We only count unique sources (e.g. people) connected to this target
    targetCounts[edge.target]!.add(edge.source);
  }

  return Object.values(regions).map((region) => ({
    id: region.id as string,
    teryt: region.teryt,
    name: region.name,
    people: region.id ? targetCounts[region.id]?.size || 0 : 0,
  }));
});
