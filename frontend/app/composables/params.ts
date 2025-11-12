import type { GraphLayout } from "~~/shared/graph/util";

export function useParams() {
  const route = useRoute();
  const { data } = useAsyncData<GraphLayout>("graph", () =>
    $fetch("/api/graph"),
  );
  const nodeGroupsMap = computed(
    () =>
      data.value?.nodeGroups.reduce(
        (acc, curr) => {
          acc[curr.id] = curr;
          return acc;
        },
        {} as Record<string, GraphLayout["nodeGroups"][number]>,
      ) ?? {},
  );
  const nodes = computed(() => data.value?.nodes ?? {});

  // Identifiers of the nodes, that should be returned
  // TODO move the query to the server
  const filtered = computed(() => {
    let keys = Object.keys(nodes.value);

    if (route.query.miejsce && typeof route.query.miejsce === "string") {
      keys = nodeGroupsMap.value[route.query.miejsce]?.connected ?? [];
    }

    if (route.query.partia && typeof route.query.partia === "string") {
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

  return { filtered, allowEntity, filterName };
}
