import { authFetch } from "@/composables/auth";
import { getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";
import type { Company, Edge, PersonRich, Region } from "~~/shared/model";

export async function useEntityListRich(
  // TODO this is badly typed
  company: Ref<[string, string] | undefined>,
  region: Ref<[string, string] | undefined>,
  places: Ref<Record<string, Company> | undefined>,
  regions: Ref<Record<string, Region> | undefined>,
) {
  const { entities: people } = useEntities("person");
  const { data: edgesData, pending: edgesPending } =
    await authFetch<Edge[]>("/api/graph/edges");

  const loading = computed(() => {
    return (
      !people.value ||
      !places.value ||
      !regions.value ||
      edgesPending.value ||
      Object.keys(people.value).length === 0
    );
  });

  const route = useRoute();

  const peopleRich = computed<PersonRich[]>(() => {
    if (loading.value) return [];

    const terytParam = route.query.teryt as string | undefined;
    const krsParam = route.query.krs as string | undefined;

    const peopleObj = people.value ?? {};
    const placesObj = places.value ?? {};
    const regionsObj = regions.value ?? {};
    const edgesArray = edgesData.value || [];

    const nodesNoStats = getNodesNoStats(
      peopleObj,
      placesObj,
      regionsObj,
      partyColors,
    );
    const validNodeIds = new Set(Object.keys(nodesNoStats));
    const validEdges = edgesArray.filter(
      (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
    );

    const nodeGroupsRaw = getNodeGroups(
      nodesNoStats,
      validEdges,
      peopleObj,
      placesObj,
      regionsObj,
    );

    let allowedIdsFromRegion = new Set<string>();
    if (region.value) {
      const regionID = region.value[0];
      const rGroup = nodeGroupsRaw.find((g) => g.id === regionID);
      if (rGroup) allowedIdsFromRegion = new Set(rGroup.connected);
    }

    let allowedIdsFromCompany = new Set<string>();
    if (company.value) {
      const companyID = company.value[0];
      const cGroup = nodeGroupsRaw.find((g) => g.id === companyID);
      if (cGroup) allowedIdsFromCompany = new Set(cGroup.connected);
    }

    const edgeSourceMap = new Map<string, Edge[]>();
    for (const edge of edgesArray) {
      if (!edgeSourceMap.has(edge.source)) edgeSourceMap.set(edge.source, []);
      edgeSourceMap.get(edge.source)!.push(edge);
    }

    const items: Array<PersonRich> = [];

    for (const [personId, person] of Object.entries(peopleObj)) {
      if (krsParam && !allowedIdsFromCompany.has(personId)) continue;
      if (terytParam && !allowedIdsFromRegion.has(personId)) continue;

      const personEdges = edgeSourceMap.get(personId) || [];
      const companiesList = [];
      const electionsList = [];
      let experienceMonths = 0;

      for (const edge of personEdges) {
        if (edge.type === "employed" && placesObj[edge.target]) {
          companiesList.push(placesObj[edge.target]?.name);

          const startStr =
            edge.start_date && typeof edge.start_date === "string"
              ? edge.start_date.split("T")[0]
              : null;
          const endStr =
            edge.end_date && typeof edge.end_date === "string"
              ? edge.end_date.split("T")[0]
              : null;

          const start = startStr ? new Date(startStr) : null;
          const end = endStr ? new Date(endStr) : new Date();

          if (start && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const diffMs = end.getTime() - start.getTime();
            experienceMonths += diffMs / (1000 * 60 * 60 * 24 * 30.44);
          }
        } else if (edge.type === "election") {
          const listYear =
            edge.start_date && typeof edge.start_date === "string"
              ? edge.start_date.split("-")[0]
              : undefined;
          const listLocation =
            regionsObj[edge.target]?.name || placesObj[edge.target]?.name;
          const listPosition = edge.position || edge.name || "Wybory";

          electionsList.push(
            JSON.stringify({
              year: listYear,
              location: listLocation,
              position: listPosition,
              committee: edge.committee,
            }),
          );
        }
      }

      items.push({
        ...person,
        id: personId,
        companies: Array.from(new Set(companiesList)),
        elections: Array.from(new Set(electionsList))
          .map((e) => JSON.parse(e))
          .sort((a, b) => a.year - b.year),
        experience: Math.floor((experienceMonths / 12) * 10) / 10,
        visibility: person.visibility || false,
      });
    }

    return items;
  });

  return { people: peopleRich, loading };
}
