<template id="omni-search">
  <!-- TODO Add a button search on the right, similar to GCP console -->
  <!-- TODO :menu-props="{ scrim: true }" Enable -->
  <!-- TODO List people by the number of their connections -->
  <!-- TODO fix flipping magnifier -->
  <!-- Far in the future ideas:
    Include search history
    Make it a nicer search, e.g. the one on https://dash14.github.io/v-network-graph
  -->
  <v-autocomplete
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
    width="200px"
    density="comfortable"
    :hide-details="true"
    menu-icon="mdi-magnify"
    clearable
    single-line
    @click:clear="nodeGroupPicked = null"
  >
    <template #item="{ props, item }">
      <v-list-item
        v-bind="props"
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

const search = ref("");

type ListItem = {
  title: string;
  subtitle?: string;
  icon: string;
  logEventKey: {content_id: string; content_type: string};
  path?: string;
  query?: Record<string, string>;
};

const { data: graph } = await useAsyncData(
  "graph",
  () => $fetch("/api/graph"),
  { lazy: true },
);

const items = computed<ListItem[]>(() => {
  if (!graph.value) return [];
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
  graph.value.nodeGroups.slice(1).forEach((item) =>
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
    }),
  );
  Object.entries(graph.value.nodes).forEach(([key, value]) => {
    if (value.type == "circle") {
      result.push({
        title: value.name,
        icon: "mdi-account",
        logEventKey: {
          content_id: key,
          content_type: "person",
        },
        path: "/entity/employed/" + key,
      });
    }
  });
  return result;
});

const { push, currentRoute } = useRouter();
const analytics = getAnalytics();

const nodeGroupPicked = ref<ListItem | null>();
const autocompleteFocus = ref(false);
watch(nodeGroupPicked, (value) => {
  if (!value) push("/");
  let path = value.path ?? currentRoute.value.path;
  const allowedPath = path == "/lista" || path == "/graf" || path.startsWith("/entity/employed/");
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
</script>
