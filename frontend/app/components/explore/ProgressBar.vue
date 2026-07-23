<template>
  <v-card v-if="!stats || stats.total > 0" variant="outlined" class="pa-4">
    <div class="d-flex align-center flex-wrap ga-2">
      <span class="text-subtitle-1 font-weight-bold">Postęp weryfikacji</span>
      <span v-if="stats" class="text-body-2 text-medium-emphasis">
        sprawdzono {{ checkedCount }} z
        {{ polishCounting(stats.total, "osoba", "osoby", "osób") }} ({{
          checkedPercent
        }}%)
      </span>
      <v-spacer />
      <v-btn
        v-if="!hideCta"
        to="/eksploruj/nowe"
        color="primary"
        variant="tonal"
        size="small"
        :prepend-icon="mdiArrowRight"
      >
        Pomóż sprawdzać
      </v-btn>
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
          class="text-body-2 text-medium-emphasis d-flex align-center"
        >
          <span
            class="legend-dot mr-1"
            :style="{ background: segment.color }"
          />
          {{ segment.label }}: {{ segment.value }}
        </span>
        <v-spacer />
        <span class="text-caption text-medium-emphasis">
          oczekujące zmiany: {{ stats.pendingRevisions }} · z głosami:
          {{ stats.withVotes }} · z notatkami: {{ stats.withNotes }}
        </span>
      </div>

      <v-divider class="my-3" />

      <div class="d-flex align-center flex-wrap ga-2 text-body-2">
        <template v-if="user">
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="medium-emphasis"
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
            class="text-medium-emphasis"
          >
            — oceń pierwszą osobę i dołóż swoją cegiełkę!
          </span>
        </template>
        <template v-else>
          <v-icon
            :icon="mdiHandHeartOutline"
            size="small"
            color="medium-emphasis"
          />
          <span class="text-medium-emphasis">
            <NuxtLink to="/login" class="text-primary">Zaloguj się</NuxtLink>,
            aby pomóc w sprawdzaniu osób i śledzić swój wkład.
          </span>
        </template>
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
import { mdiArrowRight, mdiHandHeartOutline } from "@mdi/js";
import { computed } from "vue";
import type { Query } from "~~/server/api/nodes/index.get";
import type { ProgressStats } from "~~/server/api/stats/progress.get";
import { useMyContributions } from "~/composables/stats/useMyContributions";
import { polishCounting } from "~/composables/polish";

const props = defineProps<{
  /** The table query; only its structural filters are used, the breakdown by
   * status (visibility, votes) is what the bar itself shows. */
  query: Query;
  /** Hide the call-to-action button (e.g. when already on /eksploruj/nowe). */
  hideCta?: boolean;
}>();

const progressQuery = computed(() => ({
  parties: props.query.parties,
  teryt: props.query.teryt,
  krs: props.query.krs,
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
      color: "#0ca30c",
      labelColor: "#ffffff",
    },
    {
      key: "reviewed",
      label: "Sprawdzone, nieopublikowane",
      value: stats.value.reviewed,
      color: "#2a78d6",
      labelColor: "#ffffff",
    },
    {
      key: "toCheck",
      label: "Do sprawdzenia",
      value: stats.value.toCheck,
      color: "#e2e0dc",
      labelColor: "#52514e",
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
</style>
