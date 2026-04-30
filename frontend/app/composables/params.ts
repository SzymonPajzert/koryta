import type { Filters } from "@/composables/entity";

export function useParams() {
  const route = useRoute();

  // Identifiers of the nodes, that should be returned
  // TODO move the query to the server
  const filters = computed<Filters>(() => {
    const result: Filters = {};
    if (route.query.miejsce && typeof route.query.miejsce === "string") {
      result.place = route.query.miejsce;
    }
    if (route.query.partia && typeof route.query.partia === "string") {
      result.party = route.query.partia;
    }
    if (route.query.source && typeof route.query.source === "string") {
      result.source = route.query.source;
    }
    return result;
  });

  return { filters };
}
