<template>
  <ClientOnly>
    <ExploreNodeDrawer
      v-model="openDrawer"
      :node="focusedPerson"
      :edges="focusedEdges"
      :region="region"
      :company="company"
      :company-regions="companyRegions"
    />
    <div class="pa-4">
      <h1 class="text-h4 mb-4">
        Eksploruj powiązania dla
        {{ entityName }}
      </h1>

      <ExploreSelectedCompanies :companies="selectedCompaniesData" />

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
        v-model:place="filterPlace"
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

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Tabela - koryta.pl",
  // Marks the page for the `overflow-x` override below. Set through the head
  // rather than a stylesheet because it has to come off again when the reader
  // navigates away - no other page wants a sideways scrollbar.
  htmlAttrs: { class: "tabela-scroll-x" },
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

// What is left of the table below 960px: who the person is, where they have
// worked and what they stood in. Everything marked with this - notes, votes,
// the vote control, visibility, the explore buttons - is there to steer
// exploration rather than to read a row, and all of it is in the drawer the
// name opens. Ten columns on a phone meant scrolling sideways past them to
// reach anything, at the same boundary the drawer and the sticky header
// already switch on.
//
// A stylesheet rather than `useDisplay().smAndDown` and a shorter array:
// under SSR Vuetify builds its display state from a placeholder width of
// 1280px and only measures the window when the app's suspense resolves, so a
// width-driven header list renders the ten column table first and corrects
// itself afterwards - and never corrects it at all if that one update does
// not run. `hidden-sm-and-down` is Vuetify's own utility, `display: none`
// under `(max-width: 959.98px)`, and it is right before the first paint.
const PHONE_HIDDEN = {
  headerProps: { class: "hidden-sm-and-down" },
  cellProps: { class: "hidden-sm-and-down" },
};

const headers = computed(() => {
  const baseHeaders = [
    { title: "Imię i nazwisko", key: "name", sortable: true },
    { title: "Partie", key: "parties", sortable: false, ...PHONE_HIDDEN },
    { title: "Firmy", key: "companies", sortable: false },
    { title: "Wybory", key: "elections", sortable: false },
    {
      title: "Ostatnie zatrudnienie",
      key: "latestEmploymentStart",
      sortable: true,
      ...PHONE_HIDDEN,
    },
    {
      title: "Lata pracy",
      key: "experience",
      sortable: true,
      align: "center" as const,
      ...PHONE_HIDDEN,
    },
    {
      title: "Notatki",
      key: "notesCount",
      sortable: true,
      align: "center" as const,
      ...PHONE_HIDDEN,
    },
    {
      title: "Głosy łącznie",
      key: "stats.votes.interesting",
      sortable: true,
      align: "center" as const,
      ...PHONE_HIDDEN,
    },
    {
      title: "Twój głos",
      key: "userVote",
      sortable: false,
      align: "center" as const,
      ...PHONE_HIDDEN,
    },
  ];
  if (user.value) {
    baseHeaders.push({
      title: "Widoczność",
      key: "visibility",
      sortable: true,
      ...PHONE_HIDDEN,
    });
  }
  baseHeaders.push({
    title: "Eksploruj",
    key: "explore",
    sortable: false,
    ...PHONE_HIDDEN,
  });
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

// This page's whole template is a <ClientOnly>, so the server renders none of
// it - but these two fetches still ran during SSR and their results were
// serialised into __NUXT_DATA__, which is where most of an ~8 MB response came
// from. Every reader waited on all of it before seeing anything.
const { entities: places } = useEntities("place", {}, { server: false });
// Shared with the drawer and the table rows, which need the region each company
// sits in rather than the region nodes themselves.
const { regions, companyRegions, companyLocations } = useCompanyLocations();

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
  const id = filterPlace.value?.[0];
  const place = id ? places.value?.[id] : undefined;
  return id && place ? [id, place.name] : undefined;
});

const selectedCompaniesData = computed(() => {
  if (!filterPlace.value || !places.value) return [];
  const selected = [];
  for (const id of filterPlace.value) {
    const place = places.value[id];
    if (place) {
      selected.push({ id, ...place, location: companyLocations.value[id] });
    }
  }
  return selected;
});

const entityName = computed(() => {
  if (filterPlace.value) return "wybranych firm";
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
const { filterPlace, legacyKrs, availableCompanies } = usePlaceFilter(
  places,
  arrayFilter,
  setQuery,
);
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
      place:
        filterPlace.value && filterPlace.value.length > 0
          ? filterPlace.value
          : undefined,
      // Passed straight through rather than translated, so an old link filters
      // on the first render too, before the place list needed to map it onto
      // node ids has arrived. The api unions the two.
      krs: legacyKrs.value ?? undefined,
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
  { server: false, companyLocations },
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
  /* The header sticks to the app bar rather than to the table, which needs
   * every scroll container between the two out of the way - a `position:
   * sticky` element measures itself against the nearest one. */
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

<!-- Not scoped: the rule is on <html>, which no component owns. Vuetify sets
     `overflow-x: hidden` there, so the columns that do not fit were clipped
     with no way to reach them - the table sits in a chain of `overflow:
     visible` (see above), so the page is the only thing left that can scroll
     to them. Below 960px the wrapper keeps its own scrollbar and this does not
     apply. -->
<style>
@media (min-width: 960px) {
  html.tabela-scroll-x {
    overflow-x: auto;
  }
}
</style>
