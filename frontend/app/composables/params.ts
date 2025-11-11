export function useParams() {
  const route = useRoute();

  const filterName = () => {
    const place =
      route.query.miejsce && typeof route.query.miejsce === "string"
        ? nodeGroupsMap.value[route.query.miejsce]?.name
        : "";

    const party =
      route.query.partia && typeof route.query.partia === "string"
        ? route.query.partia
        : "";

    return `${place} ${party}`.trim();
  };

  return { filterName };
}
