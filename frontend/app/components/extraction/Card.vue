<template>
  <v-card variant="outlined" class="extraction-card">
    <v-card-item>
      <template #prepend>
        <v-chip
          :color="factTypeColor"
          size="small"
          variant="tonal"
          class="me-2"
        >
          {{ factTypeLabel }}
        </v-chip>
      </template>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        {{ displayPerson }}
      </v-card-title>
      <v-card-subtitle v-if="secondaryText">
        {{ secondaryText }}
      </v-card-subtitle>
    </v-card-item>

    <v-card-text v-if="fact.role" class="pt-0 pb-2">
      <v-icon size="14" class="me-1">{{ mdiAccountTie }}</v-icon>
      <span class="text-body-2 text-medium-emphasis">{{ fact.role }}</span>
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
import { mdiAccountTie } from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import {
  factTypeLabel as labelFor,
  factTypeColor as colorFor,
  factSubject,
  factSummary,
} from "~/utils/extraction";

const { fact } = defineProps<{
  fact: ExtractionFact;
}>();

const factTypeLabel = computed(() => labelFor(fact));
const factTypeColor = computed(() => colorFor(fact));
const displayPerson = computed(() => factSubject(fact));
const secondaryText = computed(() => factSummary(fact));
</script>

<style scoped>
.extraction-quote {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.4);
  padding-left: 12px;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
