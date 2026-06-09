<template>
  <v-autocomplete
    :id="`omni-search${fake ? '-fake' : ''}`"
    v-model="nodeGroupPicked"
    v-model:focused="autocompleteFocus"
    v-model:search="search"
    label="Szukaj osób, spółek, regionów..."
    :items="items"
    item-title="title"
    item-value="id"
    return-object
    autocomplete="off"
    class="ma-2"
    bg-color="white"
    :rounded="true"
    :width
    density="comfortable"
    :hide-details="true"
    :menu-icon="mdiMagnify"
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
import {
  mdiAccountOutline,
  mdiAccountPlus,
  mdiDomain,
  mdiFlag,
  mdiFormatListBulletedType,
  mdiMagnify,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingPlus,
} from "@mdi/js";
import { parties } from "~~/shared/misc";
import { authFetch } from "@/composables/auth";
import { generateEntityUrl } from "~/composables/slugs";
import type { NodeType } from "~~/shared/model";
import { refDebounced } from "@vueuse/core";

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
const nodeGroupPicked = ref<ListItem | null>(null);
const autocompleteFocus = ref(false);
const debouncedSearch = refDebounced(search, 300);

if (props.fake) {
  watch(
    () => props.searchText,
    (newValue) => {
      search.value = newValue;
    },
  );
}

type ListItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  logEventKey: { content_id: string; content_type: string };
  path?: string;
  query?: Record<string, string>;
};

const { data: searchData, refresh } = authFetch("/api/search", {
  key: "omnisearch-data",
  lazy: true,
  query: computed(() => ({
    // If the user clears the search, immediately use an empty string to bypass debounce
    // This prevents stale requests with the old term when focus triggers a refresh
    q:
      search.value === "" || search.value === null ? "" : debouncedSearch.value,
  })),
});

watch(autocompleteFocus, (focused) => {
  if (focused) {
    refresh();
  }
});

const baseItems = computed<ListItem[]>(() => {
  const result: ListItem[] = [];
  result.push({
    id: "all-persons",
    title: "Lista wszystkich osób",
    icon: mdiFormatListBulletedType,
    path: "/eksploruj/tabela",
    logEventKey: {
      content_id: "",
      content_type: "nodeGroup",
    },
  });

  parties.forEach((item) => {
    result.push({
      id: `party-${item}`,
      title: item,
      icon: mdiFlag,
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

  if (searchData.value) {
    searchData.value.forEach((item) => {
      const itemType = (item.type || "place") as NodeType;

      // Choose icon based on type
      let icon = mdiDomain;
      if (itemType === "person") icon = mdiAccountOutline;
      else if (itemType === "region") icon = mdiMapMarkerRadiusOutline;

      // If the /api/search returns query - use it
      const hasQuery =
        item?.query && Object.values(item.query).filter(Boolean).length > 0;
      const routing: Record<string, unknown> = hasQuery
        ? { path: "/eksploruj/tabela", query: item.query }
        : { path: generateEntityUrl(itemType, item.id!, item.name) };

      result.push({
        id: `entity-${item.id}`,
        title: item.name,
        icon,
        logEventKey: {
          content_id: item.id!,
          content_type: "nodeGroup",
        },
        ...routing,
      });
    });
  }

  return result;
});

const items = computed<ListItem[]>(() => {
  const list = [...baseItems.value];
  if (search.value) {
    list.push({
      id: `create-person-${search.value}`,
      title: `Utwórz osobę: "${search.value}"`,
      icon: mdiAccountPlus,
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
      id: `create-place-${search.value}`,
      title: `Utwórz firmę: "${search.value}"`,
      icon: mdiOfficeBuildingPlus,
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
    path.startsWith("/region/") ||
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
