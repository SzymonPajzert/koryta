import { computed, watch, ref } from "vue";
import { getAnalytics, logEvent } from "firebase/analytics";
import type { Ref } from "vue";

// Explicit imports for Nuxt composables if needed, but they are auto-imported.
// However, compiler might complain.
// If this is a nuxt project, auto-imports work.
// But `useRouter` needs to be available.

// Assuming auto-import works, we just need to fix specific Any usage.
// If auto-import fails in tests/execution, we might need explicit imports 
// or ensure tsconfig is correct.

export interface ListItem {
  title: string;
  subtitle?: string;
  icon: string;
  logEventKey: { content_id: string; content_type: string };
  path?: string;
  query?: Record<string, string>;
  raw?: any; // For vuetify item-props compatibility if needed
}

export function useOmniSearch(props: { fake?: boolean; searchText?: string }) {
  const { push, currentRoute } = useRouter();
  const analytics = getAnalytics();

  const search = ref(props.searchText);
  const nodeGroupPicked = ref<ListItem | null>();
  const autocompleteFocus = ref(false);

  // Monitor fake prop changes
  if (props.fake) {
    watch(
      () => props.searchText,
      (newValue) => {
        search.value = newValue;
        nodeGroupPicked.value = {
            title: newValue || "",
            icon: "mdi-account",
            logEventKey: { content_id: "", content_type: "" },
        };
      }
    );
  }

  const { data: graph } = useAsyncData(
    "graph",
    () => $fetch("/api/graph"),
    { lazy: true }
  );

  const items = computed<ListItem[]>(() => {
    if (!graph.value || !graph.value.nodeGroups || graph.value.nodeGroups.length === 0)
      return [];
    const result: ListItem[] = [];
    result.push({
      title: "Lista wszystkich osób",
      subtitle: `${graph.value.nodeGroups[0].stats.people} powiązanych osób`,
      icon: "mdi-format-list-bulleted-type",
      path: "/lista",
      logEventKey: {
        content_id: graph.value.nodeGroups[0].id,
        content_type: "nodeGroup",
      },
    });
    result.push({
      title: "Graf wszystkich osób",
      subtitle: `${graph.value.nodeGroups[0].stats.people} powiązanych osób`,
      icon: "mdi-graph-outline",
      path: "/graf",
      logEventKey: {
        content_id: graph.value.nodeGroups[0].id,
        content_type: "nodeGroup",
      },
    });
    graph.value.nodeGroups.slice(1).forEach((item: any) =>
      result.push({
        title: item.name,
        subtitle: `${item.stats.people} powiązanych osób`,
        icon: "mdi-domain",
        logEventKey: {
          content_id: item.id,
          content_type: "nodeGroup",
        },
        query: {
          miejsce: item.id,
        },
      })
    );
    Object.entries(graph.value.nodes).forEach(([key, value]: [string, any]) => {
      if (value.type == "circle") {
        result.push({
          title: value.name,
          icon: "mdi-account",
          logEventKey: {
            content_id: key,
            content_type: "person",
          },
          path: "/entity/person/" + key,
        });
      }
    });

    // Map to raw for vuetify if needed, or keep flat structure suitable for item-props
    // The component uses item.raw in template slot.
    return result.map(i => ({ ...i, raw: i }));
  });

  // Monitor the state only if the bar is not fake
  if (!props.fake) {
    watch(nodeGroupPicked, (value) => {
      if (!value) {
          push("/");
          return;
      }
      let path = value?.path ?? currentRoute.value.path;
      const allowedPath =
        path == "/lista" ||
        path == "/graf" ||
        path.startsWith("/entity/person/");
      if (!allowedPath) {
        path = "/lista";
      }
      push({
        path: path,
        query: {
          ...currentRoute.value.query,
          ...value.query,
        },
      });
      logEvent(analytics, "select_content", value.logEventKey);
      autocompleteFocus.value = false;
    });
  }

  return {
    search,
    nodeGroupPicked,
    autocompleteFocus,
    items,
  };
}
