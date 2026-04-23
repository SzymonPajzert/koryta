import type { Ref } from "vue";
import type { GraphLayout } from "~~/shared/graph/util";
import type { Node as GraphNode, NodeStats, Edge } from "~~/shared/graph/model";
import { useAuthState } from "@/composables/auth";

export type GraphOptions = {
  focusNodeId?: string;
  focusNodeIds?: Ref<string[]>;
  maxDepth?: number;
  maxDepthRef?: Ref<number>;
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
  const { idToken } = useAuthState();

  // If we have focusNodeIds, we ignore focusNodeId and build multiple URLs.
  // Otherwise, we fallback to old behavior but adapt it to work with our new fetch.
  const { data: graph, pending } = useAsyncData<GraphLayout>(
    "multi-graph",
    async () => {
      // Delay fetching until we have an auth token if not server side
      if (!import.meta.server && !idToken.value) {
        await new Promise<void>((resolve) => {
          const unwatch = watch(
            idToken,
            (val) => {
              if (val) {
                unwatch();
                resolve();
              }
            },
            { immediate: true },
          );
        });
      }

      const headers = new Headers();
      if (idToken.value) {
        headers.set("Authorization", `Bearer ${idToken.value}`);
      }

      const depth = opts.maxDepthRef?.value ?? opts.maxDepth ?? 1;
      const ids = opts.focusNodeIds?.value || (opts.focusNodeId ? [opts.focusNodeId] : []);

      if (ids.length === 0) {
        // Global graph
        return await $fetch<GraphLayout>("/api/graph", { headers, query: { latest: true } });
      }

      const fetchGraph = async (id: string, allowExpand: boolean) => {
        let u = `/api/graph/local/${id}?distance=${depth}`;
        if (allowExpand && opts.expandedNodes?.value && opts.expandedNodes.value.size > 0) {
          const expand = Array.from(opts.expandedNodes.value)
            .filter((eid) => eid !== id)
            .join(",");
          if (expand) {
            u += `&expand=${expand}`;
          }
        }
        return await $fetch<GraphLayout>(u, { headers, query: { latest: true } });
      };

      const results = await Promise.all(
        ids.map((id) => fetchGraph(id, ids.length === 1)) // Assert expand is only for single nodes
      );

      // Merge multiple graphs
      const merged: GraphLayout = {
        edges: [],
        nodes: {},
        nodeGroups: [],
      };

      const seenEdges = new Set<string>();
      const seenNodes = new Set<string>();
      const seenGroups = new Set<string>();

      for (const res of results) {
        for (const edge of res.edges) {
          const edgeId = edge.id || `${edge.source}-${edge.target}-${edge.type}`;
          if (!seenEdges.has(edgeId)) {
            seenEdges.add(edgeId);
            merged.edges.push(edge);
          }
        }
        for (const [nodeId, node] of Object.entries(res.nodes)) {
          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            merged.nodes[nodeId] = node;
          } else {
             // Take max people stat if node exists
             if (node.stats?.people > merged.nodes[nodeId].stats?.people) {
               merged.nodes[nodeId].stats.people = node.stats.people;
             }
          }
        }
        for (const group of res.nodeGroups) {
          if (!seenGroups.has(group.id)) {
            seenGroups.add(group.id);
            merged.nodeGroups.push(group);
          }
        }
      }

      return merged;
    },
    { 
      watch: [opts.focusNodeIds, opts.expandedNodes, opts.maxDepthRef, idToken],
      lazy: true 
    }
  );

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
    const hasFocus = opts.focusNodeId || (opts.focusNodeIds?.value && opts.focusNodeIds.value.length > 0);
    if (hasFocus) {
      return interestingNodes.value;
    }

    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key, _]) =>
        (opts.filtered ?? []).includes(key),
      ),
    );
  });

  const edgesFilteredDuplicates = computed(() => {
    const hasFocus = opts.focusNodeId || (opts.focusNodeIds?.value && opts.focusNodeIds.value.length > 0);
    if (hasFocus && graph.value) {
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
    pending,
  };
}
