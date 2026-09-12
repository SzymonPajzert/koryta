<template>
  <v-card variant="outlined" height="100%">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-medium text-wrap">
        {{ title }}
      </v-card-title>
      <v-card-subtitle v-if="subtitle" class="text-wrap">
        {{ subtitle }}
      </v-card-subtitle>
      <template #append>
        <v-btn-toggle
          v-model="view"
          class="stats-card__view"
          :class="{ 'stats-card__view--desktop-only': hideViewToggleOnMobile }"
          density="compact"
          variant="outlined"
          divided
          mandatory
        >
          <v-btn value="chart" size="small" aria-label="Wykres">
            <v-icon :icon="mdiChartBar" />
            <v-tooltip activator="parent" location="bottom">Wykres</v-tooltip>
          </v-btn>
          <v-btn value="table" size="small" aria-label="Tabela z liczbami">
            <v-icon :icon="mdiTable" />
            <v-tooltip activator="parent" location="bottom">
              Tabela z liczbami
            </v-tooltip>
          </v-btn>
        </v-btn-toggle>
      </template>
    </v-card-item>

    <v-card-text :class="{ 'stats-card--stale': loading }">
      <!-- Above both views, because a control that narrows what is charted
           narrows what is tabulated too - a range picker that only applied to
           the picture would leave the table answering a different question. -->
      <div v-if="$slots.controls" class="mb-3">
        <slot name="controls" />
      </div>
      <!-- v-show, not v-if: apexcharts measures its container on mount and
           would come back zero-width after a round trip through the table. -->
      <div v-show="view === 'chart'">
        <slot name="chart" />
      </div>
      <div v-if="view === 'table'" class="stats-card__table">
        <slot name="table" />
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiChartBar, mdiTable } from "@mdi/js";

/** A chart and its table-view twin under one heading.
 *
 * The table is not an afterthought: three of the palette's slots sit below 3:1
 * against white, which the method permits only when the values are readable
 * some other way. It is also what makes the chart usable without colour at all.
 */
defineProps<{
  title: string;
  subtitle?: string;
  /** Dim the current render rather than swapping in a skeleton - a refetch
   * should not make the page jump. */
  loading?: boolean;
  /** Drop the chart/table switch below `sm`.
   *
   * Opt-in rather than the default, because it is a real loss: the table is
   * where the numbers are legible without colour, and taking it away takes that
   * with it. It is worth it on a card whose title is long enough that the
   * switch beside it squeezes the heading into three wrapped lines - two icons'
   * worth of width costing a screenful of height on a phone - and not worth it
   * on the short-titled cards of /eksploruj/statystyki. */
  hideViewToggleOnMobile?: boolean;
}>();

const view = ref<"chart" | "table">("chart");
</script>

<style scoped>
.stats-card--stale {
  opacity: 0.45;
  transition: opacity 150ms ease;
}

.stats-card__table {
  max-height: 420px;
  overflow-y: auto;
}

@media (max-width: 599.98px) {
  .stats-card__view--desktop-only {
    display: none;
  }
}
</style>
