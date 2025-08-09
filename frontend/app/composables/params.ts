import type { GraphLayout } from "~~/shared/graph/util";

export function useParams(title: string) {
  const route = useRoute();
  const { data } = useAsyncData("graph", () => $fetch("/api/graph"));
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

  const filtered = computed(() => {
    if (route.query.miejsce && typeof route.query.miejsce === "string") {
      // TODO don't use document title
      document.title = title + nodeGroupsMap.value[route.query.miejsce]?.name;
      return nodeGroupsMap.value[route.query.miejsce]?.connected ?? [];
    }
    return Object.keys(nodes.value);
  });

  const allowEntity = (key: string) => {
    return filtered.value.includes(key);
  };

  return { filtered, allowEntity };
}
