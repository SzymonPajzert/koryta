<template>
  <apexchart type="pie" height="800" :options="chartOptions" :series="results"></apexchart>
</template>

<script lang="ts" setup>
import { usePartyStatistics } from '@/composables/party'
import { computed } from 'vue'

const { parties: partiesUnfiltered, partyColors: partyColorsUnfiltered, results: resultsUnfiltered } = usePartyStatistics();
const nonZeroIndices = computed(() => resultsUnfiltered.value.map((x, i) => x > 0 ? i : -1).filter(i => i >= 0))
const parties = computed(() => partiesUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)))
const partyColors = computed(() => partyColorsUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)))
const results = computed(() => resultsUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)))
const chartOptions = computed(() => {
  return ({
    chart: {
      height: 700,
      type: 'pie',
    },
    colors: partyColors.value,
    labels: parties.value,
    responsive: [{
      breakpoint: 480,
      options: {
        legend: {
          show: false
        }
      }
    }],
    dataLabels: {
      enabled: true,
      formatter: function (val: string, opts: any) {
        return opts.w.config.series[opts.seriesIndex];
      }
    }
  })
})
</script>
