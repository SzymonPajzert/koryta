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
    label="Szukaj osoby albo miejsca"
    :items="items"
    item-title="name"
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
  >
    <template #item="{ props, item }">
      <v-list-item
        v-bind="props"
        :subtitle="`${item.raw.stats.people} powiązanych osób`"
        :title="item.raw.name"
        max-width="400px"
        :prepend-icon="item.raw.icon"
      />
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import type { NodeGroup } from "~~/shared/graph/model";
const { data: graph } = await useAsyncData(
  "graph",
  () => $fetch("/api/graph"),
  { lazy: true },
);

const items = computed(() => {
  if (!graph.value) return [];
  const result = [];
  result.push({
    ...graph.value.nodeGroups[0],
    name: "Lista wszystkich osób",
    icon: "mdi-format-list-bulleted-type",
    path: "/lista",
  });
  result.push({
    ...graph.value.nodeGroups[0],
    name: "Graf wszystkich osób",
    icon: "mdi-graph-outline",
    path: "/graf",
  });
  graph.value.nodeGroups
    .slice(1)
    .forEach((item) => result.push({ ...item, icon: "mdi-domain" }));
  return result;
});

const { push, currentRoute } = useRouter();

const nodeGroupPicked = ref<NodeGroup & { path?: string }>();
const autocompleteFocus = ref(false);
watch(nodeGroupPicked, (value) => {
  if (!value) return;
  let path = value.path ?? currentRoute.value.path;
  const allowedPath = path == "/lista" || path == "/graf";
  if (!allowedPath) {
    path = "/lista";
  }
  push({
    path: path,
    query: {
      ...currentRoute.value.query,
      miejsce: value.id,
    },
  });
  autocompleteFocus.value = false;
});
</script>
