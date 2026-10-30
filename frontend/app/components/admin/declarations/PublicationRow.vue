<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`publikacja-${row.personId}`"
    class="dpub"
    :tone="tone"
    :data-person-id="row.personId"
    :data-publication="row.status"
    data-publication-row
  >
    <template #summary>
      <span class="arow-grow dpub__name">{{ row.name }}</span>
      <span class="arow-tag" :class="toneClasses(tone)" data-publication-tag>
        {{ tag }}
      </span>
      <span class="arow-side text-medium-emphasis dpub__unit">
        {{ row.unit }}
      </span>
      <span class="arow-fixed text-medium-emphasis dpub__at">
        {{ shortWarsawTime(row.at, now) }}
      </span>
    </template>

    <template #meta>
      <AdminRowFact label="Stan">{{ statusLabel }}</AdminRowFact>
      <AdminRowFact :label="row.status === 'held' ? 'Wstrzymane' : 'Kiedy'">
        {{ shortWarsawTime(row.at, now) }}
      </AdminRowFact>
      <AdminRowFact label="Jednostka">{{ row.unit }}</AdminRowFact>
      <AdminRowFact label="Powiązania">{{ edgesText }}</AdminRowFact>
    </template>

    <p v-if="row.status === 'held' && row.reason" class="dpub__reason">
      {{ declarationHoldNotes[row.reason] }}
    </p>
    <p v-else-if="row.status === 'queued'" class="dpub__reason">
      Czeka na miejsce w dziennym limicie.
    </p>

    <div class="dpub__links">
      <v-btn
        size="small"
        variant="tonal"
        :to="`/entity/person/${row.personId}`"
        :prepend-icon="mdiAccountOutline"
      >
        Strona osoby
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :href="row.documentUrl"
        target="_blank"
        rel="noopener"
        :prepend-icon="mdiOpenInNew"
      >
        Oświadczenie w BIP
      </v-btn>
    </div>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiAccountOutline, mdiOpenInNew } from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import { polishCounting } from "~/composables/polish";
import { toneClasses } from "~/utils/jobStyle";
import {
  declarationHoldLabels,
  declarationHoldNotes,
  declarationHoldTone,
} from "~/utils/declarationsAdmin";
import type { DeclarationPublicationRow } from "~~/shared/declarations";
import { shortWarsawTime } from "~~/shared/jobs";

/** A person published from the queue, by the automation or at an admin's
 * press, or waiting in it or held, as /admin/oswiadczenia lists them.
 *
 * A held one says why in the words of the hold and what would clear it; the
 * way to act is the person's own page, where an admin publishes by hand, so
 * the row links there rather than growing a second publish button. */
const props = defineProps<{
  row: DeclarationPublicationRow;
  now: Date;
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const tone = computed<RowTone>(() => {
  if (props.row.status === "published") return "success";
  if (props.row.status === "queued") return "sage";
  return declarationHoldTone(props.row.reason);
});

const tag = computed(() => {
  if (props.row.status === "published") return "opublikowana";
  if (props.row.status === "queued") return "w kolejce";
  return props.row.reason
    ? declarationHoldLabels[props.row.reason]
    : "wstrzymana";
});

/** The state in full, for the open row. A page an admin pressed for is the
 * admin's publication, not the automation's. */
const statusLabel = computed(() => {
  if (props.row.status === "published") {
    return props.row.pressed
      ? "opublikowana przez administratora"
      : "opublikowana automatycznie";
  }
  return props.row.status === "queued"
    ? "w kolejce do publikacji"
    : "wstrzymana";
});

/** „12 opublikowanych, 2 wstrzymane” - the relations that went live with the
 * page and the ones that did not. */
const edgesText = computed(() => {
  const { published, held } = props.row.edges;
  const parts = [
    polishCounting(published, "opublikowane", "opublikowane", "opublikowanych"),
  ];
  if (held > 0) {
    parts.push(
      polishCounting(held, "wstrzymane", "wstrzymane", "wstrzymanych"),
    );
  }
  return parts.join(", ");
});
</script>

<style scoped>
.dpub__name {
  font-size: 0.875rem;
  font-weight: 500;
}

.dpub__unit,
.dpub__at {
  font-size: 0.75rem;
}

.dpub__reason {
  margin: 0 0 12px;
  font-size: 0.875rem;
  text-wrap: pretty;
}

.dpub__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* On a phone the line breaks in two: the name and when on the first, the tag
 * and the unit under them. The empty item ordered between the two halves is
 * what forces the break; without it a short name lets the tag ride up and
 * push the line wider than the screen. */
@media (max-width: 599.98px) {
  .dpub :deep(.arow__toggle) {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  .dpub :deep(.arow__toggle)::after {
    content: "";
    order: 1;
    flex-basis: 100%;
  }

  .dpub [data-publication-tag],
  .dpub__unit {
    order: 2;
  }

  .dpub [data-publication-tag] {
    margin-inline-start: 28px;
  }

  .dpub__unit {
    flex: 1 1 0;
    max-width: none;
  }
}
</style>
