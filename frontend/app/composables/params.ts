export function useParams() {
  const route = useRoute();

  const filterName = computed(() => {
    const place = "";
    // TODO
    // route.query.miejsce && typeof route.query.miejsce === "string"
    //   ? nodeGroupsMap.value[route.query.miejsce]?.name
    //   : "";

    const party =
      route.query.partia && typeof route.query.partia === "string"
        ? route.query.partia
        : "";

    return `${place} ${party}`.trim();
  });

  /** queryParams returns from route params that can be used to fetch the given view */
  const queryParams = computed(() => ({
    place: route.query.miejsce,
    party: route.query.partia,
    // TODO id: route.query.id,
  }));

  return { filterName, queryParams };
}
