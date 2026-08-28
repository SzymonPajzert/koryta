<template>
  <StatsChartCard
    title="Rozkład ocen: Dobre znalezisko"
    :subtitle="subtitle"
    :loading="loading"
  >
    <template #chart>
      <ClientOnly>
        <apexchart
          v-if="total > 0"
          type="bar"
          height="280"
          :options="options"
          :series="series"
        />
        <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">
          Nikt jeszcze nie ocenił nikogo na plus.
        </div>
        <template #fallback>
          <v-skeleton-loader type="image" height="280" />
        </template>
      </ClientOnly>

      <div class="text-caption text-medium-emphasis mt-2">
        Ocena sumuje głosy użytkowników i wstępną ocenę pipeline'u, dlatego
        sięga powyżej +5 i obejmuje osoby, na które nikt jeszcze nie zagłosował.
      </div>

      <div class="d-flex justify-end mt-2">
        <v-btn
          variant="text"
          color="primary"
          size="small"
          :append-icon="mdiChevronRight"
          :to="candidatesLink"
        >
          Zobacz kandydatów do publikacji
        </v-btn>
      </div>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Ocena</th>
            <th class="text-right">Do publikacji</th>
            <th class="text-right">Opublikowane</th>
            <th class="text-right">Razem</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bucket in buckets ?? []" :key="bucket.floor">
            <td class="stats-numeric">{{ bucketLabel(bucket) }}</td>
            <td class="text-right stats-numeric">{{ bucket.pending }}</td>
            <td class="text-right stats-numeric">{{ bucket.approved }}</td>
            <td class="text-right font-weight-medium stats-numeric">
              {{ bucket.pending + bucket.approved }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiChevronRight } from "@mdi/js";
import type { PublicationBucket } from "~~/server/utils/databaseStats";
import {
  barPlotOptions,
  baseChartOptions,
  categorical,
  formatCount,
  ink,
  status,
} from "~/utils/chartTheme";

/**
 * Which of the well-rated people are already public.
 *
 * The old second chart broke the "Znaleziony problem" votes down the same way
 * "Dobre znalezisko" is; nobody was acting on it. This asks the question the
 * ratings are collected for instead: of the people rated worth looking at, how
 * many still have no public page — and how good are they.
 *
 * The unit is a person, not a vote, so the axis is `stats.votes.interesting`:
 * the sum of every verdict cast on them. Two things follow, and the caption
 * says both, because neither is guessable from the chart. It runs past +5, so
 * the top bucket is open-ended rather than a step of the -5..5 scale a single
 * voter uses. And the pipeline's own rating is part of that sum — most people
 * on this chart carry one and no human vote at all (`stats.votes.humanVoted`
 * is what says otherwise), so this is the shortlist to review and publish, not
 * a tally of what users have already endorsed.
 *
 * That is deliberately the same number `minVotes` filters on and the explore
 * table sorts by, so the link below the chart lands on exactly these people.
 */
const props = defineProps<{
  buckets: PublicationBucket[] | undefined;
  loading?: boolean;
}>();

const bucketLabel = (bucket: PublicationBucket) =>
  bucket.open ? `+${bucket.floor} i więcej` : `+${bucket.floor}`;

const pending = computed(() =>
  (props.buckets ?? []).reduce((sum, b) => sum + b.pending, 0),
);
const total = computed(
  () =>
    (props.buckets ?? []).reduce((sum, b) => sum + b.approved, 0) +
    pending.value,
);

const subtitle = computed(() =>
  total.value === 0
    ? "Osoby z dodatnią oceną"
    : `${formatCount(pending.value)} z ${formatCount(total.value)} osób z dodatnią oceną wciąż czeka na publikację`,
);

/** The queue the chart is about: unpublished, best rated first. */
const candidatesLink =
  "/eksploruj/tabela?visibility=private&minVotes=1&sortBy=stats.votes.interesting&sortDesc=true";

const series = computed(() => [
  {
    name: "Do publikacji",
    data: (props.buckets ?? []).map((b) => b.pending),
  },
  {
    name: "Opublikowane",
    data: (props.buckets ?? []).map((b) => b.approved),
  },
]);

const options = computed(() => {
  const base = baseChartOptions();
  return {
    ...base,
    chart: { ...base.chart, type: "bar", stacked: true },
    ...barPlotOptions(),
    plotOptions: {
      bar: {
        ...barPlotOptions().plotOptions.bar,
        columnWidth: "62%",
        // Five columns, so the running total fits on every cap.
        dataLabels: {
          total: {
            enabled: true,
            style: { color: ink.secondary, fontSize: "11px", fontWeight: 500 },
            offsetY: -4,
          },
        },
      },
    },
    // Blue for the queue, the status green for done - the same pairing the
    // verification bar above uses, so "published" reads the same on both.
    colors: [categorical[0], status.good],
    xaxis: {
      ...base.xaxis,
      categories: (props.buckets ?? []).map(bucketLabel),
      title: { text: "Łączna ocena osoby", style: { color: ink.muted } },
    },
    yaxis: {
      ...base.yaxis,
      title: { text: "Liczba osób", style: { color: ink.muted } },
      forceNiceScale: true,
      labels: {
        ...base.yaxis.labels,
        formatter: (value: number) => String(Math.round(value)),
      },
    },
    tooltip: { ...base.tooltip, shared: true, intersect: false },
  };
});
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
