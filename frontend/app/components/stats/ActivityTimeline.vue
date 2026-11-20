<template>
  <StatsChartCard
    title="Co się działo w bazie"
    :subtitle="subtitle"
    :loading="loading"
  >
    <template #chart>
      <StatsDailyColumns
        id="activity-changes"
        :dates="dates"
        :bands="changeBands"
        value-title="Zmiany"
        empty-text="W tym okresie nikt nic nie zmieniał."
        legend="top"
        :height="250"
        :date-axis="false"
        group="activity-days"
        :value-axis-width="VALUE_AXIS_WIDTH"
      />
      <p
        class="timeline__band"
        :style="{ color: ink.secondary }"
        data-testid="activity-readings-label"
      >
        <span
          class="timeline__dot"
          :style="{ backgroundColor: activityColors.reading }"
          aria-hidden="true"
        />
        {{ activityKindLabels.reading }}
      </p>
      <StatsDailyColumns
        id="activity-readings"
        :dates="dates"
        :bands="readingBands"
        value-title="Odczyty"
        empty-text="W tym okresie nikt nic nie odczytał."
        :legend="false"
        :height="150"
        group="activity-days"
        :value-axis-width="VALUE_AXIS_WIDTH"
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
  changeKinds,
  type ActivityCounts,
} from "~~/shared/activity";
import { nominativeNoun, polishNumber } from "~/composables/polish";
import { activityColors, formatDayLabel, ink } from "~/utils/chartTheme";

/** Columns show a day's changes broken into the kinds that made them up,
 * which is what "co się działo" means here: one stacked series per kind of
 * change the site records, in `changeKinds` order.
 *
 * Four bands, which is inside the method's comfortable ceiling for a stack - it
 * was seven, and a legend of seven over a column chart is a key the reader has
 * to learn before the chart says anything. The legend is still always on and the
 * table view below still carries every number: two of the four hues sit below
 * 3:1 on white and are only allowed with that relief. See `chartTheme.ts` before
 * adding a fifth.
 *
 * Readings are drawn apart, under the stack, on the same days and a scale of
 * their own: three quarters of a month's work, in the stack they flattened the
 * other kinds to slivers (decision on 2026-11-19). */
const props = defineProps<{
  daily: { date: string; counts: ActivityCounts; total: number }[];
  loading?: boolean;
}>();

/** The value axes' labels at one width, so the two charts' days line up. */
const VALUE_AXIS_WIDTH = 36;

const subtitle = computed(() => {
  const total = props.daily.reduce((sum, day) => sum + day.total, 0);
  return `${polishNumber(total)} ${nominativeNoun(
    total,
    "działanie",
    "działania",
    "działań",
  )} w ${props.daily.length} dniach`;
});

const dates = computed(() => props.daily.map((day) => day.date));

const reversed = computed(() => [...props.daily].reverse());

const changeBands = computed(() =>
  changeKinds.map((kind) => ({
    key: kind,
    label: activityKindLabels[kind],
    color: activityColors[kind],
    values: props.daily.map((day) => day.counts[kind]),
  })),
);

const readingBands = computed(() => [
  {
    key: "reading",
    label: activityKindLabels.reading,
    color: activityColors.reading,
    values: props.daily.map((day) => day.counts.reading),
  },
]);
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}

/* The band's name over it, drawn like an item of the legend over the stack. */
.timeline__band {
  align-items: center;
  display: flex;
  font-size: 0.75rem;
  gap: 6px;
  margin: 0 0 0 22px;
}

.timeline__dot {
  border-radius: 50%;
  display: inline-block;
  height: 10px;
  width: 10px;
}
</style>
