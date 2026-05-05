<template>
  <ClientOnly>
    <v-layout>
      <v-navigation-drawer
        v-model="openDrawer"
        location="end"
        temporary
        :width="$vuetify.display.mdAndUp ? 600 : 280"
      >
        <v-card-item title="Analiza osoby">
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
          <NoteEditor :node-id="focusedPerson.id" />
        </div>
      </v-navigation-drawer>
      <div class="pa-4">
        <h1 class="text-h4 mb-4">
          Eksploruj powiązania dla
          {{ region?.[1] || company?.[1] || "danej lokalizacji" }}
        </h1>

        <FormEksplorujTabelaFilters
          v-model:visibility="filterVisibility"
          v-model:party="filterParty"
          v-model:election-location="filterElectionLocation"
          :available-parties="parties"
          :available-election-locations="availableElectionLocations"
        />

        <v-card>
          <v-data-table-server
            v-model:items-per-page="itemsPerPage"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :headers="headers"
            :items="tableItems"
            :items-length="totalItems"
            :loading="pending"
            @update:options="updateQueryParams"
          >
            <template #[`item.name`]="{ item }">
              <div style="max-width: 150px">
                <NuxtLink
                  :to="generateEntityUrl('person', item.id, item.name)"
                  class="text-decoration-none text-primary"
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
                  <v-tooltip
                    :text="shortCompanyName(companyName)"
                    location="top"
                  >
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
                    <span class="font-weight-bold mr-1">{{
                      election.year
                    }}</span>
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
              <v-icon :color="item.visibility ? 'success' : 'error'">
                {{ item.visibility ? "mdi-check-circle" : "mdi-close-circle" }}
              </v-icon>
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
    </v-layout>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { parties } from "~~/shared/misc";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { generateEntityUrl } from "~/composables/slugs";

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

const headers = [
  { title: "Imię i nazwisko", key: "name", sortable: true },
  { title: "Partie", key: "parties", sortable: false },
  { title: "Firmy", key: "companies", sortable: false },
  { title: "Wybory", key: "elections", sortable: false },
  { title: "Lata pracy", key: "experience", sortable: true },
  { title: "Notatki", key: "notesCount", sortable: true },
  { title: "Głosy łącznie", key: "votes.interesting", sortable: true },
  { title: "Twój głos", key: "userVote", sortable: false },
  { title: "Publiczne", key: "visibility", sortable: true },
  { title: "Zobacz", key: "explore", sortable: false },
];

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
const filterParty = computed<string | null>({
  get: () => (route.query.party as string) || null,
  set: (val) => {
    router.push({
      query: { ...route.query, page: 1, party: val || undefined },
    });
  },
});
const filterElectionLocation = computed<string | null>({
  get: () => (route.query.electionLocation as string) || null,
  set: (val) => {
    router.push({
      query: { ...route.query, page: 1, electionLocation: val || undefined },
    });
  },
});

const availableElectionLocations = computed(() => {
  return [];
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
      party: filterParty.value || undefined,
      visibility:
        filterVisibility.value !== "all" ? filterVisibility.value : undefined,
      krs: route.query.krs as string | undefined,
      teryt: route.query.teryt as string | undefined,
      electionLocation: filterElectionLocation.value || undefined,
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
