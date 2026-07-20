<template>
  <div style="display: contents">
    <v-autocomplete
      id="omni-search"
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
      :loading="loading"
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
        />
      </template>
      <template #no-data>
        <v-list-item v-if="!search">
          <v-list-item-title> Ładuję dane... </v-list-item-title>
        </v-list-item>
      </template>
      <!-- Rendered after the results and, when nothing matched, as the empty
         state. Adding a person is the main way new entries get created. -->
      <template #append-item>
        <template v-if="createName">
          <v-divider class="my-1" />
          <v-list-item
            data-testid="omni-search-add-person"
            :prepend-icon="mdiAccountPlusOutline"
            @click="openCreatePerson"
          >
            <v-list-item-title>
              Dodaj nową osobę "{{ createName }}"
            </v-list-item-title>
          </v-list-item>
        </template>
      </template>
    </v-autocomplete>

    <DialogProposeEditNode
      ref="createPersonDialog"
      create-type="person"
      :initial-name="pendingCreateName"
      hide-activator
      @created="onPersonCreated"
    />
  </div>
</template>

<script setup lang="ts">
import {
  mdiAccountOutline,
  mdiAccountPlusOutline,
  mdiDomain,
  mdiFlag,
  mdiFormatListBulletedType,
  mdiMagnify,
  mdiMapMarkerRadiusOutline,
} from "@mdi/js";
import { parties } from "~~/shared/misc";
import { generateEntityUrl } from "~/composables/slugs";
import type { NodeType } from "~~/shared/model";
import { refDebounced } from "@vueuse/core";

const { push, currentRoute } = useRouter();

const props = defineProps<{
  width?: string;
}>();
const { width = "300px" } = props;

const loading = ref(false);
const search = ref();
const nodeGroupPicked = ref<ListItem | null>(null);
const autocompleteFocus = ref(false);
const debouncedSearch = refDebounced(search, 300);
const createPersonDialog = ref<{ open: () => void } | null>(null);

/** The query to offer as a new person, empty when there is nothing to add.
 *
 * Only offered once the results for the current query have actually arrived.
 * Otherwise "dodaj nową osobę" would flash up as the only option during the
 * debounce, tempting people to add someone who is already in the database. */
const createName = computed(() => {
  if (loading.value) return "";
  const settled = (debouncedSearch.value || "").trim();
  if (!settled || settled !== (search.value || "").trim()) return "";
  return settled;
});

// Captured on click, because opening the dialog blurs the autocomplete, which
// can reset `search` before the dialog reads the name to prefill.
const pendingCreateName = ref("");

const openCreatePerson = () => {
  pendingCreateName.value = createName.value;
  createPersonDialog.value?.open();
};

const onPersonCreated = () => {
  // The dialog redirects to the new page, just reset the search box behind it
  search.value = null;
  nodeGroupPicked.value = null;
  autocompleteFocus.value = false;
};

type ListItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  logEventKey: { content_id: string; content_type: string };
  path?: string;
  query?: Record<string, string>;
};

watch(debouncedSearch, async (val) => {
  if (!val) {
    setTimeout(() => (nodeGroupPicked.value = null), 300);
  } else {
    if (val !== nodeGroupPicked.value?.title) {
      await performSearch(val);
    }
  }
});

const searchData = ref<
  Array<{
    id: string;
    name: string;
    type: string;
    query?: Record<string, string>;
  }>
>([]);

async function performSearch(searchTerm: string) {
  loading.value = true;
  const response = await $fetch("/api/search", {
    query: {
      q: searchTerm,
      latest: true,
    },
  });
  searchData.value = response;
  loading.value = false;
}

// Not sure what it does
// watch(autocompleteFocus, (focused) => {
//   if (focused) {
//     refresh();
//   }
// });

const items = computed<ListItem[]>(() => {
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

watch(nodeGroupPicked, (value) => {
  if (!value) {
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
