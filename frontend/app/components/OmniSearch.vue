<template>
  <v-autocomplete
    :id="`omni-search${fake ? '-fake' : ''}`"
    v-model="nodeGroupPicked"
    v-model:focused="autocompleteFocus"
    v-model:search="search"
    label="Szukaj osoby albo miejsca"
    :items="items"
    item-title="title"
    return-object
    autocomplete="off"
    class="ma-2"
    bg-color="white"
    :rounded="true"
    :width
    density="comfortable"
    :hide-details="true"
    menu-icon="mdi-magnify"
    clearable
    single-line
    @click:clear="nodeGroupPicked = null"
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item
        v-bind="itemProps"
        :subtitle="item.raw?.subtitle"
        :title="item.raw.title"
        max-width="400px"
        :prepend-icon="item.raw.icon"
      />
    </template>
    <template #no-data>
      <v-list-item v-if="!search">
        <v-list-item-title> Ładuję dane... </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { getAnalytics, logEvent } from "firebase/analytics";
import type { GraphLayout } from "~~/shared/graph/util";
import { parties } from "~~/shared/misc";
import { useEntityFiltering } from "@/composables/useEntityFiltering";

const { push, currentRoute } = useRouter();
let analytics: any;
if (import.meta.client) {
  analytics = getAnalytics();
}

const props = defineProps<{
  searchText?: string;
  fake?: boolean;
  width?: string;
  autofocus?: boolean;
}>();
const { width = "300px" } = props;

const search = ref(props.searchText);
const nodeGroupPicked = ref<ListItem | null>();
const autocompleteFocus = ref(false);

if (props.fake) {
  watch(
    () => props.searchText,
    (newValue) => {
      search.value = newValue;
      search.value = newValue;
      nodeGroupPicked.value = {
        title: newValue || "",
        icon: "mdi-account",
        logEventKey: { content_id: "", content_type: "" },
      };
    },
  );
}

type ListItem = {
  title: string;
  subtitle?: string;
  icon: string;
  logEventKey: { content_id: string; content_type: string };
  path?: string;
  query?: Record<string, string>;
};

const { authFetch } = useAuthState();
const { data: graph, refresh } = await authFetch<GraphLayout>("/api/graph", {
  lazy: true,
});

const nodes = computed(() => graph.value?.nodes);
const nodesFiltered = useEntityFiltering(nodes);

watch(autocompleteFocus, (focused) => {
  if (focused) {
    refresh();
  }
});

const baseItems = computed<ListItem[]>(() => {
  if (
    !graph.value ||
    !graph.value.nodeGroups ||
    graph.value.nodeGroups.length === 0
  )
    return [];
  const result: ListItem[] = [];
  result.push({
    title: "Lista wszystkich osób",
    subtitle: `${graph.value?.nodeGroups?.[0]?.stats?.people} powiązanych osób`,
    icon: "mdi-format-list-bulleted-type",
    path: "/lista",
    logEventKey: {
      content_id: graph.value?.nodeGroups?.[0]?.id || "",
      content_type: "nodeGroup",
    },
  });
  result.push({
    title: "Graf wszystkich osób",
    subtitle: `${graph.value?.nodeGroups?.[0]?.stats?.people} powiązanych osób`,
    icon: "mdi-graph-outline",
    path: "/graf",
    logEventKey: {
      content_id: graph.value?.nodeGroups?.[0]?.id || "",
      content_type: "nodeGroup",
    },
  });

  parties.forEach((item) => {
    result.push({
      title: item,
      icon: "mdi-flag",
      subtitle: "Partia",
      path: "/lista",
      query: {
        partia: item,
      },
      logEventKey: {
        content_id: item,
        content_type: "party",
      },
    });
  });

  const addedIds = new Set<string>();

  graph.value.nodeGroups.slice(1).forEach((item) => {
    // Check if the group ID (which is a place/region ID) is in pending/hidden state
    // If the group corresponds to a node that is filtered out, skip it.
    // The group ID is `item.id`.
    if (item.id && !nodesFiltered.value?.[item.id]) {
      return;
    }

    addedIds.add(item.id);
    result.push({
      title: item.name,
      subtitle: `${item.stats.people} powiązanych osób`,
      icon: "mdi-domain",
      logEventKey: {
        content_id: item.id,
        content_type: "nodeGroup",
      },
      path: "/entity/place/" + item.id,
    });
  });

  // Now iterate over filtered nodes
  Object.entries(nodesFiltered.value || {}).forEach(([key, value]) => {
    if (addedIds.has(key)) {
      return;
    }
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
    } else if (value.type == "rect") {
      result.push({
        title: value.name,
        icon: "mdi-domain",
        logEventKey: {
          content_id: key,
          content_type: "place",
        },
        path: "/entity/place/" + key,
      });
    }
  });
  return result;
});

const items = computed<ListItem[]>(() => {
  const list = [...baseItems.value];
  if (search.value) {
    list.push({
      title: `Utwórz osobę: "${search.value}"`,
      icon: "mdi-account-plus",
      path: "/edit/node/new",
      query: {
        type: "person",
        name: search.value,
      },
      logEventKey: {
        content_id: "new",
        content_type: "create-person",
      },
    });
    list.push({
      title: `Utwórz firmę: "${search.value}"`,
      icon: "mdi-office-building-plus",
      path: "/edit/node/new",
      query: {
        type: "place",
        name: search.value,
      },
      logEventKey: {
        content_id: "new",
        content_type: "create-place",
      },
    });
  }
  return list;
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
      path.startsWith("/entity/person/") ||
      path.startsWith("/entity/place/") ||
      path.startsWith("/edit/");
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
    if (analytics) {
      logEvent(analytics, "select_content", value.logEventKey);
    }
    autocompleteFocus.value = false;
  });
}
</script>
