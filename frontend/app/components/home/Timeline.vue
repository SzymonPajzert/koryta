<template>
  <StatsChartCard
    v-if="hasData"
    data-testid="home-timeline"
    :title="title"
    :subtitle="subtitle"
    :loading="status === 'pending'"
    hide-view-toggle-on-mobile
  >
    <template #chart>
      <ClientOnly>
        <apexchart
          type="line"
          height="340"
          :options="options"
          :series="series"
          data-testid="home-timeline-chart"
        />
        <template #fallback>
          <!-- Same height as the chart, so the panel does not resize under the
               reader the moment apexcharts mounts. -->
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
              class="text-right timeline-numeric"
            >
              {{ count }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>

  <v-alert
    v-else-if="status !== 'pending'"
    data-testid="home-timeline-empty"
    text="Nie mamy jeszcze dość dat, żeby narysować ten wykres."
    type="info"
    variant="tonal"
  />
  <v-skeleton-loader v-else type="image" height="340" />
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { authFetch } from "~/composables/auth";
import { partyColors } from "~~/shared/misc";
import { OTHER_KEY } from "~~/shared/homeTimeline";
import {
  baseChartOptions,
  categorical,
  formatCount,
  ink,
} from "~/utils/chartTheme";
import {
  timelineGroupingOptions,
  timelineRangeYears,
  type TimelineRange,
} from "~/composables/homeTimeline";
import type {
  HomeTimelineResponse,
  TimelineGrouping,
} from "~~/server/api/stats/homeTimeline.get";

/** How many people held a post in each month, one line per group.
 *
 * Under „Partie” the colours are the parties' own - the same fills `PartyChip`,
 * the graph and the treemap use - rather than the validated categorical palette
 * in `chartTheme.ts`, because there the colour *is* the identity: a reader who
 * knows PiS is navy from every other page of the site should not have to learn
 * a second mapping for one chart. That palette does not pass the validator - PO's
 * orange against Polska 2050's yellow is ΔE 10.9 to a reader with full colour
 * vision, and PSL's mint and that yellow are both under 3:1 on white - so
 * identity is carried by three further channels and never by colour alone: the
 * legend, a shared tooltip naming every group at the hovered month, and the
 * table view of the same numbers.
 *
 * A województwo and a sector have no colours of their own, so those two use the
 * validated palette in its fixed order.
 *
 * Lines, not a stack, under every grouping. Somebody filed under two parties is
 * counted on both, and so is somebody whose two employers sit in different
 * województwa - the lines do not add up to a headcount, and a stacked area
 * would assert that they do.
 */
const props = defineProps<{
  grouping: TimelineGrouping;
  range: TimelineRange;
}>();

const ENDPOINT = "/api/stats/homeTimeline";

/** Named rather than keyed on the url: `useFetch` aborts an earlier call that
 * lands on the same key, which would tie this panel to any other caller asking
 * for the same thing.
 *
 * One request for all three groupings. They are three views of one scan, the
 * whole payload is 26 kB, and a request per grouping would make a click on the
 * picker wait on the edge collection. */
const { data, status } = authFetch<HomeTimelineResponse>(ENDPOINT, {
  key: "home-timeline",
});

const lines = computed(() => data.value?.groupings?.[props.grouping] ?? []);
const hasData = computed(() => lines.value.length > 0);

/** The card says which cut is on screen, not what the panel is - „Stanowiska w
 * czasie” is already the heading above it, and a card titled „Kto trzyma
 * stanowiska” under it said the same thing twice. Naming the grouping here puts
 * it beside the chart as well as in the picker, which is in the other column. */
const title = computed(
  () =>
    timelineGroupingOptions.find((option) => option.value === props.grouping)
      ?.label ?? "Stanowiska",
);

/** One sentence on what is being counted, then what it is counted from.
 *
 * The coverage is per grouping and the three genuinely differ - a seat places
 * nearly every post, a sector places 42% of them - so it is read off the
 * response rather than stated once. A reader comparing „Branże” against
 * „Partie” and finding half the people missing is owed the reason on the chart
 * rather than in a footnote nobody reaches. */
const subtitle = computed(() => {
  const coverage = data.value?.coverage?.[props.grouping];
  const posts = data.value?.posts;
  if (!coverage || !posts) return "";

  const what = {
    party: "Ile osób z każdej partii było w danym miesiącu na stanowisku",
    region:
      "Ile osób było w danym miesiącu na stanowisku w instytucji z danego województwa",
    category:
      "Ile osób było w danym miesiącu na stanowisku w instytucji z danej branży",
  }[props.grouping];

  // „2 998 z 3 091” rather than a sentence apologising for the difference: the
  // ratio is the whole of the message, it is shorter, and this line is seven
  // lines deep on a phone before the chart starts.
  const counted =
    coverage.posts === posts
      ? `${formatCount(coverage.posts)} stanowisk`
      : `${formatCount(coverage.posts)} z ${formatCount(posts)} stanowisk`;

  return `${what} - ${formatCount(coverage.people)} osób i ${counted} opisanych na koryta.pl. To stan naszej bazy, a nie pełny rejestr; dołącz do projektu by pomóc nam ją uzupełnić.`;
});

/** The months the picked range covers, as indexes into the response's arrays.
 * Sliced here once rather than per series. */
const visible = computed(() => {
  const months = data.value?.months ?? [];
  const years = timelineRangeYears(props.range);
  if (!years || months.length <= years * 12) return { from: 0, months };
  const from = months.length - years * 12;
  return { from, months: months.slice(from) };
});

/** A `YYYY-MM` as the UTC instant its first day began.
 *
 * The axis is a datetime one rather than a category one: 300 category labels
 * are drawn at equal spacing whatever they say, so a reader counting years off
 * them counts wrong. Apex spaces a datetime axis by the actual interval. */
function monthStart(month: string): number {
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

const series = computed(() =>
  lines.value.map((line) => ({
    name: line.label,
    data: visible.value.months.map((month, index) => ({
      x: monthStart(month),
      y: line.counts[visible.value.from + index] ?? 0,
    })),
  })),
);

/** One colour per line, in series order.
 *
 * The folded remainder is grey under every grouping: „pozostałe” is not an
 * entity and must not look like one, and a hue for it would be a hue taken from
 * a group that is. */
const colors = computed(() =>
  lines.value.map((line, index) => {
    if (line.key === OTHER_KEY) return ink.muted;
    if (props.grouping === "party") {
      // Unreachable: the endpoint only returns a party that has a fill. It is
      // here so that a party added to `parties` without a colour draws grey
      // rather than silently taking the previous line's hue, which is what
      // apexcharts does with a short `colors` array.
      return partyColors[line.key] ?? ink.muted;
    }
    // Fixed order, never cycled - the order is the colourblind-safety
    // mechanism. The server caps the line count at the palette's length.
    return categorical[index % categorical.length];
  }),
);

const options = computed(() => ({
  ...baseChartOptions(),
  colors: colors.value,
  chart: {
    ...baseChartOptions().chart,
    type: "line" as const,
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
    // narrowing from „Wszystko” to „5 lat” redrew the lines against the old
    // years: five years of data spread over a 2016-2026 axis, every label off
    // by a decade and the chart silently lying about when the fall happened.
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
      // twice as many years as there are.
      datetimeFormatter: { year: "yyyy", month: "MMM 'yy", day: "d MMM" },
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
      counts: lines.value.map(
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
.timeline-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
