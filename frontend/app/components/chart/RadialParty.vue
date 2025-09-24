<template>
  <apexchart
    type="radialBar"
    height="390"
    :options="chartOptions"
    :series="resultPercentage"
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
const nonZeroIndices = computed(() =>
  resultsUnfiltered.value.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0),
);
const parties = computed(() =>
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
const resultPercentage = computed(() =>
  results.value.map(
    (x) => (100 * x) / results.value.reduce((x, y) => Math.max(x, y)),
  ),
);
const chartOptions = computed(() => ({
  chart: {
    height: 390,
    type: "radialBar",
  },
  plotOptions: {
    radialBar: {
      offsetY: 0,
      startAngle: 0,
      endAngle: 270,
      hollow: {
        margin: 5,
        size: "30%",
        background: "transparent",
        image: undefined,
      },
      dataLabels: {
        name: {
          show: false,
        },
        value: {
          show: false,
        },
      },
      barLabels: {
        enabled: true,
        useSeriesColors: true,
        offsetX: -8,
        fontSize: "16px",
        formatter: function (
          seriesName: string,
          opts: { seriesIndex: number },
        ) {
          return seriesName + ":  " + results.value[opts.seriesIndex];
        },
      },
    },
  },
  colors: partyColors.value,
  labels: parties.value,
  responsive: [
    {
      breakpoint: 480,
      options: {
        legend: {
          show: false,
        },
      },
    },
  ],
}));
</script>
