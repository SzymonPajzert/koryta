<template>
  <v-container>
    <h1 class="text-h4 mb-4">Administracja - Rewizje</h1>

    <!-- Gated on `isAdmin`, not on the page's own middleware: this page is
         `middleware: "auth"`, so any signed-in reader reaches it, while the
         queue it points at is admin-only and would answer them with a 403. -->
    <v-alert
      v-if="isAdmin"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Ta lista pokazuje węzły wraz ze wszystkimi ich rewizjami — także tymi,
      które wprowadził pipeline. Propozycje zmian od ludzi czekają w osobnej
      kolejce.
      <template #append>
        <v-btn variant="text" size="small" to="/admin/rewizje/kolejka">
          Przejdź do kolejki
        </v-btn>
      </template>
    </v-alert>

    <v-card class="mb-4 pa-3 d-flex flex-wrap ga-3">
      <v-select
        v-model="filterStatus"
        :items="statusOptions"
        label="Status"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 20rem"
      />
      <v-select
        v-model="filterType"
        :items="typeOptions"
        label="Typ"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 20rem"
      />
    </v-card>

    <v-card>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        v-model:sort-by="sortBy"
        :headers="headers"
        :items="items"
        :items-length="totalItems"
        :loading="pending"
        :items-per-page-options="[10, 25, 50, 100]"
        @update:options="fetchData"
      >
        <template #[`item.name`]="{ item }">
          <NuxtLink :to="`/entity/${item.type}/${item.id}`">{{
            item.name
          }}</NuxtLink>
        </template>
        <template #[`item.revisions.total`]="{ item }">
          <NuxtLink :to="`/admin/rewizje/${item.id}`">
            {{ item.revisions?.total ?? 0 }}
          </NuxtLink>
        </template>
        <template #[`item.revisions.latest_time`]="{ item }">
          {{ formatDate(item.revisions?.latest_time) }}
        </template>
        <template #[`item.revisions.has_unapproved`]="{ item }">
          <v-chip
            v-if="item.revisions"
            :color="item.revisions.has_unapproved ? 'warning' : 'success'"
            size="small"
          >
            {{ item.revisions.has_unapproved ? "Nie" : "Tak" }}
          </v-chip>
          <span v-else>-</span>
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { useRoute } from "vue-router";
import { useQueryFilters } from "~/composables/queryFilters";
import { nodeTypes, type NodeType } from "~~/shared/model";

// No `fullWidth`: five columns do not need the whole window, and edge to edge
// they left the reader tracking a row across a monitor. The list sits in the
// same centred column an article page does.
definePageMeta({
  middleware: "auth",
});

useHead({
  title: "Rewizje (Admin) - koryta.pl",
});

const user = useCurrentUser();
const isAuthReady = useIsCurrentUserLoaded();
const { isAdmin } = useAuthState();

const route = useRoute();
const { setQuery } = useQueryFilters();

const DEFAULT_ITEMS_PER_PAGE = 10;

const itemsPerPage = ref(
  parseInt(
    (route.query.itemsPerPage as string) || String(DEFAULT_ITEMS_PER_PAGE),
  ),
);
const page = ref(parseInt((route.query.page as string) || "1"));
const filterStatus = ref<string | null>((route.query.status as string) || null);
// Checked against the tuple rather than cast: an unknown `?type=` in the url
// would otherwise reach the api, which rejects it, and the table would come
// back empty with only the console to say why.
const queryType = route.query.type;
const filterType = ref<NodeType | null>(
  nodeTypes.includes(queryType as NodeType) ? (queryType as NodeType) : null,
);

// Phrased by what is left to do rather than by the field name: the column says
// "Zaakceptowane" and `has_unapproved` says the opposite, so naming either one
// here would read backwards next to the other.
const statusOptions = [
  { title: "Oczekujące na akceptację", value: "unapproved" },
  { title: "W pełni zaakceptowane", value: "approved" },
];

// Written out rather than mapped over `nodeTypes`, because the select needs a
// Polish name per type and the raw values are the ones the api takes - they are
// what ends up in the url too, so the two lists have to agree.
const typeOptions: { title: string; value: NodeType }[] = [
  { title: "Osoba", value: "person" },
  { title: "Firma", value: "place" },
  { title: "Artykuł", value: "article" },
  { title: "Region", value: "region" },
  { title: "Temat", value: "topic" },
];

const sortBy = ref<{ key: string; order: "asc" | "desc" }[]>(
  route.query.sortBy
    ? [
        {
          key: route.query.sortBy as string,
          order: route.query.sortDesc === "true" ? "desc" : "asc",
        },
      ]
    : [{ key: "revisions.latest_time", order: "desc" }],
);

const headers = [
  { title: "Nazwa", key: "name", sortable: false },
  { title: "Typ", key: "type", sortable: false },
  { title: "Rewizje łącznie", key: "revisions.total", sortable: true },
  { title: "Ostatnia rewizja", key: "revisions.latest_time", sortable: true },
  {
    title: "Zaakceptowane",
    key: "revisions.has_unapproved",
    sortable: true,
  },
];

// The column reads "Zaakceptowane" but the field behind it stores the opposite,
// so its sort has to travel the other way to match the direction clicked.
const INVERTED_SORT_KEYS = new Set(["revisions.has_unapproved"]);

interface RevisionItem {
  id: string;
  name: string;
  type: string;
  revisions?: {
    total: number;
    latest_time: string | null;
    has_unapproved: boolean;
  };
}

const items = ref<RevisionItem[]>([]);
const totalItems = ref(0);
const pending = ref(false);

const fetchData = async () => {
  pending.value = true;
  try {
    if (!isAuthReady.value) {
      await new Promise<void>((resolve) => {
        const unwatch = watch(
          isAuthReady,
          (ready) => {
            if (ready) {
              unwatch();
              resolve();
            }
          },
          { immediate: true },
        );
      });
    }

    const headersInit: HeadersInit = {};
    if (user.value) {
      const token = await user.value.getIdToken();
      headersInit["Authorization"] = `Bearer ${token}`;
    }

    const sortParam =
      sortBy.value.length > 0 ? sortBy.value[0]?.key : undefined;
    const sortDescParam =
      sortBy.value.length > 0
        ? sortBy.value[0]?.order === "desc"
          ? "true"
          : "false"
        : undefined;
    const apiSortDesc =
      sortParam && INVERTED_SORT_KEYS.has(sortParam)
        ? sortDescParam === "true"
          ? "false"
          : "true"
        : sortDescParam;

    const res = await $fetch<{
      nodes: Record<string, RevisionItem>;
      total: number;
    }>("/api/nodes/revisions", {
      params: {
        page: page.value,
        limit: itemsPerPage.value,
        sortBy: sortParam,
        sortDesc: apiSortDesc,
        status: filterStatus.value || undefined,
        type: filterType.value || undefined,
      },
      headers: headersInit,
    });

    items.value = Object.values(res.nodes);
    totalItems.value = res.total;

    // After the await above, so the user may have navigated away by now -
    // setQuery declines to write onto whatever page they moved to.
    setQuery({
      page: page.value > 1 ? String(page.value) : undefined,
      itemsPerPage:
        itemsPerPage.value === DEFAULT_ITEMS_PER_PAGE
          ? undefined
          : String(itemsPerPage.value),
      sortBy: sortParam,
      sortDesc: sortDescParam,
      status: filterStatus.value || undefined,
      type: filterType.value || undefined,
    });
  } catch (err) {
    console.error(err);
  } finally {
    pending.value = false;
  }
};

const formatDate = (dateString?: string | null) => {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("pl-PL");
};

watch([filterStatus, filterType], () => {
  page.value = 1;
  fetchData();
});
</script>
