<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`kolejka-wpis-${group.subject.id}`"
    :tone="waiting ? 'warning' : 'neutral'"
    data-queue-group
    :data-subject-id="group.subject.id"
  >
    <template #summary>
      <RevisionRowLine>
        <v-icon
          class="flex-0-0"
          size="small"
          :icon="subjectIcon"
          :class="waiting ? 'text-ink-warning' : 'text-ink-neutral'"
        />
        <span class="arow-grow font-weight-medium" :title="name">
          {{ name }}
        </span>
        <span
          v-if="group.subject.published"
          class="arow-tag bg-surface-success text-ink-success"
          data-subject-published
        >
          opublikowana
        </span>
        <template #rest>
          <span
            v-if="fields"
            class="arow-side text-body-2 text-medium-emphasis"
            :title="fields"
          >
            {{ fields }}
          </span>
          <span class="arow-side text-body-2" :title="who">{{ who }}</span>
          <span class="arow-fixed text-body-2" data-group-count>
            {{ countLabel }}
          </span>
          <span class="arow-fixed text-caption text-medium-emphasis">
            {{ formatDaysAgo(newest) }}
          </span>
        </template>
      </RevisionRowLine>
    </template>

    <template v-if="comparisonTo" #actions>
      <v-btn
        icon
        variant="text"
        size="small"
        :to="comparisonTo"
        aria-label="Porównanie obok siebie"
        data-compare-link
      >
        <v-icon :icon="mdiCompare" size="small" />
        <v-tooltip activator="parent" location="bottom">
          Porównanie obok siebie
        </v-tooltip>
      </v-btn>
    </template>

    <template #meta>
      <AdminRowFact label="Strona">
        {{ group.subject.published ? "opublikowana" : "nieopublikowana" }}
      </AdminRowFact>
      <AdminRowFact label="Najnowsza zmiana">
        {{ formatMoment(newest) }} · {{ formatDaysAgo(newest) }}
      </AdminRowFact>
    </template>

    <div class="d-flex flex-column ga-2">
      <div v-if="group.subject.path">
        <v-btn
          variant="text"
          size="small"
          color="ink-sage"
          :prepend-icon="mdiOpenInNew"
          :to="group.subject.path"
        >
          Strona wpisu
        </v-btn>
      </div>
      <AdminRowList data-group-list>
        <slot />
      </AdminRowList>
      <p
        v-if="hidden > 0"
        class="text-body-2 text-medium-emphasis mb-0"
        data-group-more
      >
        {{ hiddenLabel }}
      </p>
    </div>
  </AdminExpandRow>
</template>

<script setup lang="ts">
/** One entry in the review queue's grouped view, with the proposals about it
 * inside.
 *
 * The line answers what the grouping is for: which entry, whether it is live
 * already, what about it is being changed, by whom and how long ago. The
 * proposals themselves come in through the slot as the queue's own rows, so a
 * decision inside a group is the same click, and the same request, as one on
 * the plain list.
 */
import { computed } from "vue";
import { mdiCompare, mdiOpenInNew, mdiVectorPolyline } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import { formatDaysAgo } from "~/utils/chartTheme";
import { polishCounting } from "~/composables/polish";
import type { Proposal } from "~~/shared/proposals";
import type { QueueGroup } from "~~/server/api/revisions/queue.get";

const props = defineProps<{
  group: QueueGroup;
  /** The group's rows on this page - the group's own, less any the page shows
   * somewhere else (a permalinked one, pinned on top). */
  proposals: Proposal[];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

/** A relation neither end of which can be read is its own subject, and has no
 * type of its own to draw. */
const subjectIcon = computed(() =>
  props.group.subject.type
    ? entityIcon(props.group.subject.type)
    : mdiVectorPolyline,
);

const name = computed(() => props.group.subject.name ?? props.group.subject.id);

const waiting = computed(() =>
  props.proposals.some((proposal) => proposal.status === "pending"),
);

/** The proposals counted where they are, so the line agrees with what opens
 * under it. */
const shown = computed(
  () =>
    props.group.count - (props.group.proposals.length - props.proposals.length),
);

const countLabel = computed(() =>
  polishCounting(shown.value, "propozycja", "propozycje", "propozycji"),
);

const hidden = computed(() => shown.value - props.proposals.length);

const hiddenLabel = computed(
  () => `Pokazujemy ${props.proposals.length} najnowszych z ${shown.value}.`,
);

/** Which fields the group's proposals touch, once each, in the order they
 * first come up. A relation is named as one, whatever it changes, and a
 * proposal that changes nothing says so, as its own line does. */
const fields = computed(() => {
  const labels = new Set<string>();
  for (const proposal of props.proposals) {
    if (proposal.kind === "removal") labels.add("usunięcie");
    else if (proposal.targetCollection === "edges") labels.add("powiązania");
    else if (proposal.changeCount === 0) labels.add("bez zmian");
    else for (const change of proposal.changes) labels.add(change.label);
  }
  const text = [...labels].join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
});

/** Who proposed them, plainly - the line is the inside of a button. */
const who = computed(() => {
  const names = new Set<string>();
  for (const proposal of props.proposals) {
    names.add(
      proposal.automatic
        ? "pipeline"
        : proposal.author?.displayName ||
            proposal.author?.email ||
            proposal.updateUser ||
            "nieznany autor",
    );
  }
  return [...names].join(", ");
});

const newest = computed(() => props.proposals[0]?.updateTime ?? null);

/** The side-by-side view, which only exists for an entry. */
const comparisonTo = computed(() =>
  props.group.subject.type ? `/admin/rewizje/${props.group.subject.id}` : null,
);

const formatMoment = (value: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";
</script>
