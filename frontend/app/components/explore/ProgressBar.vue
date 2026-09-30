<template>
  <v-card
    v-if="visible && !compact"
    variant="outlined"
    class="pa-4"
    data-testid="explore-progress"
  >
    <div class="d-flex align-center flex-wrap ga-2">
      <span class="text-subtitle-1 font-weight-bold">Postęp weryfikacji</span>
      <span v-if="stats" class="text-body-2 text-ink-neutral">
        sprawdzono {{ polishNumber(checkedCount) }} z
        {{ polishCountingGenitive(stats.total, "osoby", "osób") }} ({{
          checkedPercent
        }}%)
      </span>
    </div>

    <v-skeleton-loader v-if="!stats" type="text" class="mt-2" />
    <template v-else>
      <div
        class="stack-bar mt-3"
        role="img"
        :aria-label="`Opublikowane: ${stats.approved}, sprawdzone: ${stats.reviewed}, do sprawdzenia: ${stats.toCheck}`"
      >
        <v-tooltip
          v-for="segment in segments"
          :key="segment.key"
          :text="`${segment.label}: ${segment.value}`"
          location="bottom"
        >
          <template #activator="{ props: tooltipProps }">
            <div
              v-bind="tooltipProps"
              class="stack-bar-segment"
              :style="{
                width: (segment.value / stats.total) * 100 + '%',
                backgroundColor: segment.color,
              }"
            >
              <span
                v-if="segment.value / stats.total > 0.08"
                class="segment-label"
                :style="{ color: segment.labelColor }"
              >
                {{ segment.value }}
              </span>
            </div>
          </template>
        </v-tooltip>
      </div>

      <div class="d-flex flex-wrap align-center ga-4 mt-2">
        <span
          v-for="segment in segments"
          :key="segment.key"
          class="text-body-2 text-ink-neutral d-flex align-center"
        >
          <span
            class="legend-dot mr-1"
            :style="{ background: segment.color }"
          />
          {{ segment.label }}: {{ segment.value }}
        </span>
        <v-spacer />
        <span class="text-caption text-ink-neutral">
          z głosami: {{ stats.withVotes }} · z notatkami:
          {{ stats.withNotes }}
        </span>
      </div>

      <v-divider class="my-3" />

      <div class="d-flex align-center flex-wrap ga-2 text-body-2">
        <template v-if="user">
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="ink-neutral"
          />
          <span>
            Twój wkład:
            <strong>{{ votesCount }}</strong>
            {{ pluralPl(votesCount, "głos", "głosy", "głosów") }} ·
            <strong>{{ notesCount }}</strong>
            {{ pluralPl(notesCount, "notatka", "notatki", "notatek") }} ·
            <strong>{{ revisionsCount }}</strong>
            {{
              pluralPl(revisionsCount, "propozycja", "propozycje", "propozycji")
            }}
            zmian
          </span>
          <span
            v-if="votesCount + notesCount + revisionsCount === 0"
            class="text-ink-neutral"
          >
            — oceń pierwszą osobę i dołóż swoją cegiełkę!
          </span>
        </template>
        <template v-else>
          <!-- The invitation a guest meets on /eksploruj/nowe, which mounts
               this component unconditionally. It was `text-primary`: the
               brand's sage as 14px ink on white is 1.85:1. Info, because
               that is the palette's link ink - 6.35:1 here. -->
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="ink-neutral"
          />
          <span class="text-ink-neutral">
            <NuxtLink to="/login" class="text-ink-info">Zaloguj się</NuxtLink>,
            aby pomóc w sprawdzaniu osób i śledzić swój wkład.
          </span>
        </template>
      </div>
    </template>
  </v-card>

  <!-- The same three figures as one band, for the query bar on
       /eksploruj/tabela. A plain div and not a v-card because there it renders
       inside the bar's own bordered v-sheet, and an outlined card inside an
       outlined sheet reads as two panels rather than one. The card variant is
       still what /eksploruj/nowe gets, which is why this is a second branch
       and not a set of classes on the first. -->
  <div v-else-if="visible" class="px-0 py-1" data-testid="explore-progress">
    <v-skeleton-loader v-if="!stats" type="text" />
    <template v-else>
      <div class="d-flex align-center flex-wrap gc-3 gr-1 text-body-2">
        <!-- 8px rather than the 20px track: at this height a segment cannot
             carry its own number, so the figures live in the tooltip and in
             the legend below and the bar is only the proportion. -->
        <div
          class="stack-bar stack-bar--slim stack-bar--inline"
          role="img"
          :aria-label="`Opublikowane: ${stats.approved}, sprawdzone: ${stats.reviewed}, do sprawdzenia: ${stats.toCheck}`"
        >
          <v-tooltip
            v-for="segment in segments"
            :key="segment.key"
            :text="`${segment.label}: ${segment.value}`"
            location="bottom"
          >
            <template #activator="{ props: tooltipProps }">
              <div
                v-bind="tooltipProps"
                class="stack-bar-segment"
                :style="{
                  width: (segment.value / stats.total) * 100 + '%',
                  backgroundColor: segment.color,
                }"
              />
            </template>
          </v-tooltip>
        </div>

        <!-- `text-ink-neutral` rather than Vuetify's `text-medium-emphasis`,
             here and everywhere else in this component: the query bar this
             band renders inside counts its rows in the palette's neutral, so
             the row was carrying two different greys at once, #4c616b and
             #666666. Both clear AA - medium emphasis measures 5.74:1 on white
             and the ink 6.50:1 - so this is consistency, not contrast. -->
        <span class="text-ink-neutral">
          sprawdzono {{ polishNumber(checkedCount) }} z
          {{ polishCountingGenitive(stats.total, "osoby", "osób") }} ({{
            checkedPercent
          }}%)
        </span>

        <!-- No d-none/d-sm-inline on the contribution: flex-wrap drops it onto
             its own line below md instead of hiding it, because on a phone
             "what have I done so far" is the whole reason a signed-in reader
             looks at this band.

             One inline run and not a d-flex row: as a flex container every
             word between the <strong>s becomes an item of its own, and at
             390px that broke the sentence into a ragged grid with the "·"
             separators alone on their lines. The icon is inline-flex, so it
             sits in the text without needing one. -->
        <span v-if="user">
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="ink-neutral"
            class="mr-1"
          />
          Twój wkład:
          <strong>{{ votesCount }}</strong>
          {{ pluralPl(votesCount, "głos", "głosy", "głosów") }} ·
          <strong>{{ notesCount }}</strong>
          {{ pluralPl(notesCount, "notatka", "notatki", "notatek") }} ·
          <strong>{{ revisionsCount }}</strong>
          {{
            pluralPl(revisionsCount, "propozycja", "propozycje", "propozycji")
          }}
          zmian
        </span>
        <span v-else class="text-ink-neutral">
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="ink-neutral"
            class="mr-1"
          />
          <NuxtLink to="/login" class="text-ink-info">Zaloguj się</NuxtLink>,
          aby pomóc w sprawdzaniu osób i śledzić swój wkład.
        </span>
      </div>

      <!-- The legend is the only line here that is reference rather than news,
           and it is the one that wraps to three rows on a 390px phone - which
           is the height this band exists to give back. Hidden by class and not
           by useDisplay(), because under SSR Vuetify's display state starts at
           a placeholder 1280px and a v-if on it would render the desktop
           branch into the phone's HTML. -->
      <div class="d-none d-md-flex flex-wrap align-center gc-3 mt-1">
        <span
          v-for="segment in segments"
          :key="segment.key"
          class="text-caption text-ink-neutral d-flex align-center"
        >
          <span
            class="legend-dot legend-dot--sm mr-1"
            :style="{ background: segment.color }"
          />
          {{ segment.label }}: {{ segment.value }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { mdiHandHeartOutline } from "@mdi/js";
import { computed } from "vue";
import type { Query } from "~~/server/api/nodes/index.get";
import type { ProgressStats } from "~~/server/api/stats/progress.get";
import { useMyContributions } from "~/composables/stats/useMyContributions";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import { categorical, ink, status } from "~/utils/chartTheme";

const props = defineProps<{
  /** The table query; only its structural filters are used, the breakdown by
   * status (visibility, votes) is what the bar itself shows. */
  query: Query;
  /** Accepted and ignored: this component no longer draws a „Pomóż
   * sprawdzać” button at all. Both callers passed `hide-cta` - nowe.vue is
   * the page it links to, and the query bar draws its own filled copy at the
   * end of the work row - so the tonal one here was never painted, and its
   * label was the pale `primary` on white the palette replaced. Kept as a
   * prop so the attribute those callers pass does not land on the root
   * element. */
  hideCta?: boolean;
  /** Render as a band inside the table page's query bar instead of as a card:
   * one line at md and up, no card border, no padding of its own. Off keeps
   * the five-band card /eksploruj/nowe is built around. */
  compact?: boolean;
}>();

const progressQuery = computed(() => ({
  parties: props.query.parties,
  teryt: props.query.teryt,
  companyTeryt: props.query.companyTeryt,
  krs: props.query.krs,
  place: props.query.place,
  category: props.query.category,
  currentlyEmployed:
    props.query.currentlyEmployed !== "all"
      ? props.query.currentlyEmployed
      : undefined,
  minEmploymentDate: props.query.minEmploymentDate,
  minVotes: props.query.minVotes,
}));

const { data: stats } = await useAsyncData(
  "explore-progress",
  () =>
    $fetch<ProgressStats>("/api/stats/progress", {
      query: progressQuery.value,
    }),
  { watch: [progressQuery] },
);

const { user, votesCount, notesCount, revisionsCount } = useMyContributions();

// Shared by both roots: an empty filtered set has no progress to report, and
// the table underneath already says there is nothing there.
const visible = computed(() => !stats.value || stats.value.total > 0);

const checkedCount = computed(() =>
  stats.value ? stats.value.approved + stats.value.reviewed : 0,
);
const checkedPercent = computed(() =>
  stats.value && stats.value.total > 0
    ? Math.round((checkedCount.value / stats.value.total) * 100)
    : 0,
);

// Colors validated with the dataviz palette checks (CVD + contrast) on a
// white surface; "do sprawdzenia" is the neutral remainder track.
const segments = computed(() => {
  if (!stats.value) return [];
  return [
    {
      key: "approved",
      label: "Opublikowane",
      value: stats.value.approved,
      color: status.good,
      labelColor: ink.surface,
    },
    {
      key: "reviewed",
      label: "Sprawdzone, nieopublikowane",
      value: stats.value.reviewed,
      color: categorical[0],
      labelColor: ink.surface,
    },
    {
      key: "toCheck",
      label: "Do sprawdzenia",
      value: stats.value.toCheck,
      color: ink.track,
      labelColor: ink.secondary,
    },
  ].filter((s) => s.value > 0);
});

function pluralPl(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
</script>

<style scoped>
.stack-bar {
  display: flex;
  width: 100%;
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
}

.stack-bar-segment {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 3px;
  transition: width 0.3s ease;
}

/* 2px surface gap separates touching segments */
.stack-bar-segment:not(:last-child) {
  margin-right: 2px;
}

.segment-label {
  font-size: 0.75rem;
  font-weight: 500;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

/* Compact only. A fixed 160px basis rather than a share of the row: the row
   wraps, and a flexible bar would be a different width on every filter change
   and would collapse to nothing once the contribution line joins it. */
.stack-bar--slim {
  height: 8px;
  border-radius: 4px;
}

.stack-bar--inline {
  flex: 0 0 160px;
  width: 160px;
}

.legend-dot--sm {
  width: 8px;
  height: 8px;
}
</style>
