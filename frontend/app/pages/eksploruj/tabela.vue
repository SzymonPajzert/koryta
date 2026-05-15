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
        <NoteEditor :key="focusedPerson.id" :node-id="focusedPerson.id" />
        <v-divider class="my-4" />
        <EntityDetailView
          :key="focusedPerson.id"
          :node="focusedPerson.id"
          type="person"
        />
      </div>
    </v-navigation-drawer>
    <div class="pa-4">
      <h1 class="text-h4 mb-4">
        Eksploruj powiązania dla
        {{ region?.[1] || company?.[1] || "danej lokalizacji" }}
      </h1>

      <ExploreLoginBanner v-if="!user" :hidden-count="hiddenCount" />

      <FormEksplorujTabelaFilters
        v-model:visibility="filterVisibility"
        v-model:party="filterParty"
        v-model:teryt="filterTeryt"
        v-model:hideVoted="filterHideVoted"
        :available-parties="availableParties"
        :available-regions="availableRegions"
        :show-visibility="!!user"
      />

      <v-card class="table-card">
        <v-data-table-server
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          fixed-header
          :headers="headers"
          :items="tableItems"
          :items-length="totalItems"
          :loading="pending"
          items-per-page-text="Wierszy na stronę:"
          no-data-text="Brak danych"
          loading-text="Ładowanie..."
          @update:options="updateQueryParams"
        >
          <template #[`header.experience`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
              :column
              :sort-by
            />
          </template>

          <template #[`header.notesCount`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Liczba notatek stworzonych przez społeczność na temat powiązań tej osoby"
              :column
              :sort-by
            />
          </template>

          <template #[`header.votes.interesting`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Suma głosów społeczności określających jak interesująca jest ta osoba"
              :column
              :sort-by
            />
          </template>

          <template #[`header.userVote`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie)"
              :column
              :sort-by
            />
          </template>

          <template #[`header.visibility`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Czy strona osoby jest już opublikowana, czy jest w fazie szkicu (widoczna tylko dla zalogowanych)"
              :column
              :sort-by
            />
          </template>

          <template #[`header.explore`]="{ column }">
            <ExploreTableColumnHeader
              tooltip="Wyświetla panel boczny z większą ilością informacji i opcją interakcji"
              :column
              :sort-by
            />
          </template>

          <template #[`item.name`]="{ item }">
            <div style="max-width: 150px">
              <NuxtLink
                class="text-primary cursor-pointer"
                @click="focusPerson(item)"
              >
                {{ item.name }}
              </NuxtLink>
            </div>
          </template>

          <template #[`item.parties`]="{ item }">
            <v-chip
              v-for="party in item.parties"
              :key="party"
              size="small"
              class="mr-1"
            >
              {{ party }}
            </v-chip>
          </template>

          <template #[`item.companies`]="{ item }">
            <div class="d-flex flex-wrap gap-1 py-1" style="max-width: 300px">
              <span v-for="companyName in item.companies" :key="companyName">
                <v-tooltip :text="shortCompanyName(companyName)" location="top">
                  <template #activator="{ props }">
                    <v-chip
                      v-bind="props"
                      size="small"
                      class="mr-1 mb-1 text-truncate d-flex"
                      variant="outlined"
                      style="max-width: 300px"
                    >
                      {{ shortCompanyName(companyName) }}
                    </v-chip>
                  </template>
                </v-tooltip>
              </span>
            </div>
          </template>

          <template #[`item.elections`]="{ item }">
            <template v-for="(election, i) in item.elections" :key="i">
              <v-chip size="small" class="mr-1 mb-1" variant="outlined">
                <template v-if="election.year">
                  <span class="font-weight-bold mr-1">{{ election.year }}</span>
                </template>
                <template v-if="election.location">
                  {{ election.location }}
                </template>
                <template v-if="election.committee">
                  <span class="text-caption ml-1"
                    >({{ election.committee }})</span
                  >
                </template>
              </v-chip>
              <br v-if="i < item.elections.length - 1" />
            </template>
          </template>

          <template #[`item.visibility`]="{ item }">
            <v-chip
              size="small"
              :color="item.visibility ? 'success' : 'warning'"
              variant="tonal"
            >
              {{ item.visibility ? "Opublikowane" : "Szkic" }}
            </v-chip>
          </template>

          <template #[`item.notesCount`]="{ item }">
            {{ item.stats?.notesCount || 0 }}
          </template>

          <template #[`item.votes.interesting`]="{ item }">
            {{ item.stats?.votes?.interesting || 0 }}
          </template>

          <template #[`item.userVote`]="{ item }">
            <ButtonVoteNumber :id="item.id" category="interesting" />
          </template>

          <template #[`item.explore`]="{ item }">
            <v-btn
              icon="mdi-magnify"
              variant="text"
              color="primary"
              @click="focusPerson(item)"
            />
          </template>
        </v-data-table-server>
      </v-card>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { parties } from "~~/shared/misc";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Tabela - koryta.pl",
});

const route = useRoute();
const router = useRouter();

const itemsPerPage = ref(
  parseInt((route.query.itemsPerPage as string) || "50"),
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
    const i = parseInt((newItems as string) || "50");
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
  const krsParam = route.query.krs as string | undefined;
  if (krsParam) {
    for (const [id, place] of Object.entries(places.value ?? {})) {
      if (place.krsNumber === krsParam) {
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

const filterHideVoted = computed<boolean>({
  get: () => route.query.hideVoted === "true",
  set: (val) => {
    router.push({
      query: {
        ...route.query,
        page: 1,
        hideVoted: val ? "true" : undefined,
      },
    });
  },
});

const availableRegions = computed(() => {
  return Object.values(regions.value ?? {})
    .map((r) => ({ title: r.name, value: r.teryt }))
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
      krs: route.query.krs as string | undefined,
      teryt: filterTeryt.value || undefined,
      hideVoted: filterHideVoted.value ? "true" : undefined,
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

const focusPerson = (item: PersonRich) => {
  focusedPerson.value = item;
  openDrawer.value = true;
};

const shortCompanyName = (companyName: string | undefined) => {
  if (!companyName) return "";
  const spolkaIndex = companyName.indexOf(
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  );
  if (spolkaIndex !== -1) {
    companyName =
      companyName.slice(0, spolkaIndex) + companyName.slice(spolkaIndex + 39);
  }
  return companyName;
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
