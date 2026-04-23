import type { Ref } from "vue";
import type { Node as GraphNode, NodeStats, Edge } from "~~/shared/graph/model";
import { computed } from "vue";

export type GraphAdjacentOptions = {
  focusNodeIds: Ref<string[]>;
  focusNodeWeights: Ref<Record<string, number>>;
  typeWeights: Ref<Record<string, number>>;
  maxDepth: Ref<number>;
  maxNodes: Ref<number>;
  minScore: Ref<number>;
};

export function useGraphAdjacent(
  nodes: Ref<Record<string, GraphNode & { stats: NodeStats }> | undefined>,
  edges: Ref<Edge[] | undefined>,
  opts: GraphAdjacentOptions,
) {
  const nodeWeights = computed(() => {
    if (!nodes.value || !edges.value || opts.focusNodeIds.value.length === 0) {
      return {};
    }

    const {
      focusNodeIds: focusNodes,
      focusNodeWeights,
      typeWeights,
      maxDepth,
      maxNodes,
      minScore,
    } = opts;

    const scores: Record<string, number> = {};
    const baseNodes = Object.keys(nodes.value);

    // Initialize scores
    for (const id of baseNodes) {
      scores[id] = 0;
    }

    const maxD = maxDepth.value;

    // Helper to get weight multiplier by type
    const getTypeMultiplier = (nodeId: string) => {
      const node = nodes.value![nodeId];
      if (!node) return 1.0;
      if (node.type === "circle") return typeWeights.value.person ?? 1.0;
      if (node.type === "rect") return typeWeights.value.company ?? 1.0;
      return typeWeights.value.region ?? 1.0;
    };

    // Calculate distances from each focus node
    for (const f of focusNodes.value) {
      if (!nodes.value[f]) continue;

      const fWeight = focusNodeWeights.value[f] ?? 1.0;
      
      const visited = new Set<string>();
      const queue: { id: string; d: number }[] = [];
      queue.push({ id: f, d: 0 });
      visited.add(f);

      // BFS
      while (queue.length > 0) {
        const current = queue.shift()!;
        
        // Add contribution
        if (current.d === 0) {
          // It's the focus node itself - we don't decay the score but ensure it stays as base
          scores[current.id] += fWeight;
        } else {
          // Accumulate score with decay
          const decay = Math.pow(0.5, current.d - 1);
          const contribution = fWeight * decay;
          scores[current.id] += contribution;
        }

        if (current.d >= maxD) continue;

        // Find neighbors
        const neighbors = edges.value
          .filter((e) => e.source === current.id || e.target === current.id)
          .map((e) => (e.source === current.id ? e.target : e.source));

        for (const neighborId of neighbors) {
          if (!nodes.value[neighborId]) {
            continue;
          }

          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push({ id: neighborId, d: current.d + 1 });
          }
        }
      }
    }

    // Apply type weights directly to the accumulated scores. 
    // And ensure focus nodes aren't filtered out by treating their scores specially or just setting very high value.
    for (const [id, score] of Object.entries(scores)) {
      if (focusNodes.value.includes(id)) {
        // We ensure focus nodes have a very high score so they always remain visible
        // But for visual purporses, we can keep their value as proportional. We'll add a flat bonus.
        scores[id] = Math.max(score * getTypeMultiplier(id), 1000 + score);
      } else {
        scores[id] = score * getTypeMultiplier(id);
      }
    }

    // Filter by minScore and Top N
    const sorted = Object.entries(scores)
      .filter(([id, score]) => score > minScore.value || focusNodes.value.includes(id))
      .sort((a, b) => b[1] - a[1]);

    // Truncate to maxNodes
    const topScores = Object.fromEntries(sorted.slice(0, maxNodes.value));
    return topScores;
  });

  return {
    nodeWeights,
    // pending could be based on whether edges/nodes are available, but that's handled by useGraph mostly
  };
}
