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
import { parties } from "~~/shared/misc";
import { authFetch } from "@/composables/auth";

const { push, currentRoute } = useRouter();

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

const { data: nodeGroups, refresh } = await authFetch("/api/graph/nodeGroups", {
  lazy: true,
});

watch(autocompleteFocus, (focused) => {
  if (focused) {
    refresh();
  }
});

const baseItems = computed<ListItem[]>(() => {
  if (!nodeGroups.value || nodeGroups.value.length === 0) return [];
  const result: ListItem[] = [];
  result.push({
    title: "Lista wszystkich osób",
    subtitle: `${nodeGroups.value?.[0]?.people ?? 0} powiązanych osób`,
    icon: "mdi-format-list-bulleted-type",
    path: "/lista",
    logEventKey: {
      content_id: nodeGroups.value?.[0]?.id || "",
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

  nodeGroups.value.slice(1).forEach((item) => {
    addedIds.add(item.id);
    const itemType = item.type || "place";

    // Choose icon based on type
    let icon = "mdi-domain";
    if (itemType === "person") icon = "mdi-account-outline";
    else if (itemType === "region") icon = "mdi-map-marker-radius-outline";

    result.push({
      title: item.name,
      subtitle: `${item.people ?? 0} powiązanych osób`,
      icon,
      logEventKey: {
        content_id: item.id,
        content_type: "nodeGroup",
      },
      path: `/entity/${itemType}/` + item.id,
    });
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
  autocompleteFocus.value = false;
});
</script>
