<template>
  <ClientOnly>
    <v-navigation-drawer
      v-model="openDrawer"
      location="end"
      temporary
      :width="$vuetify.display.mdAndUp ? 600 : 280"
    >
      <v-card-item>
        <template #append>
          <v-btn
            density="compact"
            icon="$close"
            variant="text"
            @click="openDrawer = false"
          />
        </template>
      </v-card-item>

      <CardExplorePerson
        :key="focusedPerson?.id"
        :person="focusedPerson"
        :region="region"
        :company="company"
      />

      <div v-if="focusedPerson" class="pa-4 pt-0">
        <NoteEditor
          :key="focusedPerson.id"
          :node-id="focusedPerson.id"
          single-column
        />
        <v-divider class="my-4" />
        <CardEmploymentHistory :edges="focusedEdges" />
      </div>
    </v-navigation-drawer>
    <div class="pa-4">
      <h1 class="text-h4 mb-4">
        Eksploruj powiązania dla
        {{ region?.[1] || company?.[1] || "danej lokalizacji" }}
      </h1>

      <v-alert
        v-if="region && !company"
        type="warning"
        variant="tonal"
        class="mb-4"
        :icon="mdiCash"
      >
        <div class="d-flex align-center w-100">
          <v-btn
            href="https://zrzutka.pl/rd7ssx/pay"
            target="_blank"
            color="#E64164"
          >
            Zrzutka
            <v-img
              :width="30"
              aspect-ratio="16/9"
              cover
              src="@/assets/zrzutka.png"
            />
          </v-btn>
          <v-spacer />
          <div class="mr-8">
            Wesprzyj projekt na zrzutce, by przygotować podsumowania dla innych
            miast, podobie jak to dla
            <NuxtLink to="/entity/region/teryt1261">Krakowa</NuxtLink>
          </div>
          <v-spacer />
        </div>
      </v-alert>

      <ExploreLoginBanner v-if="!user" :hidden-count="hiddenCount" />

      <FormEksplorujTabelaFilters
        v-model:visibility="filterVisibility"
        v-model:party="filterParty"
        v-model:teryt="filterTeryt"
        v-model:krs="filterKrs"
        v-model:hide-voted="filterHideVoted"
        :available-parties="availableParties"
        :available-regions="availableRegions"
        :available-companies="availableCompanies"
        :show-visibility="!!user"
      />

      <v-card class="table-card">
        <ExploreTable
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :headers="headers"
          :items="tableItems"
          :total-items="totalItems"
          :pending="pending"
          :region="region"
          :company="company"
          @update:options="updateQueryParams"
          @focus="focusPerson"
        />
      </v-card>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiCash } from "@mdi/js";
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { parties } from "~~/shared/misc";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

import { useEdges } from "~/composables/edges";

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Tabela - koryta.pl",
});

const route = useRoute();
const router = useRouter();

const DEFAULT_ITEMS_PER_PAGE = "10";

const itemsPerPage = ref(
  parseInt((route.query.itemsPerPage as string) || DEFAULT_ITEMS_PER_PAGE),
);
const page = ref(parseInt((route.query.page as string) || "1"));

watch(
  () => route.query.page,
  (newPage) => {
    const p = parseInt((newPage as string) || "1");
    if (page.value !== p) page.value = p;
  },
);
watch(
  () => route.query.itemsPerPage,
  (newItems) => {
    const i = parseInt((newItems as string) || DEFAULT_ITEMS_PER_PAGE);
    if (itemsPerPage.value !== i) itemsPerPage.value = i;
  },
);

const user = useCurrentUser();

const headers = computed(() => {
  const baseHeaders = [
    { title: "Imię i nazwisko", key: "name", sortable: true },
    { title: "Partie", key: "parties", sortable: false },
    { title: "Firmy", key: "companies", sortable: false },
    { title: "Wybory", key: "elections", sortable: false },
    {
      title: "Ostatnie zatrudnienie",
      key: "latestEmploymentStart",
      sortable: true,
    },
    { title: "Lata pracy", key: "experience", sortable: true },
    { title: "Notatki", key: "notesCount", sortable: true },
    { title: "Głosy łącznie", key: "votes.interesting", sortable: true },
    { title: "Twój głos", key: "userVote", sortable: false },
  ];
  if (user.value) {
    baseHeaders.push({
      title: "Widoczność",
      key: "visibility",
      sortable: true,
    });
  }
  baseHeaders.push({ title: "Eksploruj", key: "explore", sortable: false });
  return baseHeaders;
});

// TODO calculate the hidden count
const hiddenCount = computed(() => {
  let stats;
  if (region.value) {
    stats = regions.value?.[region.value[0]]?.stats;
  } else if (company.value) {
    stats = places.value?.[company.value[0]]?.stats;
  }

  if (
    stats?.edges?.all?.targetNodeIds &&
    stats?.edges?.approved?.targetNodeIds
  ) {
    const diff =
      stats.edges.all.targetNodeIds.length -
      stats.edges.approved.targetNodeIds.length;
    return diff > 0 ? diff : 0;
  }
  return 0;
});

const { entities: places } = useEntities("place");
const { entities: regions } = useEntities("region");

const region = computed<[string, string] | undefined>(() => {
  const terytParam = route.query.teryt as string | undefined;
  if (terytParam) {
    for (const [id, region] of Object.entries(regions.value ?? {})) {
      if (region.teryt === terytParam) {
        return [id, region.name];
      }
    }
  }
  return undefined;
});

const company = computed<[string, string] | undefined>(() => {
  const krsParam = route.query.krs;
  if (krsParam) {
    const krsToMatch = Array.isArray(krsParam)
      ? krsParam[0]
      : (krsParam as string);
    for (const [id, place] of Object.entries(places.value ?? {})) {
      if (place.krsNumber === krsToMatch) {
        return [id, place.name];
      }
    }
  }
  return undefined;
});

const filterVisibility = computed<"all" | "public" | "private">({
  get: () =>
    (route.query.visibility as "all" | "public" | "private" | undefined) ||
    "all",
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        visibility: val !== "all" ? val : undefined,
      },
    });
  },
});
const filterParty = computed<string[] | null>({
  get: () => {
    const p = route.query.party;
    if (!p) return null;
    return Array.isArray(p) ? (p as string[]) : [p as string];
  },
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        party: val && val.length > 0 ? val : undefined,
      },
    });
  },
});
const filterTeryt = computed<string | null>({
  get: () => {
    return (route.query.teryt as string) || null;
  },
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        teryt: val || undefined,
      },
    });
  },
});

const filterKrs = computed<string[] | null>({
  get: () => {
    const k = route.query.krs;
    if (!k) return null;
    return Array.isArray(k) ? (k as string[]) : [k as string];
  },
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        krs: val && val.length > 0 ? val : undefined,
      },
    });
  },
});

const filterHideVoted = computed<"all" | "no_votes" | "has_votes">({
  get: () =>
    (route.query.hideVoted as "all" | "no_votes" | "has_votes" | undefined) ||
    "all",
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        hideVoted: val !== "all" ? val : undefined,
      },
    });
  },
});

const availableRegions = computed(() => {
  return Object.values(regions.value ?? {})
    .map((r) => ({ title: r.name, value: r.teryt }))
    .sort((a, b) => a.title.localeCompare(b.title));
});

const availableCompanies = computed(() => {
  return Object.values(places.value ?? {})
    .filter((p) => p.krsNumber)
    .map((p) => ({ title: p.name, value: p.krsNumber as string }))
    .sort((a, b) => a.title.localeCompare(b.title));
});

const availableParties = computed(() => {
  return [
    { title: "Brak partii", value: "__NONE__" },
    ...parties.map((p) => ({ title: p, value: p })),
  ];
});

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
const sortByOpt = computed<{ key: string; order: "asc" | "desc" } | undefined>(
  () => {
    return sortBy.value[0];
  },
);

const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: itemsPerPage.value,
      page: page.value,
      sortBy: sortByOpt.value?.key,
      sortDesc: sortByOpt.value
        ? sortByOpt.value.order === "desc"
          ? "true"
          : "false"
        : undefined,
      parties:
        filterParty.value && filterParty.value.length > 0
          ? filterParty.value
          : undefined,
      visibility:
        filterVisibility.value !== "all" ? filterVisibility.value : undefined,
      krs:
        filterKrs.value && filterKrs.value.length > 0
          ? filterKrs.value
          : undefined,
      teryt: filterTeryt.value || undefined,
      hideVoted:
        filterHideVoted.value !== "all" ? filterHideVoted.value : undefined,
    }) as Query,
);

// TODO maybe it shouldn't be await?

// We perform a double join in the composible
// We query /api/nodes/uncached and /api/graph/local
// to join the stats info with the node neighborhood.
const { tableItems, totalItems, pending } = await useListWithStats(apiQuery);

const updateQueryParams = async (options: {
  sortBy: { key: string; order: string }[];
  page: number;
  itemsPerPage: number;
}) => {
  const sortParam =
    options.sortBy.length > 0 ? options.sortBy[0]?.key : undefined;
  const sortDescParam =
    options.sortBy.length > 0
      ? options.sortBy[0]?.order === "desc"
        ? "true"
        : "false"
      : undefined;

  const currentQuery = route.query;
  const rawQuery = {
    ...currentQuery,
    page: String(options.page),
    itemsPerPage: String(options.itemsPerPage),
    sortBy: sortParam,
    sortDesc: sortDescParam,
  };

  const newQuery = Object.fromEntries(
    Object.entries(rawQuery).filter(([_, value]) => value !== undefined),
  );

  const isChanged =
    String(currentQuery.page || "1") !== String(options.page) ||
    String(currentQuery.itemsPerPage || "50") !==
      String(options.itemsPerPage) ||
    currentQuery.sortBy !== sortParam ||
    currentQuery.sortDesc !== sortDescParam;

  if (!isChanged) {
    if (!currentQuery.page || !currentQuery.itemsPerPage) {
      await router.replace({ query: newQuery });
    }
    return;
  }

  await router.push({ query: newQuery });
};

const openDrawer = shallowRef(false);
const focusedPerson = shallowRef<PersonRich | undefined>(undefined);
const focusedPersonId = computed(() => focusedPerson.value?.id);
const { sources: focusedSources, targets: focusedTargets } =
  await useEdges(focusedPersonId);
const focusedEdges = computed(() => [
  ...focusedSources.value,
  ...focusedTargets.value,
]);

const focusPerson = (item: PersonRich) => {
  focusedPerson.value = item;
  openDrawer.value = true;
};
</script>

<style scoped>
@media (min-width: 960px) {
  .table-card,
  .table-card :deep(.v-data-table),
  .table-card :deep(.v-table),
  .table-card :deep(.v-table__wrapper) {
    overflow: visible !important;
  }
  .table-card :deep(.v-data-table__th) {
    top: var(--v-layout-top) !important;
  }
}
</style>
