import { useGraphStore } from "@/stores/graph";

export function useParams(title: string) {
  const route = useRoute();
  const graphStore = useGraphStore();
  const { nodeGroupsMap, nodes } = storeToRefs(graphStore);

  const filtered = computed(() => {
    if (route.query.miejsce && typeof route.query.miejsce === "string") {
      document.title = title + nodeGroupsMap.value[route.query.miejsce].name;
      return nodeGroupsMap.value[route.query.miejsce].connected;
    }
    return Object.keys(nodes.value);
  });

  return { filtered };
}
