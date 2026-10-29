<template>
  <div class="dtiles">
    <!-- The one number the page leads with here: what went public today,
         against the limit that keeps it slow. -->
    <AdminDeclarationsCap
      class="dtiles__hero"
      hero
      :today="overview.publications.today"
      :daily-limit="overview.dailyLimit"
      :queued="overview.publications.queued"
      :publishing="publishing"
      @publish="emit('publish')"
    />

    <div class="dtiles__progress" data-testid="declarations-progress">
      <div class="dtiles__row">
        <StatsStatTile
          v-for="tile in tiles"
          :key="tile.key"
          :label="tile.label"
          :value="tile.value"
          :hint="tile.hint"
          :tooltip="tile.tooltip"
          :data-tile="tile.key"
        />
      </div>

      <!-- Before the first upload a bar of nothing would be a blank strip
           over six zeros. -->
      <div v-if="overview.extracts.total > 0" class="dtiles__composition">
        <h3 class="dtiles__subhead">Oświadczenia według stanu</h3>
        <StatsCompositionBar
          :segments="segments"
          :summary="compositionSummary"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCount, ink, status } from "~/utils/chartTheme";
import {
  declarationStages,
  declarationStatusLabels,
} from "~/utils/declarationsAdmin";
import { polishCountingGenitive } from "~/composables/polish";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";
import type {
  DeclarationOverview,
  ExtractStatus,
} from "~~/shared/declarations";

/** Variant „kafelki” of the overview's head: today's publications against
 * the limit as the hero, the stages of the run as a row of smaller numbers,
 * and every declaration the job sent by where its reading stands. */
const props = defineProps<{
  overview: DeclarationOverview;
  publishing?: boolean;
}>();

const emit = defineEmits<{ publish: [] }>();

const tiles = computed(() => {
  const o = props.overview;
  const s = declarationStages(o);
  return [
    {
      key: "found",
      label: "Znalezione oświadczenia",
      value: s.found,
      hint: `z ${polishCountingGenitive(s.candidacies, "kandydatury", "kandydatur")}`,
      tooltip:
        "Kandydatury, przy których zadanie znalazło w BIP-ie oświadczenie majątkowe tej osoby.",
    },
    {
      key: "crops",
      label: "Wycinki z datą",
      value: s.crops,
      hint: `z ${polishCountingGenitive(s.declarations, "oświadczenia", "oświadczeń")}`,
      tooltip:
        "Oświadczenia, z których dało się wyciąć linię z datą urodzenia.",
    },
    {
      key: "agreed",
      label: "Odczytane zgodnie",
      value: s.agreed,
      hint: `${formatCount(o.extracts.byStatus.open)} czeka na czytelników`,
    },
    {
      key: "same",
      label: "Zgodne ze stroną",
      value: s.same,
      hint: `${formatCount(o.pages.different)} z inną datą na stronie`,
    },
    {
      key: "published",
      label: "Opublikowane łącznie",
      value: s.published,
      hint: `${formatCount(o.publications.held)} wstrzymanych`,
    },
    {
      key: "readers",
      label: "Czytelnicy",
      value: o.readers.readers,
      hint: `${formatCount(o.readers.answers)} odpowiedzi`,
    },
  ];
});

/** States, so state colours: agreed is the good end, a dispute the one that
 * needs somebody, and the greys are out of the reading - cut nothing, or
 * taken back. What is still waiting is the bar's empty remainder, last. The
 * order is the one the palette check passed as a stack: no two neighbours a
 * colourblind reader would confuse. */
const SEGMENT_ORDER: { key: ExtractStatus; color: string; label?: string }[] = [
  { key: "agreed", color: status.good },
  { key: "unreadable", color: status.warning, label: ink.primary },
  { key: "disputed", color: status.critical },
  { key: "withdrawn", color: ink.muted },
  { key: "failed", color: ink.secondary },
  { key: "open", color: ink.track, label: ink.primary },
];

const segments = computed<CompositionSegment[]>(() =>
  SEGMENT_ORDER.map(({ key, color, label }) => ({
    key,
    label: declarationStatusLabels[key],
    value: props.overview.extracts.byStatus[key],
    color,
    labelColor: label,
  })),
);

const compositionSummary = computed(() =>
  segments.value
    .map((segment) => `${segment.label}: ${formatCount(segment.value)}`)
    .join(", "),
);
</script>

<style scoped>
.dtiles {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dtiles__hero {
  padding: 16px 20px 20px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-sage));
}

.dtiles__progress {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dtiles__row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px 24px;
}

.dtiles__subhead {
  margin: 0 0 8px;
  font-size: 0.875rem;
  font-weight: 600;
}

@media (max-width: 959.98px) {
  .dtiles__row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 599.98px) {
  .dtiles__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
