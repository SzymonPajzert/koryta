export function useParams(title: string) {
  const route = useRoute();
  const { nodesFiltered: nodes, nodeGroupsMap } = useGraph();

  // Identifiers of the nodes, that should be returned
  // TODO move the query to the server
  const filtered = computed(() => {
    let keys = Object.keys(nodes.value);

    if (route.query.miejsce && typeof route.query.miejsce === "string") {
      document.title = title + nodeGroupsMap.value[route.query.miejsce]?.name;
      keys = nodeGroupsMap.value[route.query.miejsce]?.connected ?? [];
    }

    if (route.query.partia && typeof route.query.partia === "string") {
      document.title = title + route.query.partia;
      keys = Object.keys(nodes.value).filter((key) => {
        const node = nodes.value[key];
        return node?.parties?.includes(route.query.partia as string);
      });
    }

    return keys;
  });

  const allowEntity = (key: string) => {
    return filtered.value.includes(key);
  };

  return { filtered, allowEntity };
}
