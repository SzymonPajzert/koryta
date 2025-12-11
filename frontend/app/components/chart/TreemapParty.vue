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
import { usePartyChartData } from "@/composables/chart";
import { computed } from "vue";

const { parties, partyColors, series } = await usePartyChartData();
const router = useRouter();

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
</script>
