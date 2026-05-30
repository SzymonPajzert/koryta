<template>
  <v-autocomplete
    :id="`omni-search${fake ? '-fake' : ''}`"
    v-model="nodeGroupPicked"
    v-model:focused="autocompleteFocus"
    v-model:search="search"
    label="Szukaj osób, spółek, regionów..."
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
    variant="solo-filled"
    @click:clear="nodeGroupPicked = null"
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item
        v-bind="itemProps"
        :subtitle="item.raw?.subtitle"
        :title="item.raw.title"
        max-width="400px"
        :prepend-icon="item.raw.icon"
        :to="
          noNavigate
            ? undefined
            : {
                path: item.raw.path || currentRoute.path,
                query: { ...currentRoute.query, ...item.raw.query },
              }
        "
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
import { generateEntityUrl } from "~/composables/slugs";
import type { NodeType } from "~~/shared/model";

const { push, currentRoute } = useRouter();

const props = defineProps<{
  searchText?: string;
  fake?: boolean;
  width?: string;
  autofocus?: boolean;
  noNavigate?: boolean;
}>();
const { width = "300px" } = props;

const emit = defineEmits<{
  (e: "select", item: ListItem): void;
}>();

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

const { data: nodeGroups, refresh } = authFetch("/api/graph/nodeGroups", {
  key: "omnisearch-node-groups",
  lazy: true,
});

watch(autocompleteFocus, (focused) => {
  if (focused) {
    refresh();
  }
});

const connectedPeopleString = (n: number) =>
  polishCounting(n, "powiązana osoba", "powiązane osoby", "powiązanych osób");

const baseItems = computed<ListItem[]>(() => {
  if (!nodeGroups.value || nodeGroups.value.length === 0) return [];
  const result: ListItem[] = [];
  result.push({
    title: "Lista wszystkich osób",
    subtitle: `${connectedPeopleString(nodeGroups.value?.[0]?.people ?? 0)}`,
    icon: "mdi-format-list-bulleted-type",
    path: "/eksploruj/tabela",
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
      path: "/eksploruj/tabela",
      query: {
        party: item,
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
    const itemType = (item.type || "place") as NodeType;

    // Choose icon based on type
    let icon = "mdi-domain";
    if (itemType === "person") icon = "mdi-account-outline";
    else if (itemType === "region") icon = "mdi-map-marker-radius-outline";

    result.push({
      title: item.name,
      subtitle: `${connectedPeopleString(item.people ?? 0)}`,
      icon,
      logEventKey: {
        content_id: item.id,
        content_type: "nodeGroup",
      },
      path: generateEntityUrl(itemType, item.id, item.name),
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
    return;
  }

  if (props.noNavigate) {
    emit("select", value);
    // Clear selections to allow picking another right away
    setTimeout(() => {
      nodeGroupPicked.value = null;
      search.value = "";
      autocompleteFocus.value = false;
    }, 50);
    return;
  }

  let path = value?.path ?? currentRoute.value.path;
  const allowedPath =
    path == "/graf" ||
    path.startsWith("/eksploruj/tabela") ||
    path.startsWith("/entity/person/") ||
    path.startsWith("/entity/region/teryt1261") ||
    path.startsWith("/region/krakow-teryt1261") ||
    path.startsWith("/osoba/") ||
    path.startsWith("/instytucja/") ||
    path.startsWith("/artykul/") ||
    path.startsWith("/edit/");
  if (!allowedPath) {
    path = "/eksploruj/tabela";
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
