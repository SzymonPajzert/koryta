<template>
  <v-card variant="outlined" class="extraction-card">
    <v-card-text class="pb-2">
      <div class="edge">
        <!-- Source entity (left) -->
        <div class="edge__entity edge__entity--source">
          <div class="edge__name">
            <v-icon size="16" class="edge__icon me-1">{{
              mdiAccountOutline
            }}</v-icon>
            <span>{{ sourceName }}</span>
          </div>
          <div class="edge__kind">osoba</div>
        </div>

        <!-- Connector (center) -->
        <div class="edge__connector">
          <v-chip
            :color="connectorColor"
            size="small"
            variant="tonal"
            class="edge__chip"
          >
            {{ connectorLabel }}
            <v-icon end size="16">{{ mdiArrowRight }}</v-icon>
          </v-chip>
          <div class="edge__type">{{ typeLabel }}</div>
        </div>

        <!-- Target entity (right) -->
        <div
          v-if="targetName"
          class="edge__entity edge__entity--target"
        >
          <div class="edge__name">
            <span>{{ targetName }}</span>
            <v-icon size="16" class="edge__icon ms-1">{{ targetIcon }}</v-icon>
          </div>
          <div v-if="targetKind" class="edge__kind">{{ targetKind }}</div>
        </div>
      </div>
    </v-card-text>

    <v-card-text v-if="fact.justification" class="pt-0">
      <blockquote class="extraction-quote text-body-2">
        {{ fact.justification }}
      </blockquote>
    </v-card-text>

    <v-card-actions class="pt-0">
      <v-chip
        v-if="fact.articleDomain"
        size="x-small"
        variant="text"
        class="text-medium-emphasis"
      >
        {{ fact.articleDomain }}
      </v-chip>
      <v-spacer />
      <slot name="actions" />
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiAccountOutline,
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiDomain,
} from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import {
  factTypeLabel,
  factTypeColor,
  factSubject,
  factTarget,
  factConnector,
  factTargetKind,
} from "~/utils/extraction";

const { fact } = defineProps<{
  fact: ExtractionFact;
}>();

const sourceName = computed(() => factSubject(fact));
const targetName = computed(() => factTarget(fact));
const connectorLabel = computed(() => factConnector(fact));
const connectorColor = computed(() => factTypeColor(fact));
const typeLabel = computed(() => factTypeLabel(fact));
const targetKind = computed(() => factTargetKind(fact));

const targetIcon = computed(() => {
  if (fact.fact_type === "employment") return mdiDomain;
  if (fact.fact_type === "party_membership") return mdiAccountGroupOutline;
  return mdiAccountOutline; // personal_relation
});
</script>

<style scoped>
.edge {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px 12px;
}

.edge__entity {
  /* allow long names to wrap instead of overflowing / truncating */
  min-width: 0;
  overflow-wrap: anywhere;
}

.edge__entity--source {
  text-align: left;
}

.edge__entity--target {
  text-align: right;
}

.edge__name {
  font-weight: 600;
  line-height: 1.3;
}

.edge__icon {
  opacity: 0.55;
  vertical-align: text-bottom;
}

.edge__kind,
.edge__type {
  font-size: 0.7rem;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.edge__kind {
  margin-top: 2px;
}

.edge__connector {
  text-align: center;
}

.edge__type {
  margin-top: 4px;
}

.extraction-quote {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.4);
  padding-left: 12px;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
