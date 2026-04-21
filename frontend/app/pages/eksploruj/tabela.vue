<template>
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
        :available-parties="availableParties"
        :available-election-locations="availableElectionLocations"
      />

      <v-card>
        <v-data-table
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :headers="headers"
          :items="filteredItems"
          :loading="loading"
          @update:options="updateQueryParams"
        >
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
            <span v-for="(company, i) in item.companies" :key="company">
              {{ company }}<br v-if="i < item.companies.length - 1" />
            </span>
          </template>

          <template #[`item.elections`]="{ item }">
            <template v-for="(election, i) in item.elections" :key="i">
              <v-chip size="small" class="mr-1 mb-1" variant="outlined">
                <template v-if="election.year">
                  <span class="font-weight-bold mr-1">{{ election.year }}</span>
                </template>
                <template v-if="election.location">
                  {{ election.location }}
                  <span class="mx-1 text-grey-darken-1">-</span>
                </template>
                {{ election.position }}
                <template v-if="election.committee">
                  <span class="text-caption ml-1"
                    >({{ election.committee }})</span
                  >
                </template> </v-chip
              ><br v-if="i < item.elections.length - 1" />
            </template>
          </template>

          <template #[`item.visibility`]="{ item }">
            <v-icon :color="item.visibility ? 'success' : 'error'">
              {{ item.visibility ? "mdi-check-circle" : "mdi-close-circle" }}
            </v-icon>
          </template>

          <template #[`item.explore`]="{ item }">
            <v-btn
              icon="mdi-magnify"
              variant="text"
              color="primary"
              @click="focusPerson(item)"
            />
          </template>

          <template #[`item.name`]="{ item }">
            <NuxtLink
              :to="`/entity/person/${item.id}`"
              class="text-decoration-none text-primary"
            >
              {{ item.name }}
            </NuxtLink>
          </template>
        </v-data-table>
      </v-card>
    </div>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { PersonRich } from "~~/shared/model";
import { useEntityListRich } from "~/composables/entity/listRich";

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
  { title: "Imię i nazwisko", key: "name", sortable: true },
  { title: "Partie", key: "parties", sortable: false },
  { title: "Firmy", key: "companies", sortable: false },
  { title: "Wybory", key: "elections", sortable: false },
  { title: "Lata pracy", key: "experience", sortable: true },
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

const { people: fetchedItems, loading } = useEntityListRich(
  company,
  region,
  places,
  regions,
);

const filterVisibility = ref<"all" | "public" | "private">(
  (route.query.visibility as "all" | "public" | "private" | undefined) || "all",
);
const filterParty = ref<string | null>((route.query.party as string) || null);
const filterElectionLocation = ref<string | null>(
  (route.query.electionLocation as string) || null,
);

const availableParties = computed(() => {
  const parties = new Set<string>();
  for (const item of fetchedItems.value || []) {
    if (item.parties) {
      for (const p of item.parties) {
        parties.add(p);
      }
    }
  }
  return Array.from(parties).sort();
});

const availableElectionLocations = computed(() => {
  const locations = new Set<string>();
  for (const item of fetchedItems.value || []) {
    if (item.elections) {
      for (const e of item.elections) {
        if (e.location) {
          locations.add(e.location);
        }
      }
    }
  }
  return Array.from(locations).sort();
});

const filteredItems = computed(() => {
  let items = fetchedItems.value || [];

  if (filterVisibility.value !== "all") {
    const isPublic = filterVisibility.value === "public";
    items = items.filter((item) => !!item.visibility === isPublic);
  }

  if (filterParty.value) {
    items = items.filter((item) => item.parties?.includes(filterParty.value!));
  }

  if (filterElectionLocation.value) {
    items = items.filter((item) =>
      item.elections?.some((e) => e.location === filterElectionLocation.value),
    );
  }

  return items;
});

watch([filterVisibility, filterParty, filterElectionLocation], () => {
  console.log([filterVisibility, filterParty, filterElectionLocation]);
  page.value = 1;
  router.replace({
    query: {
      ...route.query,
      page: 1,
      visibility:
        filterVisibility.value !== "all" ? filterVisibility.value : undefined,
      party: filterParty.value || undefined,
      electionLocation: filterElectionLocation.value || undefined,
    },
  });
});

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

  await router.replace({
    query: {
      ...route.query,
      page: options.page,
      itemsPerPage: options.itemsPerPage,
      sortBy: sortParam,
      sortDesc: sortDescParam,
    },
  });
};

const openDrawer = shallowRef(false);
const focusedPerson = shallowRef<PersonRich | undefined>(undefined);

const focusPerson = (item: PersonRich) => {
  focusedPerson.value = item;
  openDrawer.value = true;
};
</script>
