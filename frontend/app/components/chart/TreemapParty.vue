<template>
  <apexchart
    v-if="chartOptions && series"
    type="treemap"
    height="250"
    :options="chartOptions"
    :series="series"
  />
</template>

<script lang="ts" setup>
import { usePartyStatistics } from "@/composables/party";
import { computed } from "vue";
import {
  parties as partiesUnfiltered,
  partyColors as partyColorsUnfiltered,
} from "~~/shared/misc";

const { results: resultsUnfiltered } = await usePartyStatistics();
const router = useRouter();

const nonZeroIndices = computed(() =>
  resultsUnfiltered.value.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0),
);
const parties = computed(
  () =>
    partiesUnfiltered.filter((_, i) => nonZeroIndices.value.includes(i)),
);
const partyColors = computed(() =>
  Object.values(partyColorsUnfiltered).filter((_, i) =>
    nonZeroIndices.value.includes(i),
  ),
);
const results = computed(() =>
  resultsUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)),
);
const chartOptions = computed(() => ({
  legend: {
    show: false,
  },
  chart: {
    height: 200,
    type: "treemap",
    toolbar: {
      show: false,
    },
    events: {
      click: function (
        _event: unknown,
        _chartContext: unknown,
        opts: { dataPointIndex: number },
      ) {
        console.log(opts.dataPointIndex);
        router.push({
          path: "/lista",
          query: { partia: parties.value[opts.dataPointIndex] },
        });
      },
    },
  },
  colors: partyColors.value,
  plotOptions: {
    treemap: {
      distributed: true,
      enableShades: false,
    },
  },
}));

const series = computed(() => {
  if (parties.value.length !== results.value.length) return [];

  return [
    {
      data: parties.value.map((party, index) => ({
        x: party,
        y: results.value[index],
      })),
    },
  ];
});
</script>
