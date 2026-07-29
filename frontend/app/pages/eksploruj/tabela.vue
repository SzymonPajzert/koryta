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
        <ExploreProposeChange :key="focusedPerson.id" :person="focusedPerson">
          <ButtonVoteNumber
            :id="focusedPerson.id"
            :key="focusedPerson.id"
            category="interesting"
            show-label
          />
        </ExploreProposeChange>

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
        {{ entityName }}
      </h1>

      <v-row v-if="selectedCompaniesData.length > 0" class="mb-4 mt-2">
        <v-col
          v-for="companyData in selectedCompaniesData"
          :key="companyData.id"
          cols="12"
        >
          <CardCompanySummary
            :company="companyData"
            :location="companyData.location"
          />
        </v-col>
      </v-row>

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
        v-model:company-teryt="filterCompanyTeryt"
        v-model:krs="filterKrs"
        v-model:category="filterCategory"
        v-model:hide-voted="filterHideVoted"
        v-model:currently-employed="filterCurrentlyEmployed"
        v-model:min-employment-date="filterMinEmploymentDate"
        v-model:min-votes="filterMinVotes"
        :available-parties="availableParties"
        :available-regions="availableRegions"
        :available-companies="availableCompanies"
        :show-visibility="!!user"
      />

      <ExploreProgressBar :query="apiQuery" class="mb-4" />

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
          @focus="focusPerson"
        />
      </v-card>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiCash } from "@mdi/js";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { useQueryFilters } from "~/composables/queryFilters";
import { parties } from "~~/shared/misc";
import { regionFilterOptions } from "~~/shared/teryt";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

import { useEdges } from "~/composables/edges";
import { regionNamesByPlaceId } from "~/utils/companyLocation";

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Tabela - koryta.pl",
});

const route = useRoute();

const DEFAULT_ITEMS_PER_PAGE = 10;

const { setQuery, stringFilter, arrayFilter, choiceFilter, numberFilter } =
  useQueryFilters({ resetOnChange: ["page"] });

// Paging and sorting are the table's own state rather than filters, so they do
// not reset the page - they set it.
const page = computed<number>({
  get: () => numberFilter("page").value ?? 1,
  set: (val) => void setQuery({ page: val > 1 ? String(val) : undefined }),
});

const itemsPerPage = computed<number>({
  get: () => numberFilter("itemsPerPage").value ?? DEFAULT_ITEMS_PER_PAGE,
  set: (val) =>
    void setQuery({
      itemsPerPage: val === DEFAULT_ITEMS_PER_PAGE ? undefined : String(val),
      page: undefined,
    }),
});

type SortEntry = { key: string; order: "asc" | "desc" };

const sortBy = computed<SortEntry[]>({
  get: (): SortEntry[] => {
    const key = (route.query.sortBy as string | undefined) || undefined;
    if (!key) return [];
    const order: "asc" | "desc" =
      route.query.sortDesc === "true" ? "desc" : "asc";
    return [{ key, order }];
  },
  set: (val: SortEntry[]) => {
    const sort = val[0];
    void setQuery({
      sortBy: sort?.key,
      sortDesc: sort ? String(sort.order === "desc") : undefined,
      page: undefined,
    });
  },
});

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
    {
      title: "Lata pracy",
      key: "experience",
      sortable: true,
      align: "center" as const,
    },
    {
      title: "Notatki",
      key: "notesCount",
      sortable: true,
      align: "center" as const,
    },
    {
      title: "Głosy łącznie",
      key: "stats.votes.interesting",
      sortable: true,
      align: "center" as const,
    },
    {
      title: "Twój głos",
      key: "userVote",
      sortable: false,
      align: "center" as const,
    },
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

/** Region each company sits in, keyed by company node id. */
const companyLocations = computed(() =>
  regionNamesByPlaceId(regions.value ?? {}, user.value ? "all" : "approved"),
);

const selectedCompaniesData = computed(() => {
  if (!filterKrs.value || !places.value) return [];
  const selected = [];
  const krsSet = new Set(filterKrs.value);
  for (const [id, place] of Object.entries(places.value)) {
    if (place.krsNumber && krsSet.has(place.krsNumber)) {
      selected.push({ id, ...place, location: companyLocations.value[id] });
    }
  }
  return selected;
});

const entityName = computed(() => {
  if (filterKrs.value) return "wybranych firm";
  if (region.value) return region.value[1];
  return "aktualnego wyszukiwania";
});

const filterVisibility = choiceFilter<"all" | "public" | "private">(
  "visibility",
  "all",
);
const filterParty = arrayFilter("party");
const filterTeryt = stringFilter("teryt");
const filterCompanyTeryt = stringFilter("companyTeryt");
const filterKrs = arrayFilter("krs");
const filterCategory = stringFilter("category");
const filterCurrentlyEmployed = choiceFilter<"all" | "any" | "selected">(
  "currentlyEmployed",
  "all",
);
const filterHideVoted = choiceFilter<"all" | "no_votes" | "has_votes">(
  "hideVoted",
  "all",
);
const filterMinEmploymentDate = stringFilter("minEmploymentDate");
const filterMinVotes = numberFilter("minVotes");

const availableRegions = computed(() =>
  regionFilterOptions(Object.values(regions.value ?? {})),
);

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

const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: itemsPerPage.value,
      page: page.value,
      sortBy: sortBy.value[0]?.key,
      sortDesc: sortBy.value[0]
        ? ((sortBy.value[0].order === "desc" ? "true" : "false") as
            "true" | "false")
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
      companyTeryt: filterCompanyTeryt.value || undefined,
      category: filterCategory.value || undefined,
      hideVoted:
        filterHideVoted.value !== "all" ? filterHideVoted.value : undefined,
      currentlyEmployed:
        filterCurrentlyEmployed.value !== "all"
          ? filterCurrentlyEmployed.value
          : undefined,
      minEmploymentDate: filterMinEmploymentDate.value || undefined,
      minVotes: filterMinVotes.value != null ? filterMinVotes.value : undefined,
    }) as Query,
);

// TODO maybe it shouldn't be await?

// We perform a double join in the composible
// We query /api/nodes/uncached and /api/graph/local
// to join the stats info with the node neighborhood.
const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "eksploruj-tabela-data",
);

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
