<template>
  <StatsChartCard
    :title="title"
    :subtitle="subtitle"
    :loading="loading"
    hide-view-toggle-on-mobile
  >
    <template #chart>
      <div
        v-if="rows.length === 0"
        class="text-body-2 text-medium-emphasis py-8 text-center"
      >
        {{ emptyText }}
      </div>

      <div
        v-else
        class="breakdown"
        :class="{ 'breakdown--wide-labels': dimension === 'hospital' }"
        :style="paletteVars"
      >
        <div class="d-flex align-center flex-wrap ga-2 mb-3">
          <span class="text-caption text-medium-emphasis">Podziel według</span>
          <v-btn-toggle
            class="breakdown__dimensions"
            :model-value="dimension"
            density="compact"
            variant="outlined"
            divided
            mandatory
            @update:model-value="onDimension"
          >
            <v-btn
              v-for="(label, key) in breakdownLabels"
              :key="key"
              :value="key"
              size="small"
            >
              {{ label }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <!-- Two of everything the narrow scale changes, chosen by a media
             query rather than by a breakpoint composable: `useDisplay()` would
             have the server render one and the browser swap to the other, which
             is a hydration mismatch on every bar and every number below. -->
        <p class="text-caption text-medium-emphasis mb-1 breakdown__wide-only">
          {{ scaleNote }}
        </p>
        <p
          class="text-caption text-medium-emphasis mb-1 breakdown__narrow-only"
        >
          {{ narrowScaleNote }}
        </p>

        <div class="breakdown__row breakdown__row--head">
          <div class="breakdown__label breakdown__caption">
            {{ dimensionLabel }}
          </div>
          <div class="breakdown__axis">
            <span
              v-for="tick in ticks"
              :key="`wide-${tick.at}`"
              class="breakdown__tick breakdown__wide-only"
              :class="{ 'breakdown__tick--first': tick.at === 0 }"
              :style="{ left: `${tick.at}%` }"
            >
              {{ formatCount(tick.value) }}
            </span>
            <span
              v-for="tick in narrowTicks"
              :key="`narrow-${tick.at}`"
              class="breakdown__tick breakdown__narrow-only"
              :class="{ 'breakdown__tick--first': tick.at === 0 }"
              :style="{ left: `${tick.at}%` }"
            >
              {{ formatCount(tick.value) }}
            </span>
          </div>
          <div class="breakdown__caption text-right">znalezione</div>
          <div class="breakdown__caption text-right breakdown__editorial">
            do sprawdzenia
          </div>
          <div class="breakdown__caption breakdown__editorial">
            kolejka pracy
          </div>
        </div>

        <div
          v-for="row in shown"
          :key="row.key"
          class="breakdown__row"
          :class="{ 'breakdown__row--zero': row.seats === 0 }"
        >
          <div class="breakdown__label" :title="row.label">
            <span class="breakdown__name">
              <NuxtLink v-if="row.href" :to="row.href" class="breakdown__link">
                {{ row.label }}
              </NuxtLink>
              <template v-else>{{ row.label }}</template>
            </span>
            <span v-if="row.meta" class="breakdown__meta">{{ row.meta }}</span>
          </div>

          <!-- Width is the quantity; only HEIGHT is amplified. The reviewed
               head is full height and the backlog is a low stripe, so a
               two-seat head stays findable without being drawn as more than
               two seats. In "zoom" the head gets its own scale up to the seam,
               which is labelled with the factor - the one thing that makes a
               broken axis readable rather than a lie. -->
          <div class="breakdown__lane">
            <div
              v-for="(seg, i) in row.segments"
              :key="`${row.key}-${seg.party}-${i}`"
              class="breakdown__seg"
              :style="segmentStyle(row, i)"
              :title="`${seg.label}: ${formatCount(seg.seats)} — sprawdzone i opublikowane`"
            />
            <div
              v-if="trackStyle(row)"
              class="breakdown__track"
              :style="trackStyle(row)!"
              :title="`${row.unreviewed} osób z rejestru, nikt ich jeszcze nie sprawdził`"
            />
          </div>

          <div class="breakdown__num breakdown__num--strong">
            {{ formatCount(row.seats) }}
          </div>
          <div class="breakdown__num breakdown__editorial">
            {{ row.unreviewed === null ? "—" : formatCount(row.unreviewed) }}
          </div>

          <div class="breakdown__editorial">
            <!-- Never a disabled control. A greyed-out button fails contrast
                 and tells a logged-out reader only that they cannot have it;
                 this is a live link that takes them to the thing they need to
                 do first, and brings them back here afterwards. -->
            <v-btn
              v-if="row.to"
              :to="canSeeDrafts ? row.to : loginHref"
              :color="ctaColor(row)"
              :prepend-icon="canSeeDrafts ? undefined : mdiLoginVariant"
              variant="tonal"
              size="small"
              class="breakdown__cta"
            >
              {{ canSeeDrafts ? "Zobacz osoby" : "Zaloguj się" }}
              <v-tooltip activator="parent" location="top">
                {{ ctaTooltip(row) }}
              </v-tooltip>
            </v-btn>
          </div>
        </div>

        <div v-if="hidden > 0" class="mt-2">
          <v-btn variant="text" size="small" @click="showAll = !showAll">
            {{
              showAll
                ? "Pokaż tylko pierwsze " + PAGE
                : `Pokaż pozostałe ${hidden}`
            }}
          </v-btn>
        </div>

        <div class="breakdown__legend">
          <span v-for="party in legend" :key="party.party">
            <i
              class="breakdown__swatch breakdown__swatch--head"
              :style="{ backgroundColor: party.color }"
            />
            {{ party.label }}
          </span>
          <template v-if="hasBacklog">
            <span class="breakdown__legend-sep breakdown__wide-only">|</span>
            <span class="breakdown__wide-only">
              <i class="breakdown__swatch breakdown__swatch--track" />
              osoby z rejestru, jeszcze niesprawdzone — sama liczba
            </span>
          </template>
        </div>

        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          <strong>
            Kolor pojawia się wyłącznie tam, gdzie redakcja sprawdziła i
            opublikowała miejsce.
          </strong>
          <span class="breakdown__wide-only">{{ backlogNote }}</span>
          <span class="breakdown__narrow-only">{{ narrowBacklogNote }}</span>
        </p>
        <p
          v-if="minWidthCost"
          class="text-caption text-medium-emphasis mb-0 breakdown__wide-only"
        >
          {{ minWidthCost }}
        </p>
        <p
          v-if="narrowMinWidthCost"
          class="text-caption text-medium-emphasis mb-0 breakdown__narrow-only"
        >
          {{ narrowMinWidthCost }}
        </p>
      </div>
    </template>

    <template #table>
      <div class="breakdown__scroll">
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left">{{ dimensionLabel }}</th>
              <th class="text-right">Znalezione</th>
              <th class="text-right">Do sprawdzenia</th>
              <th class="text-right">Razem z KRS</th>
              <th class="text-right">Udział znal.</th>
              <th v-for="party in legend" :key="party.party" class="text-right">
                {{ party.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sorted" :key="row.key">
              <td>{{ row.label }}</td>
              <td class="text-right stats-numeric">
                {{ formatCount(row.seats) }}
              </td>
              <td class="text-right stats-numeric">
                {{
                  row.unreviewed === null ? "—" : formatCount(row.unreviewed)
                }}
              </td>
              <td class="text-right stats-numeric">
                {{ formatCount(row.total) }}
              </td>
              <td class="text-right stats-numeric">
                {{ row.share === null ? "—" : formatShare(row.share) }}
              </td>
              <td
                v-for="party in legend"
                :key="party.party"
                class="text-right stats-numeric"
              >
                {{ seatsOf(row, party.party) || "—" }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <p class="text-caption text-medium-emphasis mt-2 mb-0">
        Tabela jest właściwym sposobem odczytania partii: PiS i Konfederacja
        mają w palecie prawie ten sam granat, a SLD i Nowa Lewica ten sam
        czerwony. Kolumny partii dotyczą wyłącznie miejsc sprawdzonych.
      </p>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { mdiLoginVariant } from "@mdi/js";
import {
  breakdownLabels,
  type Breakdown,
  type BreakdownRow,
} from "~/composables/stats/useHospitalBoards";
import { formatCount, ink, status } from "~/utils/chartTheme";
import { hexToRgb } from "~~/shared/colors";
import { polishCounting } from "~/composables/polish";

/** The one chart on /eksploruj/szpitale, however it is split.
 *
 * WHY ONE CHART. The page used to carry three - seats by party, then the same
 * seats by województwo, then a table of the same seats by hospital - stacked,
 * each on its own scale, with nothing saying they were three readings of one
 * 591-seat set. This is that set, and the only control is which way to read it:
 *
 *   Partia      one row per party. That is all - see `unreviewed: null` below.
 *   Województwo one row per region, split by party, with the rest greyed out.
 *   Szpital     the same, one row per hospital.
 *
 * ONE SHARED, UNRESCALED SCALE. Every row is measured against the same axis, so
 * the reviewed head really is the small fraction of the register an editor has
 * been through. Drawing that honestly makes the head tiny, and giving it its own
 * scale is the thing a chart like this must not do quietly - so the
 * amplification goes into HEIGHT, which carries no data here: a full-height head
 * against a low backlog stripe. The only width correction is a 5px floor on a
 * non-empty segment, repaid out of that row's own backlog so the row keeps its
 * true length, and `minWidthCost` prints what it came to.
 *
 * WHAT IS AND IS NOT BROKEN DOWN. The head is split by party. The tail never is:
 * it is a count of people the register seats on these boards whom nobody has
 * reviewed, and the party stored against them is an unapproved name match. A
 * party row therefore has `unreviewed: null` and no tail at all - we do not know
 * which party those people belong to and will not guess.
 */
const props = defineProps<{
  title: string;
  subtitle?: string;
  rows: BreakdownRow[];
  dimension: Breakdown;
  loading?: boolean;
  emptyText: string;
  /** Whether the reader may see draft people. The work queue needs
   * `visibility=private`, which /api/nodes refuses to anyone else. */
  canSeeDrafts?: boolean;
}>();

const emit = defineEmits<{ "update:dimension": [Breakdown] }>();

/** `v-btn-toggle` hands back whatever `value` the pressed button carried, typed
 * as `unknown`. Narrowing here rather than casting keeps a future fourth split
 * from silently emitting a string the parent cannot handle. */
function onDimension(value: unknown) {
  if (value === "party" || value === "region" || value === "hospital") {
    emit("update:dimension", value);
  }
}

const route = useRoute();
/** Where a logged-out reader is sent instead of the work queue, and back from.
 *
 * The `redirect` query param is how the rest of the site returns somebody to
 * where they were - see `app/pages/login.vue`, which reads it - and this page is
 * exactly the kind you do not want to have to find again. */
const loginHref = computed(
  () => `/login?redirect=${encodeURIComponent(route.fullPath)}`,
);

const showAll = ref(false);

/** How many rows before the chart offers to stop. The hospital split runs past
 * 140 rows, which is a 4,000px chart. What is held back is always counted in
 * the button, because a silent cap reads as "that is all there is". */
const PAGE = 25;
const MIN_SEGMENT_PX = 5;
const ASSUMED_LANE_PX = 620;

const dimensionLabel = computed(
  () =>
    ({ party: "Partia", region: "Województwo", hospital: "Szpital" })[
      props.dimension
    ],
);

/** True when this split has a backlog to draw - false only for parties. */
const hasBacklog = computed(() =>
  props.rows.some((row) => row.unreviewed !== null),
);

watch(
  () => props.dimension,
  () => {
    showAll.value = false;
  },
);

/** Most reviewed seats first, always. There is no sort control: the question
 * the page asks is who holds the seats we have actually checked, so that is the
 * order, and a second control would compete with the only one that matters. */
const sorted = computed(() =>
  [...props.rows].sort(
    (a, b) =>
      b.seats - a.seats ||
      b.total - a.total ||
      a.label.localeCompare(b.label, "pl"),
  ),
);

const shown = computed(() =>
  showAll.value ? sorted.value : sorted.value.slice(0, PAGE),
);
const hidden = computed(() => Math.max(sorted.value.length - PAGE, 0));

/** The axis this chart is drawn against, and the one a phone is drawn against.
 *
 * TWO SCALES, ONE OF WHICH IS NOT A RESCALE OF ROWS. `axisMax` runs to the
 * longest row's `total`, which is what makes the coloured head the honest small
 * fraction of the register it is. A phone does not draw the backlog at all -
 * the tail and the "do sprawdzenia" column are the editors' half of this chart
 * and there is no room for them - and against a scale sized for a tail that is
 * not there, every bar would sit in a lane that is mostly unexplained blank.
 * So the narrow layout measures against the longest row's *found* seats.
 *
 * Every row still shares one scale and none is scaled against itself, which is
 * the property that lets the rows be compared. What the narrow scale gives up
 * is the comparison against the register - and that comparison is exactly what
 * a phone is no longer showing.
 */
const axisMax = computed(() =>
  Math.max(1, ...props.rows.map((row) => row.total)),
);
const narrowAxisMax = computed(() =>
  Math.max(1, ...props.rows.map((row) => row.seats)),
);

function tickStepFor(max: number): number {
  const raw = max / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow;
}

function ticksFor(max: number) {
  const step = tickStepFor(max);
  const out: { value: number; at: number }[] = [];
  for (let v = 0; v <= max; v += step) {
    out.push({ value: v, at: (v / max) * 100 });
  }
  return out;
}

const ticks = computed(() => ticksFor(axisMax.value));
const narrowTicks = computed(() => ticksFor(narrowAxisMax.value));

const scaleNote = computed(
  () =>
    `Skala wspólna dla wszystkich wierszy: od 0 do ${formatCount(axisMax.value)} ${
      hasBacklog.value ? "miejsc znanych z KRS" : "sprawdzonych miejsc"
    }, podziałka co ${formatCount(tickStepFor(axisMax.value))}. Żaden wiersz nie jest przeskalowany osobno.`,
);

/** Said instead of the above on a phone, and it has to say what changed: the
 * scale is a different one, and the reason is that the thing the wider scale
 * measured against is not drawn here. */
const narrowScaleNote = computed(
  () =>
    `Skala wspólna dla wszystkich wierszy: od 0 do ${formatCount(narrowAxisMax.value)} sprawdzonych miejsc, podziałka co ${formatCount(tickStepFor(narrowAxisMax.value))}. Żaden wiersz nie jest przeskalowany osobno.${
      hasBacklog.value
        ? " Na wąskim ekranie nie rysujemy zaległości z rejestru, więc i skala kończy się na tym, co sprawdzone."
        : ""
    }`,
);

const backlogNote = computed(() =>
  hasBacklog.value
    ? "Szary ogon wiersza jest tylko liczbą osób z rejestru — nie ma w nim partii, nazwisk ani żadnego podziału."
    : "Podział na partie nie ma szarego ogona: nie wiemy, do jakiej partii należą niesprawdzone osoby, i nie zgadujemy. Zaległość widać w podziale na województwo albo szpital.",
);

const narrowBacklogNote = computed(() =>
  hasBacklog.value
    ? "Zaległości — osób z rejestru, których nikt jeszcze nie sprawdził — na wąskim ekranie nie pokazujemy; są w tym samym wykresie na szerszym."
    : backlogNote.value,
);

const attributions = (row: BreakdownRow) =>
  row.segments.reduce((sum, seg) => sum + seg.seats, 0);

/** Percent of the lane one seat occupies, on a given scale. */
const headUnit = (max: number) => 100 / max;

const minPct = () => (MIN_SEGMENT_PX / ASSUMED_LANE_PX) * 100;

function segmentWidth(row: BreakdownRow, index: number, max: number): number {
  const total = attributions(row);
  // A published person with two parties is counted under both, so the segments
  // can sum past the seat count. Scaling them to `seats` makes the double count
  // change the split inside the head rather than how long the head is.
  const scaleTo = total === 0 ? 0 : row.seats / total;
  return Math.max(
    row.segments[index]!.seats * scaleTo * headUnit(max),
    minPct(),
  );
}

function segmentLeft(row: BreakdownRow, index: number, max: number): number {
  let left = 0;
  for (let i = 0; i < index; i += 1) left += segmentWidth(row, i, max);
  return left;
}

/** Both geometries at once, as custom properties the stylesheet picks between.
 *
 * The alternative was a `useDisplay()` breakpoint, which the server renders at
 * its own assumed width and the browser then corrects - a hydration mismatch on
 * every bar and every line of the note above them. A media query choosing
 * between two variables the server and the browser both emit identically has
 * neither problem. */
function segmentStyle(row: BreakdownRow, index: number) {
  return {
    "--seg-left": `${segmentLeft(row, index, axisMax.value)}%`,
    "--seg-width": `${segmentWidth(row, index, axisMax.value)}%`,
    "--seg-left-narrow": `${segmentLeft(row, index, narrowAxisMax.value)}%`,
    "--seg-width-narrow": `${segmentWidth(row, index, narrowAxisMax.value)}%`,
    backgroundColor: row.segments[index]!.color,
  };
}

function paintedHeadPct(row: BreakdownRow): number {
  return row.segments.reduce(
    (sum, _seg, i) => sum + segmentWidth(row, i, axisMax.value),
    0,
  );
}

/** The backlog stripe, or null where there is none.
 *
 * It starts at the head's PAINTED end, so a segment widened by the minimum
 * width shortens the tail rather than being painted over by it, and the row's
 * total length stays true. Only ever the wide geometry: below `sm` the stylesheet
 * does not draw this at all. */
function trackStyle(row: BreakdownRow) {
  if (!row.unreviewed) return null;
  const left = paintedHeadPct(row);
  const end = (row.total / axisMax.value) * 100;
  const width = Math.max(end - left, 0);
  if (width === 0) return null;
  return { left: `${left}%`, width: `${width}%` };
}

/** What the 5px floor cost, on one scale.
 *
 * Reported per scale rather than once, because it is a count of seats and the
 * narrow scale converts a percentage into a different number of them. Printing
 * the wide figure under the narrow chart would be quoting a correction that
 * chart did not make. */
function minWidthCostOn(max: number): string {
  let widened = 0;
  let seats = 0;
  for (const row of props.rows) {
    const total = attributions(row);
    const scaleTo = total === 0 ? 0 : row.seats / total;
    for (const seg of row.segments) {
      const truePct = seg.seats * scaleTo * headUnit(max);
      if (truePct >= minPct()) continue;
      widened += 1;
      seats += ((minPct() - truePct) / 100) * max;
    }
  }
  if (widened === 0) return "";
  return `Korekta minimalnej szerokości (${MIN_SEGMENT_PX} px na segment, pokryta z szarego ogona tego samego wiersza, więc długość żadnego wiersza się nie zmienia): ${polishCounting(widened, "segment", "segmenty", "segmentów")}, razem +${seats.toFixed(1)} miejsca z ${formatCount(max)}.`;
}

const minWidthCost = computed(() => minWidthCostOn(axisMax.value));
const narrowMinWidthCost = computed(() => minWidthCostOn(narrowAxisMax.value));

const legend = computed(() => {
  const seen = new Map<
    string,
    { party: string; label: string; color: string }
  >();
  for (const row of props.rows) {
    for (const seg of row.segments) {
      if (!seen.has(seg.party)) {
        seen.set(seg.party, {
          party: seg.party,
          label: seg.label,
          color: seg.color,
        });
      }
    }
  }
  return [...seen.values()];
});

const seatsOf = (row: BreakdownRow, party: string) =>
  row.segments.find((seg) => seg.party === party)?.seats ?? 0;

/** The queue button's colour.
 *
 * Never `primary`: the brand sage is #a8c79f, which as a tonal button paints
 * sage text on a pale sage wash at 1.85:1. `shared/colors.ts` exists for this -
 * every `ink-*` clears 4.5:1 on every surface in the set. Amber marks a region
 * nobody has started, blue is the ordinary case, and both are readable.
 */
const ctaColor = (row: BreakdownRow) =>
  row.seats === 0 ? "ink-warning" : "ink-info";

function ctaTooltip(row: BreakdownRow): string {
  if (!props.canSeeDrafts) {
    return `Nieopublikowane wpisy widzi tylko redakcja. Zaloguj się — wrócimy na tę stronę i pokażemy ${polishCounting(row.unreviewed ?? 0, "osobę", "osoby", "osób")} do sprawdzenia.`;
  }
  return `${row.label}: ${polishCounting(row.unreviewed ?? 0, "osoba", "osoby", "osób")} z rejestru czeka na sprawdzenie, od najnowszych wpisów.`;
}

function formatShare(share: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  }).format(share);
}

const paletteVars = computed(() => ({
  "--bd-primary": ink.primary,
  "--bd-secondary": ink.secondary,
  "--bd-muted": ink.muted,
  "--bd-grid": ink.grid,
  "--bd-axis": ink.axis,
  "--bd-track": ink.track,
  "--bd-surface": ink.surface,
  // The warning hue at 6%: a row of zeroes is flagged, not alarmed about.
  "--bd-zero-wash": `rgba(${hexToRgb(status.warning).join(", ")}, 0.06)`,
}));
</script>

<style scoped>
.breakdown__row {
  display: grid;
  grid-template-columns:
    var(--bd-label, 190px) minmax(80px, 1fr)
    74px 96px 132px;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant), 0.35);
}

/* The by-hospital split only. A board holds eight or nine people, so its axis
   never runs past single digits and the lane needs almost none of the width -
   while the names are the longest labels in the app ("WIELOSPECJALISTYCZNY
   SZPITAL WOJEWÓDZKI W GORZOWIE WLKP."). The other two splits keep the narrow
   column: a województwo name is one short word and the bars are what carry
   the meaning there. */
.breakdown--wide-labels {
  --bd-label: 380px;
}

.breakdown--wide-labels .breakdown__name {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.breakdown__row--head {
  border-bottom: 1px solid var(--bd-grid);
  align-items: end;
  padding-bottom: 2px;
}

.breakdown__row--zero {
  background: var(--bd-zero-wash);
}

.breakdown__label {
  font-size: 0.8125rem;
  color: var(--bd-secondary);
  text-align: right;
  overflow: hidden;
}

/* One line, or a hospital called "WIELOSPECJALISTYCZNY SZPITAL WOJEWÓDZKI W
   GORZOWIE WLKP." makes its row four times the height of its neighbours. The
   full name stays reachable through the row's title and the link it wraps. */
.breakdown__name {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breakdown__link {
  color: inherit;
}

.breakdown__meta {
  display: block;
  font-size: 0.6875rem;
  color: var(--bd-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breakdown__caption {
  font-size: 0.6875rem;
  color: var(--bd-muted);
  line-height: 1.15;
}

.breakdown__axis {
  position: relative;
  height: 16px;
  box-shadow: -1px 0 0 var(--bd-axis);
}

.breakdown__tick {
  position: absolute;
  bottom: 0;
  font-size: 0.6875rem;
  color: var(--bd-muted);
  font-variant-numeric: tabular-nums;
  transform: translateX(-50%);
  white-space: nowrap;
}

.breakdown__tick--first {
  transform: none;
}

.breakdown__seam-label {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--bd-primary);
  background: var(--bd-surface);
  padding: 0 3px;
}

.breakdown__lane {
  position: relative;
  height: 24px;
  box-shadow: -1px 0 0 var(--bd-axis);
}

.breakdown__seg {
  position: absolute;
  top: 2px;
  height: 20px;
  left: var(--seg-left);
  width: var(--seg-width);
}

.breakdown__track {
  position: absolute;
  top: 8px;
  height: 8px;
  background: var(--bd-track);
  border-radius: 0 4px 4px 0;
}

/* The break in the axis, drawn rather than implied. */
.breakdown__seam {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed var(--bd-axis);
}

.breakdown__num {
  font-size: 0.8125rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--bd-secondary);
}

.breakdown__num--strong {
  color: var(--bd-primary);
  font-weight: 600;
}

.breakdown__row--zero .breakdown__num--strong {
  color: var(--bd-muted);
  font-weight: 400;
}

.breakdown__cta {
  text-transform: none;
  letter-spacing: normal;
}

.breakdown__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px 16px;
  margin-top: 12px;
  font-size: 0.75rem;
  color: var(--bd-secondary);
}

.breakdown__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.breakdown__legend-sep {
  color: var(--bd-axis);
}

.breakdown__swatch {
  display: inline-block;
  border-radius: 2px;
  flex: none;
}

.breakdown__swatch--head {
  width: 9px;
  height: 16px;
}

.breakdown__swatch--track {
  width: 34px;
  height: 6px;
  background: var(--bd-track);
}

.breakdown__scroll {
  overflow-x: auto;
}

/* The two-variant switch. Neither class ever SETS a display value in the
   breakpoint where its element is showing, so every element keeps whatever
   display it would otherwise have had - `.breakdown__legend span` is an
   inline-flex, the notes are blocks, and a shared `display: block` would break
   both.

   Qualified by `.breakdown` for weight, not for scope: `.breakdown__legend
   span` is (0,1,1) and beat a bare (0,1,0) class, so the legend kept its grey
   swatch on a phone after the tail it belongs to had gone. */
@media (min-width: 600px) {
  .breakdown .breakdown__narrow-only {
    display: none;
  }
}

.stats-numeric {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 959px) {
  .breakdown__row {
    grid-template-columns:
      var(--bd-label, 120px) minmax(50px, 1fr)
      56px 74px 116px;
    gap: 6px;
  }

  /* Half the desktop width: at 390px a 380px label column would leave the bar
     no lane at all. */
  .breakdown--wide-labels {
    --bd-label: 150px;
  }

  .breakdown__label {
    font-size: 0.75rem;
  }
}

/* Below `sm` the chart drops to what it is for: a name, a bar and the number
   the bar draws.

   Even at the tablet widths above, the five columns floor the row at 446px -
   inside a card on a 375px phone there are about 310px to put it in, so the
   page came out 130px wider than the screen and had to be zoomed out to read at
   all. The two that go are the editorial pair: „do sprawdzenia” and the queue
   button, which are how a logged-in editor picks their next batch of people to
   review. That is not work anybody does on a phone.

   Note that the backlog is then off the phone entirely: `hideViewToggleOnMobile`
   takes the table view with it, and the table is where the count would
   otherwise still be readable. Deliberate - both are for the same reader doing
   the same job at a desk - but it does mean this row is the whole of what a
   phone shows, so what stays in it has to be the reading, not the work. */
@media (max-width: 599.98px) {
  .breakdown__row {
    /* 62px, not the 56px above: „znalezione” is one word and breaks to
       „znalezion / e” in anything narrower. */
    grid-template-columns: var(--bd-label, 108px) minmax(50px, 1fr) 62px;
  }

  /* Ten pixels back from the tablet width, spent on the lane. Two clamped
     lines of a 140px column still carry enough of a hospital's name to tell it
     from its neighbours, and the bars are what the row is for. */
  .breakdown--wide-labels {
    --bd-label: 140px;
  }

  .breakdown .breakdown__editorial,
  .breakdown .breakdown__wide-only {
    display: none;
  }

  /* The grey tail goes with them. It is the same editorial half of the chart
     as the column and the button - what an editor still has to get through -
     and on a phone it was most of the row's ink saying so. The bars are
     redrawn on `narrowAxisMax` so they use the lane the tail has given back
     rather than trailing off into space that is no longer explained. */
  .breakdown__track {
    display: none;
  }

  .breakdown__seg {
    left: var(--seg-left-narrow);
    width: var(--seg-width-narrow);
  }
}
</style>
