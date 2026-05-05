import type { ElectionRich, PersonRich, Person } from "~~/shared/model";
import type { Edge, Node } from "~~/shared/graph/model";
import type { Query } from "~~/server/api/nodes/index.get";

import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";

export async function useListWithStats(
  apiQuery: Ref<Query> | ComputedRef<Query>,
) {
  const user = useCurrentUser();
  const isAuthReady = useIsCurrentUserLoaded();

  const { data: pageData, pending } = await useAsyncData(
    "tabela-data",
    async () => {
      if (!isAuthReady.value) {
        await new Promise<void>((resolve) => {
          const unwatch = watch(
            isAuthReady,
            (ready) => {
              if (ready) {
                unwatch();
                resolve();
              }
            },
            { immediate: true },
          );
        });
      }

      const headers: HeadersInit = {};
      if (user.value) {
        const token = await user.value.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      // 1. Fetch nodes
      const nodesRes = await $fetch<{
        nodes: Record<string, Person>;
        total?: number;
      }>("/api/nodes", {
        query: apiQuery.value,
        headers,
      });
      const nodes = Object.values(nodesRes.nodes);
      const total: number = nodesRes.total || 0;

      // 2. Fetch subgraph
      let sEdges: Edge[] = [];
      let sNodes: Record<string, Node> = {};

      if (nodes.length > 0) {
        const firstId = nodes[0]?.id;
        const otherIds = nodes
          .slice(1)
          .map((n) => n.id)
          .join(",");
        try {
          const subRes = await $fetch(`/api/graph/local/${firstId}`, {
            method: "POST",
            body: { expand: otherIds, distance: 1, latest: true },
            headers,
          });
          if (subRes) {
            sEdges = subRes.edges || [];
            sNodes = subRes.nodes || {};
          }
        } catch (e) {
          console.error("Failed to fetch subgraph", e);
        }
      }

      return { nodes, total, subgraphEdges: sEdges, subgraphNodes: sNodes };
    },
    {
      watch: [apiQuery, user],
    },
  );

  const fetchedItems = computed(() => pageData.value?.nodes || []);
  const totalItems = computed(() => pageData.value?.total || 0);
  const subgraphEdges = computed(() => pageData.value?.subgraphEdges || []);
  const subgraphNodes = computed(() => pageData.value?.subgraphNodes || {});

  const tableItems = computed<PersonRich[]>(() => {
    return fetchedItems.value.map((person) => {
      // Reconstruct companies and elections from subgraph
      const companies = new Set<string>();
      const elections: ElectionRich[] = [];

      const personEdges = subgraphEdges.value.filter(
        (e) => e.source === person.id || e.target === person.id,
      );

      for (const edge of personEdges) {
        const targetNode = subgraphNodes.value[edge.target];
        if (edge.type === "employed" && targetNode?.entityType === "place") {
          companies.add(targetNode.name);
        } else if (edge.type === "election") {
          const listYear =
            edge.start_date && typeof edge.start_date === "string"
              ? edge.start_date.split("-")[0]
              : undefined;
          const listLocation = subgraphNodes.value[edge.target]?.name || "";
          const listPosition = edge.position || edge.name || "Wybory";

          elections.push({
            year: listYear,
            location: listLocation,
            position: listPosition,
            committee: edge.committee,
          });
        }
      }

      elections.sort(
        (a, b) => parseInt(a.year || "0", 10) - parseInt(b.year || "0", 10),
      );

      // Get experience from the new stats object
      const exp = person.stats?.edges?.approved?.experienceMonths || 0;

      return {
        ...person,
        id: person.id as string,
        companies: Array.from(companies),
        elections,
        experience: Math.floor(exp * 10) / 10,
      };
    });
  });

  return { tableItems, totalItems, pending };
}
