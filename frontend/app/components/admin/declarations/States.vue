<template>
  <!-- Before the first upload a bar of nothing would be a blank strip over
       a chain of zeros. -->
  <div
    v-if="overview.extracts.total > 0"
    class="dstates"
    data-testid="declarations-states"
  >
    <h3 class="dstates__head">Oświadczenia według stanu</h3>
    <StatsCompositionBar :segments="segments" :summary="summary" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCount, ink, status } from "~/utils/chartTheme";
import { declarationStatusLabels } from "~/utils/declarationsAdmin";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";
import type {
  DeclarationOverview,
  ExtractStatus,
} from "~~/shared/declarations";

/** Every declaration the job sent, by where its reading stands, over the
 * chain: the bar shows the whole run at once, the chain then walks through it
 * stage by stage. Szymon kept it from round 1's tiles (bip-admin-r1,
 * 2026-10-29: "maybe we can integrate it again into the chain") and put it
 * above the chain (bip-admin-r2: "Maybe put it above the chain"). */
const props = defineProps<{ overview: DeclarationOverview }>();

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

const summary = computed(() =>
  segments.value
    .map((segment) => `${segment.label}: ${formatCount(segment.value)}`)
    .join(", "),
);
</script>

<style scoped>
.dstates__head {
  margin: 0 0 8px;
  font-size: 0.875rem;
  font-weight: 600;
}
</style>
