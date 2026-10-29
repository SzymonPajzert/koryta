import type { ElectionRich, PersonRich, Person } from "~~/shared/model";
import type { Edge, Node } from "~~/shared/graph/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { workLocationNames, type PlaceRegion } from "~/utils/companyLocation";
import { rowMatches, type RowEmployment } from "~/utils/rowMatches";
import { candidacyElection } from "~~/shared/electionDays";

import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";

export type UseListWithStatsOptions = {
  /** Set false where the result is only ever read behind a `<ClientOnly>`, so
   * the server does not fetch and serialise a payload nothing will render. */
  server?: boolean;
  /** Region name per company node id, from `useCompanyLocations`.
   *
   * The subgraph reaches a person's employers but not the regions above them,
   * so without this the cities they worked in cannot be worked out and
   * `workLocations` is left absent. */
  companyLocations?: MaybeRefOrGetter<Record<string, string>>;
  /** The region each company is seated in, from `useCompanyLocations`, for a
   * page with a region filter: what the api says matched there is a region,
   * and a row marks the companies seated in it. Without it only the elections
   * in that region are marked. */
  companyRegions?: MaybeRefOrGetter<Record<string, PlaceRegion>>;
};

export async function useListWithStats(
  apiQuery: Ref<Query> | ComputedRef<Query>,
  cacheKey: string,
  options: UseListWithStatsOptions = {},
) {
  const user = useCurrentUser();
  const isAuthReady = useIsCurrentUserLoaded();

  const { data: pageData, pending } = await useAsyncData(
    cacheKey,
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
        matched?: Record<string, string[]>;
        matchedPlaces?: Record<string, string>;
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
        // `subjects`, not `expand`: every row on the page is asked about in
        // its own right. An `expand` is a node a reader clicked on somebody
        // else's graph, and the endpoint draws it a ring out - which here left
        // nine of the ten rows with no companies at all.
        const otherIds = nodes
          .slice(1)
          .map((n) => n.id)
          .join(",");
        try {
          // `latest` only beside the token that allows it. It went out for
          // every reader, and the endpoint took it at its word, so the
          // logged-out table - and the home page's payload, cached for an
          // hour - listed candidacies nobody had published.
          const subRes = await $fetch(`/api/graph/local/${firstId}`, {
            method: "POST",
            body: { subjects: otherIds, distance: 1, latest: !!user.value },
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

      return {
        nodes,
        total,
        subgraphEdges: sEdges,
        subgraphNodes: sNodes,
        matched: nodesRes.matched,
        matchedPlaces: nodesRes.matchedPlaces ?? {},
        // Read with the answer rather than off `apiQuery` later, which moves
        // the moment a filter does - before the rows it describes are back.
        currentOnly: apiQuery.value.currentlyEmployed === "selected",
      };
    },
    {
      watch: [apiQuery, user],
      server: options.server ?? apiQuery.value.visibility !== "private",
      // Use cached payload only while hydrating
      // and always fetch fresh for client-side param changes.
      //
      // With `experimental.granularCachedData` set to true, the
      // built-in getCachedData is consulted on every execute and returns
      // `nuxtApp.static.data[key]` (extracted for SWR/prerendered routes such as `/`).
      // That makes changing `apiQuery` re-serve the stale initial result
      // instead of refetching.
      getCachedData(key, nuxtApp, ctx) {
        if (ctx.cause === "initial" && nuxtApp.isHydrating) {
          return nuxtApp.payload.data[key];
        }
        return undefined;
      },
    },
  );

  const fetchedItems = computed(() => pageData.value?.nodes || []);
  const totalItems = computed(() => pageData.value?.total || 0);
  const subgraphEdges = computed(() => pageData.value?.subgraphEdges || []);
  const subgraphNodes = computed(() => pageData.value?.subgraphNodes || {});

  /** Undefined until the caller supplies a lookup, which is what tells the
   * difference between "no cities" and "nobody asked". */
  const locations = computed(() =>
    options.companyLocations ? toValue(options.companyLocations) : undefined,
  );
  const seats = computed(() =>
    options.companyRegions ? toValue(options.companyRegions) : undefined,
  );

  const tableItems = computed<PersonRich[]>(() => {
    const matched = pageData.value?.matched;
    const matchedPlaces = pageData.value?.matchedPlaces ?? {};
    const currentOnly = pageData.value?.currentOnly ?? false;

    return fetchedItems.value.map((person) => {
      // Reconstruct companies and elections from subgraph
      const companies = new Set<string>();
      const elections: ElectionRich[] = [];

      const employerIds: string[] = [];

      // What the api says put this row here: employers (or companies above
      // them) for a company filter, regions for a region filter. Undefined
      // when the page sets neither.
      const hits = matched
        ? new Set<string>(matched[person.id as string] ?? [])
        : undefined;
      const employments: RowEmployment[] = [];

      const personEdges = subgraphEdges.value.filter(
        (e) => e.source === person.id || e.target === person.id,
      );

      for (const edge of personEdges) {
        const otherNodeId =
          edge.source === person.id ? edge.target : edge.source;
        const otherNode = subgraphNodes.value[otherNodeId];

        if (edge.type === "employed" && otherNode?.entityType === "place") {
          companies.add(otherNode.name);
          employerIds.push(otherNodeId);
          employments.push({
            placeId: otherNodeId,
            name: otherNode.name,
            edge,
          });
        } else if (edge.type === "election") {
          const listYear =
            edge.start_date && typeof edge.start_date === "string"
              ? edge.start_date.split("-")[0]
              : undefined;
          const listLocation = otherNode?.name || "";
          const listPosition = edge.position || edge.name || "Wybory";

          elections.push({
            year: listYear,
            location: listLocation,
            teryt:
              otherNode && "teryt" in otherNode
                ? (otherNode.teryt as string)
                : undefined,
            position: listPosition,
            committee: edge.committee,
            elected:
              typeof edge.elected === "boolean" ? edge.elected : undefined,
            key: candidacyElection(
              edge.start_date,
              edge.position,
              edge.by_election,
            ),
            // Not under `selected`, which matches on the posts held now and
            // never on a candidacy.
            inMatchedRegion:
              !currentOnly && !!hits?.has(otherNodeId) ? true : undefined,
          });
        }
      }

      elections.sort(
        (a, b) => parseInt(a.year || "0", 10) - parseInt(b.year || "0", 10),
      );

      // Get experience from the new stats object
      const edgeStats = user.value
        ? person.stats?.edges?.all
        : person.stats?.edges?.approved;
      const exp = edgeStats?.experienceMonths || 0;
      const latestEmpStr = edgeStats?.latestEmploymentStart;

      return {
        ...person,
        id: person.id as string,
        companies: Array.from(companies),
        ...rowMatches(employments, hits, {
          seats: seats.value,
          matchedPlaces,
          currentOnly,
        }),
        elections,
        experience: Math.floor(exp * 10) / 10,
        latestEmploymentStart: latestEmpStr,
        workLocations: locations.value
          ? workLocationNames(employerIds, locations.value)
          : undefined,
      };
    });
  });

  return { tableItems, totalItems, pending };
}
