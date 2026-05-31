<template>
  <v-card v-if="loading" class="pa-4 d-flex justify-center">
    <v-progress-circular indeterminate></v-progress-circular>
  </v-card>
  <v-card v-else-if="data" class="pa-4 mb-4">
    <v-row>
      <v-col cols="12" md="6" height="260">
        <apexchart
          v-if="currentChartOptions && currentSeries"
          type="donut"
          :options="currentChartOptions"
          :series="currentSeries"
        />
      </v-col>
      <v-col cols="12" md="6" class="d-flex align-center justify-center">
        <div>
          <v-card-title class="text-h5 mb-1 text-center text-wrap">
            {{ data.regionName }}
          </v-card-title>
          <v-list
            v-model:selected="selectedChart"
            bg-color="background"
            class="mx-auto ga-4 d-flex flex-column"
            item-props
            :items="items"
            lines="two"
            mandatory
          >
            <template #item="{ props: itemProps }">
              <v-list-item
                v-bind="itemProps"
                base-color="medium-emphasis"
                rounded="lg"
                variant="outlined"
              >
                <template #title>
                  <div
                    class="d-flex justify-space-between align-center text-body-medium"
                  >
                    <strong>{{ itemProps.title }}</strong>

                    <div>{{ itemProps.price }} osób</div>
                  </div>
                </template>

                <template #subtitle>
                  <div class="d-flex justify-space-between align-center">
                    {{ itemProps.subtitle }}
                  </div>
                </template>
              </v-list-item>
            </template>
          </v-list>
        </div>
      </v-col>
    </v-row>

    <v-expansion-panels class="mb-6">
      <v-expansion-panel>
        <v-expansion-panel-title class="text-h6" color="primary">
          Zobacz listę urzędujących osób
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div v-if="currentlyEmployed.length">
            <h3 class="text-subtitle-1 font-weight-bold mt-4 mb-2">
              Osoby z obecnym publicznym zatrudnieniem
            </h3>
            <v-list density="compact">
              <v-list-item
                v-for="(person, idx) in currentlyEmployed"
                :key="idx"
              >
                <v-list-item-title
                  class="d-flex align-center flex-wrap gap-2 py-1"
                >
                  <NuxtLink
                    v-if="person.accountId"
                    :to="getPersonLink(person.accountId)"
                    class="text-decoration-none font-weight-medium text-primary"
                  >
                    {{ person.name }}
                  </NuxtLink>
                  <span v-else class="font-weight-medium">{{
                    person.name
                  }}</span>

                  <PartyChip
                    v-if="person.party"
                    :party="person.party"
                    class="ml-2"
                  />

                  <span class="mx-2 text-grey-darken-1">&mdash;</span>

                  <span class="text-body-2">
                    <NuxtLink
                      v-if="person.currentEmployment?.nodeId"
                      :to="`/miejsce/${person.currentEmployment.nodeId}`"
                      class="text-decoration-none text-secondary"
                    >
                      {{ person.currentEmployment.name }}
                    </NuxtLink>
                    <span v-else>{{ person.currentEmployment?.name }}</span>
                  </span>
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </div>

          <div v-if="pastEmployed.length">
            <h3 class="text-subtitle-1 font-weight-bold mt-4 mb-2">
              Osoby z zatrudnieniem w przeszłości
            </h3>
            <v-list density="compact">
              <v-list-item v-for="(person, idx) in pastEmployed" :key="idx">
                <v-list-item-title
                  class="d-flex align-center flex-wrap gap-2 py-1"
                >
                  <NuxtLink
                    v-if="person.accountId"
                    :to="getPersonLink(person.accountId)"
                    class="text-decoration-none font-weight-medium text-primary"
                  >
                    {{ person.name }}
                  </NuxtLink>
                  <span v-else class="font-weight-medium">{{
                    person.name
                  }}</span>

                  <PartyChip
                    v-if="person.party"
                    :party="person.party"
                    class="ml-2"
                  />

                  <span class="mx-2 text-grey-darken-1">&mdash;</span>

                  <span class="text-body-2 text-grey">
                    W przeszłości:
                    <NuxtLink
                      v-if="person.pastEmployment?.nodeId"
                      :to="`/miejsce/${person.pastEmployment.nodeId}`"
                      class="text-decoration-none text-secondary"
                    >
                      {{ person.pastEmployment.name }}
                    </NuxtLink>
                    <span v-else>{{ person.pastEmployment?.name }}</span>
                  </span>
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </div>

          <div v-if="notEmployed.length">
            <h3 class="text-subtitle-1 font-weight-bold mt-4 mb-2">
              Osoby bez publicznego zatrudnienia
            </h3>
            <v-list density="compact">
              <v-list-item v-for="(person, idx) in notEmployed" :key="idx">
                <v-list-item-title
                  class="d-flex align-center justify-space-between flex-wrap gap-2 py-1"
                >
                  <div class="d-flex align-center">
                    <NuxtLink
                      v-if="person.accountId"
                      :to="getPersonLink(person.accountId)"
                      class="text-decoration-none font-weight-medium text-primary"
                    >
                      {{ person.name }}
                    </NuxtLink>
                    <span v-else class="font-weight-medium">{{
                      person.name
                    }}</span>
                    <PartyChip
                      v-if="person.party"
                      :party="person.party"
                      class="ml-2"
                    />
                  </div>
                  <!-- TODO add support for adding people <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    prepend-icon="mdi-alert-circle-outline"
                    @click="reportPerson(person)"
                  >
                    Zgłoś notatkę
                  </v-btn> -->
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { parties as allParties, partyColors } from "~~/shared/misc";
import type { Person } from "~/composables/useRegionStatistics";

const props = defineProps<{
  teryt: string;
}>();

const { data, loading } = useRegionStatistics(props.teryt);

const currentlyEmployed = computed(() => {
  if (!data.value) return [];
  return data.value.people.filter((p) => !!p.currentEmployment);
});

const pastEmployed = computed(() => {
  if (!data.value) return [];
  return data.value.people.filter(
    (p) => !p.currentEmployment && !!p.pastEmployment,
  );
});

const notEmployed = computed(() => {
  if (!data.value) return [];
  return data.value.people.filter(
    (p) => !p.currentEmployment && !p.pastEmployment,
  );
});

const everEmployed = computed(() => {
  if (!data.value) return [];
  return data.value.people.filter(
    (p) => !!p.currentEmployment || !!p.pastEmployment,
  );
});

const items = computed(() => [
  {
    title: "Aktualnie zatrudnieni",
    subtitle: "Osoby aktualnie zatrudnione w publicznych spółkach",
    price: currentlyEmployed.value.length,
    value: "current",
  },
  {
    title: "Kiedykolwiek zatrudnieni",
    subtitle: "Osoby kiedykolwiek zatrudnione w publicznych spółkach",
    price: everEmployed.value.length,
    value: "all",
  },
]);

function isExternalLink(accountId: string) {
  return accountId.includes("rejestr.io") || accountId.startsWith("http");
}

function getPersonLink(accountId: string) {
  return isExternalLink(accountId) ? accountId : `/osoba/${accountId}`;
}

function explicitValuesFormatter(
  _val: number,
  {
    seriesIndex,
    w,
  }: { seriesIndex: number; w: { config: { series: number[] } } },
) {
  return w.config.series[seriesIndex];
}

function buildChartData(employedPeople: Person[], notEmployedPeople: Person[]) {
  const counts: Record<string, number> = {};

  // Osoby z zatrudnieniem dzielone na partie
  for (const person of employedPeople) {
    if (person.party && allParties.includes(person.party)) {
      counts[person.party] = (counts[person.party] || 0) + 1;
    } else {
      counts["Zatrudnieni (inne / brak partii)"] =
        (counts["Zatrudnieni (inne / brak partii)"] || 0) + 1;
    }
  }

  // Reszta (niezatrudnieni)
  const notEmployedCount = notEmployedPeople.length;
  if (notEmployedCount > 0) {
    counts["Niezatrudnieni"] = notEmployedCount;
  }

  const labels = Object.keys(counts);
  const series = Object.values(counts);

  const colors = labels.map((label) => {
    if (partyColors[label]) return partyColors[label];
    if (label === "Zatrudnieni (inne / brak partii)") return "#888888";
    if (label === "Niezatrudnieni / Reszta") return "#e0e0e0";
    return "#cccccc";
  });

  return {
    series,
    options: {
      chart: {
        type: "donut",
        height: 400,
      },
      labels,
      colors,
      legend: {
        position: "top",
      },
      dataLabels: {
        enabled: true,
        formatter: explicitValuesFormatter,
      },
      plotOptions: {
        pie: {
          startAngle: -90,
          endAngle: 90,
          donut: {
            size: "65%",
          },
        },
      },
      grid: {
        padding: {
          bottom: -250,
        },
      },
      responsive: [
        {
          breakpoint: 960,
          options: {
            chart: {
              height: 320,
            },
            grid: {
              padding: {
                bottom: -180,
              },
            },
          },
        },
      ],
    },
  };
}

const currentChartData = computed(() => {
  if (!data.value) return null;
  return buildChartData(
    currentlyEmployed.value,
    data.value.people.filter((p) => !p.currentEmployment),
  );
});

const everChartData = computed(() => {
  if (!data.value) return null;
  return buildChartData(everEmployed.value, notEmployed.value);
});

const selectedChart = ref(["current"]);

const activeChartData = computed(() => {
  if (selectedChart.value.includes("current")) {
    return currentChartData.value;
  }
  return everChartData.value;
});

const currentSeries = computed(() => activeChartData.value?.series);
const currentChartOptions = computed(() => activeChartData.value?.options);
</script>

<style scoped>
.gap-2 {
  gap: 0.5rem;
}
</style>
