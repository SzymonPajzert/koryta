<template>
  <StatsChartCard
    v-if="hasData"
    data-testid="party-timeline"
    title="Kto trzyma stanowiska"
    :subtitle="subtitle"
    :loading="status === 'pending'"
    hide-view-toggle-on-mobile
  >
    <template #controls>
      <v-btn-toggle
        v-model="range"
        data-testid="party-timeline-range"
        density="compact"
        variant="outlined"
        divided
        mandatory
        rounded="lg"
      >
        <v-btn
          v-for="option in rangeOptions"
          :key="option.value"
          :value="option.value"
          size="small"
          class="text-none"
          :text="option.label"
        />
      </v-btn-toggle>
    </template>

    <template #chart>
      <ClientOnly>
        <apexchart
          type="line"
          height="340"
          :options="options"
          :series="series"
          data-testid="party-timeline-chart"
        />
        <template #fallback>
          <!-- Same height as the chart. This section sits above „Co nowego”, so
               a fallback of any other size moves the whole feed down the moment
               apexcharts mounts. -->
          <v-skeleton-loader type="image" height="340" />
        </template>
      </ClientOnly>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Miesiąc</th>
            <th v-for="line in series" :key="line.name" class="text-right">
              {{ line.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tableRows" :key="row.month">
            <td>{{ row.label }}</td>
            <td
              v-for="(count, index) in row.counts"
              :key="index"
              class="text-right stats-numeric"
            >
              {{ count }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { authFetch } from "~/composables/auth";
import { partyColors, partyMergedLabels } from "~~/shared/misc";
import { baseChartOptions, formatCount, ink } from "~/utils/chartTheme";
import type { PartyTimelineResponse } from "~~/server/api/stats/partyTimeline.get";

/** How many people held a post in each month, one line per party.
 *
 * The colours are the parties' own - the same fills `PartyChip`, the graph and
 * the treemap use - rather than the validated categorical palette in
 * `chartTheme.ts`, because here the colour *is* the identity: a reader who
 * knows PiS is navy from every other page of the site would have to learn a
 * second mapping for this one chart. The palette validator marks the party
 * fills FAIL on the normal-vision floor (PO's orange against Polska 2050's
 * yellow, ΔE 10.9) and WARN on contrast (PSL's mint and that yellow are both
 * under 3:1 on white), so identity is carried by three further channels and
 * never by colour alone: the legend, a shared tooltip that names every party at
 * the hovered month, and the table view of the same numbers.
 *
 * Lines, not a stack. Somebody filed under two parties is counted on both -
 * 201 of the 2,158 people with a party are - so the lines do not add up to a
 * headcount, and a stacked area would assert that they do.
 */
/** The ranges the toggle offers. `years` is the window; null is the whole
 * series, spelled that way rather than as a 0 that would read as "no years". */
const rangeOptions = [
  { value: "5", label: "5 lat", years: 5 },
  { value: "10", label: "10 lat", years: 10 },
  { value: "all", label: "Wszystko", years: null },
] as const;

type RangeValue = (typeof rangeOptions)[number]["value"];

/** The whole series by default, which is the only range that carries the story.
 *
 * Ten years was the first choice and it was wrong: measured against today it
 * opens in late 2016, by which time PiS had already passed PO, so the chart
 * began mid-crossing and the reader saw a fall in 2024 with nothing to read it
 * against. From 2001 both turns are on screen - PO through 2008, PiS passing it
 * in 2016 - and the thin first five years cost a fifth of the width.
 *
 * The shorter ranges stay, for reading the last term closely. */
const range = ref<RangeValue>("all");

const ENDPOINT = "/api/stats/partyTimeline";

/** Named rather than keyed on the url: `useFetch` aborts an earlier call that
 * lands on the same key, which would tie this section to any other caller
 * asking for the same thing. */
const { data, status } = authFetch<PartyTimelineResponse>(ENDPOINT, {
  key: "home-party-timeline",
});

const hasData = computed(() => (data.value?.series.length ?? 0) > 0);

const subtitle = computed(() => {
  const posts = data.value?.posts;
  const people = data.value?.people;
  if (!posts || !people) return "";
  // Three sentences and no more: on a phone this heading sits above the whole
  // feed, and the version that spelled out why the recent months are provisional
  // took eight lines before the chart started.
  return (
    `Ile osób z każdej partii zajmowało w danym miesiącu stanowisko opisane ` +
    `na koryta.pl - ${formatCount(people)} osób i ${formatCount(posts)} ` +
    `stanowisk. Im dawniej, tym mniej wiemy: to stan naszej bazy, a nie pełny ` +
    `rejestr. Ostatnie miesiące bywają niepełne.`
  );
});

/** The months the picked range covers, as indexes into the response's arrays.
 * Sliced here once rather than per series. */
const visible = computed(() => {
  const months = data.value?.months ?? [];
  const years = rangeOptions.find((o) => o.value === range.value)?.years;
  if (!years || months.length <= years * 12) {
    return { from: 0, months };
  }
  const from = months.length - years * 12;
  return { from, months: months.slice(from) };
});

/** A `YYYY-MM` as the UTC instant its first day began.
 *
 * The axis is a datetime one rather than a category one: 300 category labels
 * are drawn at equal spacing whatever they say, so a reader counting years off
 * them counts wrong. Apex spaces a datetime axis by the actual interval and
 * picks its own year ticks. */
function monthStart(month: string): number {
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

const series = computed(() =>
  (data.value?.series ?? []).map((line) => ({
    name: partyMergedLabels[line.party] ?? line.party,
    data: visible.value.months.map((month, index) => ({
      x: monthStart(month),
      y: line.counts[visible.value.from + index] ?? 0,
    })),
  })),
);

/** One colour per line, in series order. The endpoint only ever returns a party
 * that has a fill here, so the fallback is unreachable - it is there so that a
 * party added to `parties` without a colour draws grey rather than silently
 * taking the previous line's hue, which is what apexcharts does with a short
 * `colors` array. */
const colors = computed(() =>
  (data.value?.series ?? []).map(
    (line) => partyColors[line.party] ?? ink.muted,
  ),
);

const options = computed(() => ({
  ...baseChartOptions(),
  colors: colors.value,
  chart: {
    ...baseChartOptions().chart,
    type: "line" as const,
    // The reader's question is „ilu ich było w 2019”, which is answered by
    // hovering a month, so the crosshair has to find the nearest one rather
    // than wait for the pointer to land on a 2px line.
    zoom: { enabled: false },
  },
  // Straight, not smooth: the value is a count in a month, and a spline drawn
  // through monthly counts invents the months in between.
  stroke: { curve: "straight" as const, width: 2 },
  markers: { size: 0, hover: { size: 5 } },
  xaxis: {
    ...baseChartOptions().xaxis,
    type: "datetime" as const,
    // Both ends spelled out rather than left to the data. Apexcharts works a
    // datetime axis' range out once and keeps it across an `updateSeries`, so
    // narrowing the range from „Wszystko” to „5 lat” redrew the lines against
    // the old years: five years of data spread over a 2016-2026 axis, every
    // label off by a decade and the chart silently lying about when the fall
    // happened. Passing the range makes each update carry its own axis.
    min: visible.value.months.length
      ? monthStart(visible.value.months[0]!)
      : undefined,
    max: visible.value.months.length
      ? monthStart(visible.value.months[visible.value.months.length - 1]!)
      : undefined,
    crosshairs: { show: true, stroke: { color: ink.axis, width: 1 } },
    tooltip: { enabled: false },
    labels: {
      ...baseChartOptions().xaxis.labels,
      datetimeUTC: true,
      // Per granularity rather than one `format: "yyyy"` for every range. Apex
      // picks about ten ticks whatever the span, so a forced year format wrote
      // „2022 2022 2023 2023 …” across the five year view - two ticks inside a
      // year, both labelled with it, and a reader counting the gaps counting
      // twice as many years as there are. Given the three it picks the one
      // that fits the ticks it drew.
      datetimeFormatter: {
        year: "yyyy",
        month: "MMM 'yy",
        day: "d MMM",
      },
    },
  },
  yaxis: {
    ...baseChartOptions().yaxis,
    min: 0,
    forceNiceScale: true,
    labels: {
      ...baseChartOptions().yaxis.labels,
      formatter: (value: number) => formatCount(Math.round(value)),
    },
  },
  tooltip: {
    ...baseChartOptions().tooltip,
    shared: true,
    intersect: false,
    x: { format: "MMMM yyyy" },
  },
}));

/** The table is relief for a palette the validator warns about, so it has to be
 * readable rather than complete: one row a year - the last month of it inside
 * the range - instead of the 120 to 300 the chart draws. The final row is the
 * newest month, which is the one number a reader is most likely to have come
 * for and is only a December by coincidence. */
const tableRows = computed(() => {
  const months = visible.value.months;
  const keep: number[] = [];
  months.forEach((month, index) => {
    const next = months[index + 1];
    if (!next || next.slice(0, 4) !== month.slice(0, 4)) keep.push(index);
  });

  return keep.map((index) => {
    const month = months[index]!;
    const last = index === months.length - 1;
    return {
      month,
      label: last
        ? new Intl.DateTimeFormat("pl-PL", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(monthStart(month)))
        : month.slice(0, 4),
      counts: (data.value?.series ?? []).map(
        (line) => line.counts[visible.value.from + index] ?? 0,
      ),
    };
  });
});
</script>

<style scoped>
/* Tabular figures, so a column of counts lines up on its digits. Repeated per
   component rather than shared, which is what every chart card under
   `components/stats/` does with the same class. */
.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
