<template>
  <div class="pa-4">
    <h1 class="text-h4 mb-4">Administracja - Rewizje</h1>

    <v-card>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        v-model:sort-by="sortBy"
        :headers="headers"
        :items="items"
        :items-length="totalItems"
        :loading="pending"
        @update:options="fetchData"
      >
        <template #[`item.name`]="{ item }">
          <NuxtLink :to="`/entity/${item.type}/${item.id}`">{{
            item.name
          }}</NuxtLink>
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
            {{ item.revisions.has_unapproved ? "Tak" : "Nie" }}
          </v-chip>
          <span v-else>-</span>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { useRouter, useRoute } from "vue-router";

definePageMeta({
  middleware: "auth",
  fullWidth: true,
});

useHead({
  title: "Rewizje (Admin) - koryta.pl",
});

const user = useCurrentUser();
const isAuthReady = useIsCurrentUserLoaded();

const route = useRoute();
const router = useRouter();

const itemsPerPage = ref(
  parseInt((route.query.itemsPerPage as string) || "10"),
);
const page = ref(parseInt((route.query.page as string) || "1"));
const sortBy = ref<{ key: string; order: "asc" | "desc" }[]>(
  route.query.sortBy
    ? [
        {
          key: route.query.sortBy as string,
          order: route.query.sortDesc === "true" ? "desc" : "asc",
        },
      ]
    : [],
);

const headers = [
  { title: "Nazwa", key: "name", sortable: false },
  { title: "Typ", key: "type", sortable: false },
  { title: "Rewizje łącznie", key: "revisions.total", sortable: true },
  { title: "Ostatnia rewizja", key: "revisions.latest_time", sortable: true },
  {
    title: "Niezaakceptowane",
    key: "revisions.has_unapproved",
    sortable: true,
  },
];

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

    const res = await $fetch<{
      nodes: Record<string, RevisionItem>;
      total: number;
    }>("/api/nodes/revisions", {
      params: {
        page: page.value,
        limit: itemsPerPage.value,
        sortBy: sortParam,
        sortDesc: sortDescParam,
      },
      headers: headersInit,
    });

    items.value = Object.values(res.nodes);
    totalItems.value = res.total;

    const newQuery = {
      ...route.query,
      page: String(page.value),
      itemsPerPage: String(itemsPerPage.value),
      sortBy: sortParam,
      sortDesc: sortDescParam,
    };

    const filteredQuery = Object.fromEntries(
      Object.entries(newQuery).filter(([_, value]) => value !== undefined),
    );
    router.push({ query: filteredQuery });
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
</script>
