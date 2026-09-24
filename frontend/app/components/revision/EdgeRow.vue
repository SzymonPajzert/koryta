<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`powiazanie-${revision.id}`"
    tone="info"
    data-edge-row
    :data-revision-id="revision.id"
  >
    <template #summary>
      <RevisionRowLine>
        <v-icon
          class="flex-0-0 text-ink-info"
          size="small"
          :icon="mdiVectorPolyline"
        />
        <span class="arow-grow font-weight-medium" :title="pair">
          {{ pair }}
        </span>
        <span
          v-if="revision.edgeType"
          class="arow-tag bg-surface-info text-ink-info"
        >
          {{ typeLabel }}
        </span>
        <template #rest>
          <span class="arow-fixed text-body-2 text-medium-emphasis">
            {{ changeCount }}
          </span>
          <span class="arow-side text-body-2" :title="who">{{ who }}</span>
          <span class="arow-fixed text-caption text-medium-emphasis">
            {{ formatDaysAgo(revision.updateTime) }}
          </span>
        </template>
      </RevisionRowLine>
    </template>

    <template #meta>
      <AdminRowFact label="Autor">
        <template v-if="revision.automatic">Pipeline</template>
        <UserChip v-else :uid="revision.updateUser" />
      </AdminRowFact>
      <AdminRowFact label="Kiedy">
        {{ formatMoment(revision.updateTime) }} ·
        {{ formatDaysAgo(revision.updateTime) }}
      </AdminRowFact>
      <!-- Whether the relation is on the site now, which is what decides how
           much a wrong answer costs. It used to read „niezatwierdzona”, which
           is a different question with its own answer - this proposal is
           unapproved by definition. -->
      <AdminRowFact label="Powiązanie">
        {{ revision.published ? "opublikowane" : "nieopublikowane" }}
      </AdminRowFact>
    </template>

    <div class="d-flex flex-column ga-3">
      <div class="d-flex flex-wrap align-center ga-1 text-body-2">
        <template v-for="(end, index) in ends" :key="index">
          <v-icon
            v-if="index > 0"
            :icon="mdiArrowRight"
            size="x-small"
            class="mx-1"
          />
          <NuxtLink
            v-if="end.type"
            :to="
              nodeLinkUrl({ id: end.id, type: end.type, name: end.name ?? '' })
            "
            class="edge-row__end"
          >
            {{ end.name || end.id }}
          </NuxtLink>
          <span v-else class="edge-row__end text-medium-emphasis">
            {{ end.id }}
          </span>
        </template>
      </div>

      <div v-if="revision.changes.length" class="d-flex flex-column ga-1">
        <div
          v-for="change in revision.changes"
          :key="change.field"
          class="edge-row__change text-body-2"
        >
          <span class="text-medium-emphasis">{{
            revisionFieldLabel(change.field)
          }}</span>
          <span>{{ display(change.from) }}</span>
          <v-icon :icon="mdiArrowRight" size="x-small" class="text-disabled" />
          <span class="font-weight-medium">{{ display(change.to) }}</span>
        </div>
      </div>
      <p v-else class="text-body-2 text-medium-emphasis mb-0">
        Powiązanie już to zawiera.
      </p>
    </div>

    <template #footer>
      <!-- Deciding happens in the queue above: an edge revision is a revision
           like any other, so its permalink pins it there with the approve and
           reject buttons every proposal gets. This page used to have no
           decision for these at all. -->
      <v-btn
        variant="tonal"
        size="small"
        color="ink-sage"
        :prepend-icon="mdiGavel"
        :to="reviewTo"
        :data-testid="`edge-review-${revision.id}`"
      >
        Rozpatrz
      </v-btn>
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
/** One pending change to a relation, on /admin/rewizje, as a line that opens.
 *
 * The line is the pair it joins, the kind of relation, how many fields change
 * and who proposed it; the open row names both ends as links and lists the
 * changes field by field.
 */
import { computed, watch } from "vue";
import { mdiArrowRight, mdiGavel, mdiVectorPolyline } from "@mdi/js";
import { useUserLookup } from "@/composables/users";
import { formatDaysAgo } from "~/utils/chartTheme";
import { nodeLinkUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import {
  renderFieldValue,
  revisionFieldLabel,
} from "~~/shared/revisionChanges";
import type { PendingEdgeRevision } from "~~/server/api/revisions/pendingEdges.get";

const props = defineProps<{
  revision: PendingEdgeRevision;
  /** The Polish name of each edge type the section can filter by. */
  typeLabels: Record<string, string>;
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const route = useRoute();

const ends = computed(() => [props.revision.source, props.revision.target]);

const pair = computed(
  () =>
    `${props.revision.source.name || props.revision.source.id} → ${
      props.revision.target.name || props.revision.target.id
    }`,
);

const typeLabel = computed(() => {
  const type = props.revision.edgeType;
  return type ? (props.typeLabels[type] ?? type) : "";
});

const changeCount = computed(() =>
  props.revision.changes.length === 0
    ? "bez zmian"
    : polishCounting(
        props.revision.changes.length,
        "zmiana",
        "zmiany",
        "zmian",
      ),
);

const { resolve, displayName } = useUserLookup();

// The endpoint resolves no authors. The line has no room for a chip, so it asks
// the same batched lookup the open row's chip uses: a page of rows is one
// request, and the chip then finds the name already cached.
watch(
  () => (props.revision.automatic ? null : props.revision.updateUser),
  (uid) => resolve([uid]),
  { immediate: true },
);

/** The author's name, or the raw uid until the lookup answers. */
const who = computed(() =>
  props.revision.automatic
    ? "pipeline"
    : displayName(props.revision.updateUser),
);

/** Pins this revision in the queue section, keeping every other filter on the
 * page as it was, so coming back down here finds the same page of rows. */
const reviewTo = computed(() => ({
  query: { ...route.query, rewizja: props.revision.id },
  hash: "#kolejka",
}));

/** A field value as one short line. The values are the scalars an edge carries
 * - a committee, a party, a date - so this is mostly about not printing
 * `[object Object]` if one ever is not. */
const display = (value: unknown) => renderFieldValue(value) ?? "—";

const formatMoment = (value: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";
</script>

<style scoped>
/* Names are not always prose: an id has no space to break at. */
.edge-row__end {
  overflow-wrap: anywhere;
}

.edge-row__change {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  overflow-wrap: anywhere;
}
</style>
