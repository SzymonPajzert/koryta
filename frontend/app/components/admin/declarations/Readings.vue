<template>
  <StatsChartCard
    title="Odczyty dzień po dniu"
    :subtitle="subtitle"
    :loading="loading"
    hide-view-toggle-on-mobile
  >
    <template #chart>
      <StatsDailyColumns
        :dates="days.map((day) => day.day)"
        :bands="bands"
        value-title="Odpowiedzi"
        empty-text="W ostatnich 30 dniach nikt niczego nie odczytał."
      />
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Dzień</th>
            <th class="text-right">Odpowiedzi</th>
            <th class="text-right">Rozstrzygnięte wycinki</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in newestFirst" :key="day.day">
            <td class="text-no-wrap">{{ formatDayLabel(day.day) }}</td>
            <td class="text-right dreadings__numeric">{{ day.answers }}</td>
            <td class="text-right dreadings__numeric">{{ day.settled }}</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { categorical, formatDayLabel, status } from "~/utils/chartTheme";
import { polishCountingGenitive } from "~/composables/polish";
import type { DailyColumnsBand } from "~/components/stats/DailyColumns.vue";

/** How much reading gets done: each day's answers, and how many of them
 * settled a crop - the rest are first readings waiting for a second, or
 * readings somebody contradicted. The column is the day's answers; the green
 * at its foot is the part that moved a crop on.
 *
 * Settled is a state, so it wears the status green; the rest is the one
 * series left, in the first categorical slot. The pair passed the palette
 * check as a stack. */
const props = defineProps<{
  /** The last 30 Warsaw days, oldest first. */
  days: { day: string; answers: number; settled: number }[];
  /** Over all time. */
  answers: number;
  readers: number;
  loading?: boolean;
}>();

const bands = computed<DailyColumnsBand[]>(() => [
  {
    key: "settled",
    label: "Rozstrzygnęły wycinek",
    color: status.good,
    // Never more than the day's answers: an admin's decision settles a crop
    // without a reader's answer, and would otherwise stack above the total.
    values: props.days.map((day) => Math.min(day.settled, day.answers)),
  },
  {
    key: "other",
    label: "Pozostałe odpowiedzi",
    color: categorical[0],
    values: props.days.map((day) => Math.max(0, day.answers - day.settled)),
  },
]);

const newestFirst = computed(() => [...props.days].reverse());

const subtitle = computed(
  () =>
    `Ostatnie 30 dni. Łącznie ${polishCountingGenitive(props.answers, "odpowiedź", "odpowiedzi")} od ${polishCountingGenitive(props.readers, "czytelnika", "czytelników")}.`,
);
</script>

<style scoped>
.dreadings__numeric {
  font-variant-numeric: tabular-nums;
}
</style>
