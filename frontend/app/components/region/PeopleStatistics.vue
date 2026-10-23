<template>
  <v-card v-if="loading" class="pa-4 d-flex justify-center">
    <v-progress-circular indeterminate></v-progress-circular>
  </v-card>
  <!-- No margin of its own: the page stands its two regions one section gap
       apart (`k-sections`), and under the last one the layout's gap to the
       footer is the whole of it. -->
  <v-card v-else-if="data" class="pa-4">
    <!-- The region's name heads its section, on the section scale under the
         page's h1 - 24px, 20 on a phone - and above the chart, which is the
         council's and means nothing before its name. It used to sit in the
         second column, beside the chart on a computer and under it on a
         phone, where the section opened on an unlabelled half-gauge. -->
    <h2 class="k-section-title mb-2">
      {{ data.regionName }}
    </h2>
    <v-row>
      <v-col cols="12" md="6">
        <!-- Measured, because the chart's height is worked out from its
             width (`gaugeGrid` below); drawn once that width is known, so it
             does not open at a wrong size and resize in front of the
             reader. -->
        <div ref="gaugeBox">
          <apexchart
            v-if="currentChartOptions && currentSeries && gaugeWidth > 0"
            type="donut"
            height="auto"
            :options="currentChartOptions"
            :series="currentSeries"
          />
        </div>
      </v-col>
      <v-col cols="12" md="6" class="d-flex align-center">
        <v-list
          v-model:selected="selectedChart"
          bg-color="background"
          class="w-100 ga-4 d-flex flex-column"
          item-props
          :items="items"
          lines="two"
          mandatory
        >
          <template #item="{ props: itemProps }">
            <!-- A choice between the two charts, so drawn as a control: the
                 tint and no line (assets/css/edges.css). Outlined in the
                 medium ink, the two were the darkest lines on the page,
                 heavier than the card holding them. The one on show keeps
                 Vuetify's selected layer over the tint and its words go to
                 full ink; the other stays quiet.

                 `rounded`, because without it or `nav` a list item asks for
                 Vuetify's `rounded-0`, a border-radius of 0 !important that
                 squared off the control radius below. With it the item asks
                 for its own 4px instead, which the radius below outranks. -->
            <v-list-item
              v-bind="itemProps"
              base-color="medium-emphasis"
              color="high-emphasis"
              rounded
              class="people-stats__choice"
            >
              <template #title>
                <div
                  class="d-flex justify-space-between align-center text-body-medium"
                >
                  <strong>{{ itemProps.title }}</strong>

                  <div>{{ peopleCount(itemProps.price) }}</div>
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
                    :prepend-icon="mdiAlertCircleOutline"
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
import { useElementSize } from "@vueuse/core";
import { parties as allParties, partyColors } from "~~/shared/misc";
import { polishCounting } from "~/composables/polish";
import { partyRemainder } from "~/utils/chartTheme";
import {
  useRegionStatistics,
  type Person,
} from "~/composables/stats/useRegionStatistics";

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

/** A choice's count in the form its number takes: „10 osób”, but „24 osoby”,
 * which the sejmik's choice used to print as „24 osób”. */
function peopleCount(count: number) {
  return polishCounting(count, "osoba", "osoby", "osób");
}

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
    if (label === "Zatrudnieni (inne / brak partii)")
      return partyRemainder.otherParty;
    if (label === "Niezatrudnieni / Reszta") return partyRemainder.none;
    return partyRemainder.fallback;
  });

  // No height here: the component's `height` prop overrides it, and the
  // template leaves that to apexcharts (`gaugeGrid` below).
  return {
    series,
    options: {
      chart: {
        type: "donut",
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
    },
  };
}

/** The chart's column, measured: the half-gauge is as wide as it. */
const gaugeBox = ref<HTMLElement | null>(null);
const { width: gaugeWidth } = useElementSize(gaugeBox);

/** How much more than half the width comes off the bottom. apexcharts' own
 * height for a donut with its legend on top counts the legend twice, above
 * the circle and again under it, plus a few px of its own; 24 takes that
 * back for a legend of one row and leaves 8px under the half-gauge's flat
 * edge. A legend that wraps adds its second row there, under the gauge,
 * rather than pushing the gauge out of the bottom of the chart. */
const GAUGE_BELOW_HALF = 24;

/** The half-gauge's height, from its width.
 *
 * apexcharts sizes a donut by the shorter side of its plot area, so a half
 * donut as wide as its column needs an area as tall as the column is wide,
 * and draws nothing in the lower half of it. Left to size itself (`height`
 * "auto"), the chart measures out that whole circle under its legend; the
 * grid's bottom padding takes the unused half back off. What is left is the
 * legend and the half-gauge: about half the width, plus the legend.
 *
 * The padding used to be a fixed -250, and -180 on a fixed 320px under 960 -
 * right for one width each. On a phone that left about 130px of blank under
 * the gauge, two fifths of the chart. */
function gaugeGrid(width: number) {
  return { padding: { bottom: -(Math.round(width / 2) + GAUGE_BELOW_HALF) } };
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
const currentChartOptions = computed(() => {
  const options = activeChartData.value?.options;
  return options && { ...options, grid: gaugeGrid(gaugeWidth.value) };
});
</script>

<style scoped>
.gap-2 {
  gap: 0.5rem;
}

/* The control tint and the control radius. Vuetify's selected layer is
   drawn in the text colour over it, so the chosen one reads darker without a
   colour of its own. A subtitle is .6 of its item's ink in Vuetify, which on
   the quiet one came to 2.5:1; at the .78 the site gives a card's subtitle
   (assets/css/type.css) it is 3.5:1 there and 6.6:1 on the chosen one. */
.people-stats__choice {
  --v-list-item-subtitle-opacity: 0.78;

  background: var(--k-tonal);
  border-radius: var(--k-r-control);
}

/* The ring a keyboard's focus draws round it, on the same corners: Vuetify
   draws it at a fixed 4px. */
.people-stats__choice::after {
  border-radius: inherit;
}

/* The other one, under a pointer: the controls' hover tint, which Vuetify's
   own hover layer - 4% of the quiet ink - barely moved. */
@media (hover: hover) {
  .people-stats__choice:not(.v-list-item--active):hover {
    background: var(--k-tonal-hover);
  }
}
</style>
