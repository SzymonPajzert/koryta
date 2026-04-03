<template>
  <v-layout>
    <v-navigation-drawer
      v-model="drawer"
      location="end"
      temporary
      :width="$vuetify.display.mdAndUp ? 420 : 280"
    >
      <v-card-item title="Panel title">
        <template #append>
          <v-btn
            density="compact"
            icon="$close"
            variant="text"
            @click="drawer = false"
          />
        </template>
      </v-card-item>

      <div class="pa-4">
        <v-sheet
          border="dashed md"
          color="surface-light"
          height="365"
          rounded="lg"
          width="100%"
        />
      </div>
    </v-navigation-drawer>
    <div class="pa-4">
      <h1 class="text-h4 mb-4">Eksploruj powiązania</h1>
      <v-card>
        <v-data-table
          v-model:items-per-page="itemsPerPage"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :headers="headers"
          :items="computedItems"
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
            <span v-for="(election, i) in item.elections" :key="election">
              {{ election }}<span v-if="i < item.elections.length - 1">, </span>
            </span>
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
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useEntity } from "@/composables/entity";
import { authFetch } from "@/composables/auth";
import { getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";
import type { Edge } from "~~/shared/model";

definePageMeta({ title: "Eksploruj - Tabela", fullWidth: true });

const route = useRoute();
const router = useRouter();

const itemsPerPage = ref(
  parseInt((route.query.itemsPerPage as string) || "50"),
);
const page = ref(parseInt((route.query.page as string) || "1"));
const sortBy = ref<{ key: string; order: string }[]>(
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

const { entities: people } = useEntity("person");
const { entities: places } = useEntity("place");
const { entities: regions } = useEntity("region");
const { data: edgesData, pending: edgesPending } =
  await authFetch<Edge[]>("/api/graph/edges");

const loading = computed(() => {
  return (
    !people.value ||
    !places.value ||
    !regions.value ||
    edgesPending.value ||
    Object.keys(people.value).length === 0
  );
});

const regionNameState = ref<string | undefined>(undefined);
const companyNameState = ref<string | undefined>(undefined);

const computedItems = computed(() => {
  if (loading.value) return [];

  const terytParam = route.query.teryt as string | undefined;
  const krsParam = route.query.krs as string | undefined;

  const peopleObj = people.value;
  const placesObj = places.value;
  const regionsObj = regions.value;
  const edgesArray = edgesData.value || [];

  let regionId: string | undefined;
  if (terytParam) {
    for (const [id, region] of Object.entries(regionsObj)) {
      if (region.teryt === terytParam) {
        regionId = id;
        regionNameState.value = region.name;
        break;
      }
    }
  }

  let companyId: string | undefined;
  if (krsParam) {
    for (const [id, place] of Object.entries(placesObj)) {
      if (place.krsNumber === krsParam) {
        companyId = id;
        companyNameState.value = place.name;
        break;
      }
    }
  }

  const nodesNoStats = getNodesNoStats(
    peopleObj,
    placesObj,
    regionsObj,
    partyColors,
  );
  const validNodeIds = new Set(Object.keys(nodesNoStats));
  const validEdges = edgesArray.filter(
    (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
  );

  const nodeGroupsRaw = getNodeGroups(
    nodesNoStats,
    validEdges,
    peopleObj,
    placesObj,
    regionsObj,
  );

  let allowedIdsFromRegion = new Set<string>();
  if (regionId) {
    const rGroup = nodeGroupsRaw.find((g) => g.id === regionId);
    if (rGroup) allowedIdsFromRegion = new Set(rGroup.connected);
  } else if (terytParam) {
    allowedIdsFromRegion = new Set(["_none_"]);
  }

  let allowedIdsFromCompany = new Set<string>();
  if (companyId) {
    const cGroup = nodeGroupsRaw.find((g) => g.id === companyId);
    if (cGroup) allowedIdsFromCompany = new Set(cGroup.connected);
  } else if (krsParam) {
    allowedIdsFromCompany = new Set(["_none_"]);
  }

  const edgeSourceMap = new Map<string, Edge[]>();
  for (const edge of edgesArray) {
    if (!edgeSourceMap.has(edge.source)) edgeSourceMap.set(edge.source, []);
    edgeSourceMap.get(edge.source)!.push(edge);
  }

  let items = [];

  for (const [personId, person] of Object.entries(peopleObj)) {
    if (krsParam && !allowedIdsFromCompany.has(personId)) continue;
    if (terytParam && !allowedIdsFromRegion.has(personId)) continue;

    const personEdges = edgeSourceMap.get(personId) || [];
    const companiesList = [];
    const electionsList = [];
    let experienceMonths = 0;

    for (const edge of personEdges) {
      if (edge.type === "employed" && placesObj[edge.target]) {
        companiesList.push(placesObj[edge.target].name);

        const startStr =
          edge.start_date && typeof edge.start_date === "string"
            ? edge.start_date.split("T")[0]
            : null;
        let endStr =
          edge.end_date && typeof edge.end_date === "string"
            ? edge.end_date.split("T")[0]
            : null;

        let start = startStr ? new Date(startStr) : null;
        let end = endStr ? new Date(endStr) : new Date();

        if (start && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
          const diffMs = end.getTime() - start.getTime();
          experienceMonths += diffMs / (1000 * 60 * 60 * 24 * 30.44);
        }
      } else if (edge.type === "election") {
        const electionName = edge.name || edge.position || "Wybory";
        const committee = edge.committee ? ` (${edge.committee})` : "";
        electionsList.push(`${electionName}${committee}`);
      }
    }

    items.push({
      id: personId,
      name: person.name,
      parties: person.parties || [],
      companies: Array.from(new Set(companiesList)),
      elections: Array.from(new Set(electionsList)),
      experience: Math.floor((experienceMonths / 12) * 10) / 10,
      visibility: person.visibility || false,
    });
  }

  return items;
});

const updateQueryParams = async (options: any) => {
  const sortParam =
    options.sortBy.length > 0 ? options.sortBy[0].key : undefined;
  const sortDescParam =
    options.sortBy.length > 0
      ? options.sortBy[0].order === "desc"
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

const drawer = shallowRef(false);

const focusPerson = (item: any) => {
  console.log("focus person");
  drawer.value = true;
};

const searchInGoogle = (item: any) => {
  const queryParts = [item.name];

  if (regionNameState.value) {
    queryParts.push(regionNameState.value);
  }

  if (companyNameState.value) {
    queryParts.push(companyNameState.value);
  }

  const searchQuery = encodeURIComponent(queryParts.join(" "));
  window.open(`https://www.google.com/search?q=${searchQuery}`, "_blank");
};
</script>
