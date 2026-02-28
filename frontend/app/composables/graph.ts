import type { GraphLayout } from "~~/shared/graph/util";
import type { Node as GraphNode, NodeStats } from "~~/shared/graph/model";

export type GraphOptions = {
  focusNodeId?: string;
  maxDepth?: number;
  filtered?: string[];
};

export function useGraph(opts: GraphOptions = {}) {
  const { data: graph } = useAsyncData<GraphLayout>(
    "graph",
    () => $fetch("/api/graph"),
    { lazy: true },
  );
  const { data: layout } = useAsyncData<{
    nodes: Record<string, { x: number; y: number }>;
  }>("layout", () => $fetch("/api/graph/layout"), { lazy: true });

  const { data } = useAsyncData<GraphLayout>("graph", () =>
    $fetch("/api/graph"),
  );
  const nodeGroupsMap = computed(() => {
    const groups = data.value?.nodeGroups;
    if (!Array.isArray(groups)) return {};
    return groups.reduce(
      (acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      },
      {} as Record<string, GraphLayout["nodeGroups"][number]>,
    );
  });

  const nodes = computed(() => graph.value?.nodes);
  const ready = computed(() => !!nodes.value);
  const edgesRaw = computed(() => graph.value?.edges);
  const edges = useEntityFiltering(edgesRaw);
  const nodesFiltered1 = useEntityFiltering(nodes);

  const interestingNodes = computed<
    Record<string, GraphNode & { stats: NodeStats }>
  >(() => {
    return Object.fromEntries(
      Object.entries(nodesFiltered1.value ?? {}).filter(([_, node]) => {
        if (!node) return false;
        // Only show circles (people), documents (articles/regions) or rects (places) with people
        if (node.type === "rect") {
          return node.stats?.people > 0;
        }
        return true;
      }),
    );
  });

  // TODO move it to the backend
  const nodesFiltered = computed(() => {
    // console.log("Canvas.vue: focusNodeId", props.focusNodeId, "maxDepth", props.maxDepth);
    if (opts.focusNodeId) {
      if (!graph.value) return {};
      const depth = opts.maxDepth ?? 3;
      const visited = new Map<string, number>();
      const queue: { id: string; d: number }[] = [
        { id: opts.focusNodeId, d: 0 },
      ];
      visited.set(opts.focusNodeId, 1);

      while (queue.length > 0 && !!edges.value) {
        const current = queue.shift()!;
        if (current.d >= depth) continue;

        const neighbors = edges.value
          .filter((e) => e.source === current.id || e.target === current.id)
          .map((e) => (e.source === current.id ? e.target : e.source));

        for (const neighborId of neighbors) {
          // Skip nodes that represent empty places or are otherwise filtered out
          if (!interestingNodes.value[neighborId]) continue;

          if (!visited.has(neighborId)) {
            visited.set(neighborId, 1);
            queue.push({ id: neighborId, d: current.d + 1 });
          } else {
            visited.set(neighborId, (visited.get(neighborId) ?? 0) + 1);
          }
        }
      }

      return Object.fromEntries(
        Object.entries(interestingNodes.value).filter(
          ([key]) => (visited.get(key) ?? 0) > 1,
        ),
      );
    }

    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key, _]) =>
        (opts.filtered ?? []).includes(key),
      ),
    );
  });

  const edgesFiltered = computed(() => {
    if (opts.focusNodeId && graph.value) {
      const validNodeIds = new Set(Object.keys(nodesFiltered.value));
      return graph.value.edges.filter(
        (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
      );
    }
    return edges.value;
  });

  return {
    nodesFiltered,
    nodeGroupsMap,
    edgesFiltered,
    layout,
    ready,
  };
}
