<template>
  <section
    class="amc"
    aria-labelledby="amc-title"
    data-testid="activity-month-chart"
  >
    <!-- The figure on a block of colour is what gives the top of the page a
         focal point; the columns beside it stay one colour, so that block is
         never mistaken for one of the kinds. -->
    <div class="amc__pane">
      <h2 id="amc-title" class="amc__eyebrow">Ostatnie 30 dni</h2>
      <p class="amc__figure">
        <span class="amc__total">
          {{ stats ? polishNumber(stats.total) : "—"
          }}<span
            v-if="stats?.truncated.length"
            title="Dolna granica: w tym okresie było więcej zmian, niż zdążyliśmy policzyć."
            >+</span
          >
        </span>
        <span v-if="stats" class="amc__who">
          {{ nominativeNoun(stats.total, "zmiana", "zmiany", "zmian") }}
          od
          {{ polishCountingGenitive(stats.contributorCount, "osoby", "osób") }}
        </span>
      </p>
      <NuxtLink to="/eksploruj/statystyki" class="amc__link">
        Pełne statystyki
        <v-icon :icon="mdiArrowRight" size="16" />
      </NuxtLink>
    </div>

    <div class="amc__plot">
      <p v-if="failed" class="amc__empty">Nie udało się pobrać wykresu.</p>
      <p v-else-if="stats && !busiest" class="amc__empty">
        W tym okresie nikt nic nie zmieniał.
      </p>
      <template v-else-if="stats">
        <ClientOnly>
          <apexchart
            type="bar"
            :height="HEIGHT"
            :options="options"
            :series="series"
          />
          <template #fallback>
            <v-skeleton-loader type="image" :height="HEIGHT" />
          </template>
        </ClientOnly>
        <!-- The columns say nothing to a screen reader; the one fact they
             lead with does, and the full page has the table. -->
        <p v-if="busiest" class="d-sr-only">
          Najwięcej zmian było {{ fullDayLabel(busiest.date) }}:
          {{ busiest.total }}.
        </p>
      </template>
      <v-skeleton-loader v-else type="image" :height="HEIGHT" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiArrowRight } from "@mdi/js";
import type { ActivityStats } from "~~/server/api/stats/activity.get";
import { authRequest } from "~/composables/auth";
import {
  nominativeNoun,
  polishCountingGenitive,
  polishNumber,
} from "~/composables/polish";
import { fullDayLabel, monthChartOptions } from "~/utils/activityMonthChart";

/** The last 30 days of changes over the /aktywnosc feed, and the way to the
 * full statistics.
 *
 * One column per day, in one colour. The kinds are what /eksploruj/statystyki
 * stacks, but at this height a kind with a few changes a day is a 1px sliver,
 * and two of the four hues would need a table beside the chart that a card
 * this size has no room for. The split is in the tooltip instead.
 *
 * Fetched in the browser like the feed under it, with the reader's token, and
 * never awaited: the page does not wait for its header. */
const HEIGHT = 150;

const { data, error } = useAsyncData<ActivityStats>(
  "activity-month-chart",
  () =>
    authRequest<ActivityStats>("/api/stats/activity", {
      method: "GET",
      query: { days: 30 },
    }),
  { server: false, lazy: true },
);

const stats = computed(() => data.value ?? null);
const failed = computed(() => !!error.value && !data.value);
const daily = computed(() => stats.value?.daily ?? []);

/** The busiest day, or null for a month with nothing in it. */
const busiest = computed(() =>
  daily.value.reduce<(typeof daily.value)[number] | null>(
    (top, day) => (day.total > (top?.total ?? 0) ? day : top),
    null,
  ),
);

const series = computed(() => [
  { name: "Zmiany", data: daily.value.map((day) => day.total) },
]);

const options = computed(() => monthChartOptions(daily.value));
</script>

<style scoped>
.amc {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 600px) {
  .amc {
    grid-template-columns: 208px minmax(0, 1fr);
  }
}

/* White on ink-info is 6.3:1, surface-info on it 5.17:1. The pane rounds its
   own corners rather than the card clipping it, so the tooltip may run past
   the card's edge instead of being cut off by it. */
.amc__pane {
  background: rgb(var(--v-theme-ink-info));
  border-radius: 9px 9px 0 0;
  color: #ffffff;
  display: grid;
  gap: 4px 12px;
  grid-template-areas:
    "eyebrow link"
    "figure figure";
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 14px 16px 16px;
}

@media (min-width: 600px) {
  .amc__pane {
    border-radius: 9px 0 0 9px;
    grid-template-areas: "eyebrow" "figure" "link";
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr auto;
    padding: 18px 20px;
  }
}

.amc__eyebrow {
  color: rgb(var(--v-theme-surface-info));
  font-size: 0.875rem;
  font-weight: 500;
  grid-area: eyebrow;
  line-height: 1.25rem;
  margin: 0;
}

.amc__figure {
  align-items: baseline;
  column-gap: 10px;
  display: flex;
  flex-wrap: wrap;
  grid-area: figure;
  margin: 0;
}

@media (min-width: 600px) {
  .amc__figure {
    align-content: flex-start;
    flex-direction: column;
    margin-top: 6px;
  }
}

.amc__total {
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  white-space: nowrap;
}

@media (min-width: 600px) {
  .amc__total {
    font-size: 3rem;
  }
}

.amc__who {
  color: rgb(var(--v-theme-surface-info));
  font-size: 0.9375rem;
}

/* 44px to aim at on a phone, where it sits beside the heading, without the
   padding pushing the heading down. */
.amc__link {
  align-items: center;
  align-self: start;
  color: #ffffff;
  display: inline-flex;
  font-size: 0.875rem;
  font-weight: 500;
  gap: 4px;
  grid-area: link;
  justify-self: start;
  margin: -12px 0;
  padding: 12px 0;
  text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.5);
  text-underline-offset: 3px;
}

@media (min-width: 600px) {
  .amc__link {
    align-self: end;
  }
}

.amc__link:hover,
.amc__link:focus-visible {
  text-decoration-color: #ffffff;
}

.amc__plot {
  min-width: 0;
  padding: 12px 12px 8px 4px;
}

.amc__empty {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  font-size: 0.875rem;
  justify-content: center;
  margin: 0;
  min-height: 150px;
}

/* The tooltip is apexcharts' markup, built in `monthChartOptions`. */
.amc :deep(.amc-tip) {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  line-height: 1.25rem;
  min-width: 190px;
  padding: 8px 12px;
}

.amc :deep(.amc-tip__total) {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.9375rem;
  font-weight: 700;
}

.amc :deep(.amc-tip__kinds) {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}

.amc :deep(.amc-tip__kinds li) {
  display: flex;
  gap: 16px;
  justify-content: space-between;
}

.amc :deep(.amc-tip__kinds b) {
  color: rgb(var(--v-theme-ink-strong));
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
