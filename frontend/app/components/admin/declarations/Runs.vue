<template>
  <div class="druns">
    <p v-if="!groups.length" class="druns__empty">
      Zadanie jeszcze niczego nie przesłało.
    </p>
    <ul v-else class="druns__list">
      <li
        v-for="group in shown"
        :key="group.key"
        class="druns__row"
        :data-run="group.runId ?? group.key"
      >
        <span class="druns__when">{{ when(group) }}</span>
        <code class="druns__tag" :title="group.tag">{{ group.tag }}</code>
        <span class="druns__count">
          {{
            polishCountingGrouped(
              group.extracts,
              "oświadczenie",
              "oświadczenia",
              "oświadczeń",
            )
          }}
          <span v-if="group.uploads > 1" class="text-medium-emphasis">
            w {{ group.uploads }} paczkach
          </span>
        </span>
        <!-- The run on /admin/procesy, where the job reports how it went. -->
        <NuxtLink
          v-if="group.runId"
          class="druns__run"
          :to="`/admin/procesy#przebieg-${encodeURIComponent(group.runId)}`"
        >
          przebieg
        </NuxtLink>
      </li>
    </ul>
    <v-btn
      v-if="groups.length > LIMIT"
      size="small"
      variant="text"
      class="druns__more"
      :append-icon="showAll ? mdiChevronUp : mdiChevronDown"
      @click="showAll = !showAll"
    >
      {{ showAll ? "Zwiń" : `Pokaż wszystkie (${groups.length})` }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { polishCountingGrouped } from "~/composables/polish";
import {
  groupDeclarationRuns,
  type DeclarationRunGroup,
} from "~/utils/declarationsAdmin";
import type { DeclarationOverview } from "~~/shared/declarations";
import { shortWarsawTime } from "~~/shared/jobs";

/** What the job sent, newest first: one line a run, which version of the
 * cutter made it and how many declarations it brought - so a bad batch can
 * be found by its tag and sent again. */
const props = defineProps<{
  runs: DeclarationOverview["runs"];
  now: Date;
}>();

const LIMIT = 8;
const showAll = ref(false);

const groups = computed(() => groupDeclarationRuns(props.runs));
const shown = computed(() =>
  showAll.value ? groups.value : groups.value.slice(0, LIMIT),
);

/** When it came: one time for a run sent at once, the first and the last
 * upload for one that took a while. */
function when(group: DeclarationRunGroup) {
  const last = shortWarsawTime(group.last, props.now);
  if (group.first === group.last) return last;
  return `${shortWarsawTime(group.first, props.now)} - ${last}`;
}
</script>

<style scoped>
.druns__empty {
  margin: 0;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.druns__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* A ledger: one line a run, its columns lined up on a desktop and wrapping
 * on a phone. */
.druns__row {
  display: grid;
  grid-template-columns: 11em minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 4px 16px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-size: 0.875rem;
}

.druns__when {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.druns__tag {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.druns__count {
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.druns__more {
  margin-top: 4px;
  margin-inline-start: -8px;
}

@media (max-width: 599.98px) {
  .druns__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .druns__tag {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .druns__count {
    grid-column: 1 / -1;
    grid-row: 3;
    text-align: start;
  }

  .druns__run {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
