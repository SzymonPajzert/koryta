<template>
  <StatsChartCard
    title="Co się działo w bazie"
    :subtitle="subtitle"
    :loading="loading"
  >
    <template #chart>
      <StatsDailyColumns
        :dates="daily.map((day) => day.date)"
        :bands="bands"
        value-title="Liczba zmian"
        empty-text="W tym okresie nikt nic nie zmieniał."
      />
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Dzień</th>
            <th v-for="kind in activityKinds" :key="kind" class="text-right">
              {{ activityKindLabels[kind] }}
            </th>
            <th class="text-right">Razem</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in reversed" :key="day.date">
            <td>{{ formatDayLabel(day.date) }}</td>
            <td
              v-for="kind in activityKinds"
              :key="kind"
              class="text-right stats-numeric"
            >
              {{ day.counts[kind] }}
            </td>
            <td class="text-right font-weight-medium stats-numeric">
              {{ day.total }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  activityKinds,
  activityKindLabels,
  type ActivityCounts,
} from "~~/shared/activity";
import { activityColors, formatDayLabel } from "~/utils/chartTheme";

/** Columns show a day's total broken into the kinds of change that made it up,
 * which is what "co się działo" means here: one stacked series per interaction
 * the site records, in `activityKinds` order.
 *
 * Four bands, which is inside the method's comfortable ceiling for a stack - it
 * was seven, and a legend of seven over a column chart is a key the reader has
 * to learn before the chart says anything. The legend is still always on and the
 * table view below still carries every number: two of the four hues sit below
 * 3:1 on white and are only allowed with that relief. See `chartTheme.ts` before
 * adding a fifth. */
const props = defineProps<{
  daily: { date: string; counts: ActivityCounts; total: number }[];
  loading?: boolean;
}>();

const subtitle = computed(() => {
  const total = props.daily.reduce((sum, day) => sum + day.total, 0);
  return `${total} zmian w ${props.daily.length} dniach, po rodzaju działania`;
});

const reversed = computed(() => [...props.daily].reverse());

const bands = computed(() =>
  activityKinds.map((kind) => ({
    key: kind,
    label: activityKindLabels[kind],
    color: activityColors[kind],
    values: props.daily.map((day) => day.counts[kind]),
  })),
);
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
