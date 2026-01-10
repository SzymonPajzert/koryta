import type { GraphLayout } from "~~/shared/graph/util";

export function useParams(title: string) {
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
