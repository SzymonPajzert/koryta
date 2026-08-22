<template>
  <v-list class="px-2" variant="flat" data-testid="relations-history">
    <div class="d-flex align-center justify-space-between mb-2">
      <h3 class="text-h6">Historia powiązań</h3>
      <v-btn
        v-if="canAdd"
        variant="text"
        size="small"
        color="primary"
        :prepend-icon="mdiPlus"
        data-testid="add-relation-employment"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </div>

    <div class="pa-1">
      <v-list-item
        v-for="edge in edgesSorted"
        :key="edge.id"
        :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
        base-color="surface-light"
        class="mt-1"
        rounded
      >
        <template #prepend>
          <v-icon :icon="getIcon(edge.richNode.type)" />
        </template>

        <v-list-item-title class="text-subtitle-2 font-weight-bold text-wrap">
          {{ edge.richNode.name }}
        </v-list-item-title>

        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-caption text-medium-emphasis text-wrap">
            {{ edgeLabel(edge) }}
          </span>
          <PartyChip v-if="partyOf(edge)" :party="partyOf(edge)!" />
          <span
            v-if="committeeOf(edge)"
            class="text-caption text-medium-emphasis text-wrap"
          >
            {{ committeeOf(edge) }}
          </span>
          <ChipPublicCompany :company="asCompany(edge)" />
        </div>

        <div v-if="isDated(edge)" class="d-md-none mt-2 pb-2">
          <ChipRelativeDuration
            :start="edge.start_date"
            :end="edge.end_date"
            :min-start="minStart"
            :max-end="maxEnd"
          />
        </div>

        <template #append>
          <div class="d-flex align-center ga-2">
            <div v-if="isDated(edge)" class="d-none d-md-flex">
              <ChipRelativeDuration
                :start="edge.start_date"
                :end="edge.end_date"
                :min-start="minStart"
                :max-end="maxEnd"
              />
            </div>
            <!-- What the claim rests on. The row itself is a link to the other
                 end, so this stops the click rather than letting it navigate
                 away from the relation it is about. -->
            <v-btn
              v-if="edge.id && (sourceCount(edge) > 0 || canEdit)"
              variant="text"
              size="small"
              class="px-1"
              :color="sourceCount(edge) > 0 ? undefined : 'medium-emphasis'"
              :title="
                sourceCount(edge) > 0
                  ? 'Pokaż źródła powiązania'
                  : 'Dodaj źródło powiązania'
              "
              :data-testid="`edge-sources-open-${edge.id}`"
              @click.stop.prevent="emit('sources', edge)"
            >
              <v-icon
                :icon="
                  sourceCount(edge) > 0
                    ? mdiFileDocumentMultipleOutline
                    : mdiFileDocumentPlusOutline
                "
                size="small"
              />
              <span v-if="sourceCount(edge) > 0" class="ml-1 text-caption">
                {{ sourceCount(edge) }}
              </span>
            </v-btn>
          </div>
        </template>
      </v-list-item>
    </div>
  </v-list>
</template>

<script lang="ts" setup>
import {
  mdiAccountOutline,
  mdiOfficeBuildingOutline,
  mdiFileDocumentOutline,
  mdiCommentArrowRightOutline,
  mdiFileDocumentMultipleOutline,
  mdiFileDocumentPlusOutline,
  mdiPlus,
} from "@mdi/js";
import type { Company } from "~~/shared/model";

function getIcon(type: string) {
  switch (type) {
    case "person":
      return mdiAccountOutline;
    case "place":
      return mdiOfficeBuildingOutline;
    case "article":
      return mdiFileDocumentOutline;
    default:
      return mdiCommentArrowRightOutline;
  }
}

const props = defineProps<{
  edges: EdgeNode[];
  /** Whether this section offers adding a relation. */
  canAdd?: boolean;
  /** Whether each row offers citing the relation to an article. A reader who
   * cannot edit still sees the count on the relations that have one. */
  canEdit?: boolean;
}>();

const emit = defineEmits<{ add: []; sources: [edge: EdgeNode] }>();

/** How many articles a relation is cited to. An edge that predates
 * `references`, or one the graph returned without it, counts as none rather
 * than breaking the row. */
function sourceCount(edge: EdgeNode) {
  return edge.references?.length ?? 0;
}

const edgesSorted = computed(() => {
  return props.edges.toSorted((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;

    return b.start_date.localeCompare(a.start_date);
  });
});

const minStart = computed(() => {
  return edgesSorted.value
    .map((e) => e.start_date)
    .filter((d): d is string => !!d)
    .toSorted((a, b) => a?.localeCompare(b))[0];
});

const maxEnd = computed(() => {
  return new Date().toISOString().split("T")[0];
});

function edgeLabel(edge: EdgeNode) {
  return edge.label;
}

/** The party a candidacy was run for, on the edges that assert one.
 *
 * Only `election` edges carry it in the schema, but the check is explicit: a
 * hand-made edge of another type that picked up a stray `party` should not
 * start rendering a party chip on somebody's profile.
 */
function partyOf(edge: EdgeNode): string | undefined {
  return edge.type === "election" ? edge.party || undefined : undefined;
}

/** The electoral committee a candidacy was run under.
 *
 * Shown next to the party rather than instead of it: `party` is the national
 * brand a committee was mapped onto, `committee` its full registered name, and
 * for a local committee ("KWW Wspólny Kalisz") there is no party at all. Both
 * are dropped when they say the same thing, which is the case for the committees
 * whose name *is* the party.
 */
function committeeOf(edge: EdgeNode): string | undefined {
  if (edge.type !== "election" || !edge.committee) return undefined;
  const party = partyOf(edge);
  if (party && party.toLowerCase() === edge.committee.toLowerCase()) {
    return undefined;
  }
  return edge.committee;
}

/** Whether the edge asserts a period at all.
 *
 * The card lists every relation a person has, not only the employment it is
 * named after, and some kinds carry no dates by construction - a `connection`
 * has no date fields in the schema. Drawing a full-width bar for those claims a
 * span nobody recorded, so they get the label and nothing else. */
function isDated(edge: EdgeNode): boolean {
  return !!(edge.start_date || edge.end_date);
}

/** The company behind an edge, when the edge leads to one at all. */
function asCompany(edge: EdgeNode): Company | undefined {
  return edge.richNode.type === "place"
    ? (edge.richNode as Company)
    : undefined;
}
</script>
