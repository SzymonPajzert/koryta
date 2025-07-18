<template>
  <apexchart type="treemap" height="250" :options="chartOptions" :series="series"></apexchart>
</template>

<script lang="ts" setup>
import { usePartyStatistics } from '@/composables/party'
import { computed } from 'vue'

const { parties: partiesUnfiltered, partyColors: partyColorsUnfiltered, results: resultsUnfiltered } = usePartyStatistics()
const nonZeroIndices = computed(() => resultsUnfiltered.value.map((x, i) => x > 0 ? i : -1).filter(i => i >= 0))
const parties = computed(() => partiesUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)))
const partyColors = computed(() => Object.values(partyColorsUnfiltered.value).filter((_, i) => nonZeroIndices.value.includes(i)))
const results = computed(() => resultsUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)))
const resultPercentage = computed(() => results.value.map(x => 100 * x / results.value.reduce((x, y) => Math.max(x, y))))
const chartOptions = computed(() => ({
  legend: {
    show: false
  },
  chart: {
    height: 200,
    type: 'treemap',
    toolbar: {
      show: false,
    },
  },
  colors: partyColors.value,
  plotOptions: {
    treemap: {
      distributed: true,
      enableShades: false
    }
  }
}));

const series = computed(() => ([{
  data: parties.value.map((party, index) => ({x: party, y: results.value[index]}))
}]))
</script>
