import type { Ref } from "vue";
import type { GraphLayout } from "~~/shared/graph/util";
import type { Node as GraphNode, NodeStats, Edge } from "~~/shared/graph/model";
import { authFetch } from "@/composables/auth";

export type GraphOptions = {
  focusNodeId?: string;
  maxDepth?: number;
  filtered?: string[];
  expandedNodes?: Ref<Set<string>>;
};

/**
 * useGraph is a composable that fetches and processes graph data from the backend.
 * It supports fetching a subgraph centered around a focus node with a specified maximum depth.
 * @param opts
 * @returns
 */
export function useGraph(opts: GraphOptions = {}) {
  const url = computed(() => {
    if (opts.focusNodeId) {
      let u = `/api/graph/local/${opts.focusNodeId}?distance=${opts.maxDepth ?? 1}`;
      if (opts.expandedNodes?.value && opts.expandedNodes.value.size > 0) {
        const expand = Array.from(opts.expandedNodes.value)
          .filter((id) => id !== opts.focusNodeId)
          .join(",");
        if (expand) {
          u += `&expand=${expand}`;
        }
      }
      return u;
    }
    return "/api/graph";
  });

  const { data: graph } = authFetch<GraphLayout>(url, { lazy: true });

  const nodeGroupsMap = computed(() => {
    const groups = graph.value?.nodeGroups;
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
  const edges = useEntitiesFiltering(edgesRaw);
  const nodesFiltered1 = useEntitiesFiltering(nodes);

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

  const nodesFiltered = computed(() => {
    if (opts.focusNodeId) {
      return interestingNodes.value;
    }

    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key, _]) =>
        (opts.filtered ?? []).includes(key),
      ),
    );
  });

  const edgesFilteredDuplicates = computed(() => {
    if (opts.focusNodeId && graph.value) {
      return graph.value.edges;
    }
    return edges.value;
  });

  const edgesFiltered = computed(() => {
    if (!edgesFilteredDuplicates.value) return undefined;

    const unique = new Map<string, Edge>();
    for (const edge of edgesFilteredDuplicates.value) {
      if (edge) {
        unique.set(edge.source + edge.target + edge.type, edge);
      }
    }
    return Array.from(unique.values());
  });

  return {
    nodesFiltered,
    nodeGroupsMap,
    edgesFiltered,
    ready,
    url,
  };
}
