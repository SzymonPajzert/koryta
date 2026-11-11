<template>
  <div v-if="edges.length > 0 || canAdd" class="mb-4">
    <div class="d-flex align-center justify-space-between mb-2">
      <h3 class="text-h6">{{ title }}</h3>
      <v-btn
        v-if="canAdd"
        variant="text"
        size="small"
        color="primary"
        :prepend-icon="mdiPlus"
        :data-testid="`add-relation-${addTestid}`"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </div>
    <v-card v-if="edges.length > 0">
      <v-list density="compact" class="connection-list">
        <v-list-item
          v-for="edge in edgesSorted"
          :key="edge.richNode.id"
          :to="nodeLinkUrl(edge.richNode)"
          :prepend-icon="entityIcon(edge.richNode.type)"
        >
          <v-list-item-title>
            {{ edge.richNode.name }}
            <span v-if="getPeopleCount(edge) > 0" class="text-medium-emphasis">
              ({{ getPeopleCount(edge) }})
            </span>
          </v-list-item-title>
          <!-- Which sector the institution belongs to. The rows here are a
               company's owners and subsidiaries, or a region's institutions,
               and the sector is what tells a reader apart two registry names
               that differ by one word. Draws nothing for a row that is not a
               company.

               Where the relation is a founder's rather than a shareholder's,
               the line under the name says so first, then the sector: a row
               has one such word at most (Szymon, 2026-11-11, board round
               public-founders-label-r3). Under the name rather than after it,
               because on a phone the name line ends in an ellipsis and the
               word would go with it. -->
          <div
            v-if="founderText(edge)"
            class="d-flex flex-wrap align-center ga-1"
          >
            <span
              class="text-body-2 text-medium-emphasis mr-1"
              data-testid="founder-label"
            >
              {{ founderText(edge) }}
            </span>
            <ChipCompanyCategories :company="edgeCompany(edge)" />
          </div>
          <ChipCompanyCategories v-else :company="edgeCompany(edge)" />
          <!-- Whether the relation itself is live, and an admin's way to make
               it so. Beside the sector chip rather than in the append slot: the
               append slot is where the controls that take something away
               live. -->
          <ChipEdgeDraftStatus
            :edge-id="edge.id"
            :published="edge.visibility"
            :publishable="edgeIsPublishable(edge, subjectPublished)"
            @published="emit('published')"
          />

          <!-- Admins only. The row is a link to the other end, so this stops
               the click rather than letting it navigate away. -->
          <template v-if="edge.id && canRemove" #append>
            <v-btn
              variant="text"
              size="small"
              color="error"
              title="Usuń powiązanie"
              :icon="mdiTrashCanOutline"
              :data-testid="`edge-remove-${edge.id}`"
              @click.stop.prevent="emit('remove', edge)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiPlus, mdiTrashCanOutline } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import {
  edgeCompany,
  edgeIsPublishable,
  type EdgeNode,
} from "~~/app/composables/edges";
import { nodeLinkUrl } from "~~/shared/slugs";

const { edges, title, canRemove, subjectPublished, founderLabel } =
  defineProps<{
    title: string;
    edges: EdgeNode[];
    /** Whether this section offers adding a relation of its own kind. */
    canAdd?: boolean;
    /** Suffix for the add button's test hook, since a page renders several of
     * these and they would otherwise be indistinguishable. */
    addTestid?: string;
    /** Whether each row offers taking the relation off the graph outright, which
     * is an administrator's decision and nobody else's. */
    canRemove?: boolean;
    /** Whether the page these relations hang off is itself published. See the
     * same prop on `CardEmploymentHistory`. */
    subjectPublished?: boolean;
    /** What a row whose relation is a founder's says about it: „Fundator” on a
     * foundation's owners, „założona” on its founder's subsidiaries. A founder
     * holds no shares, so a list of owners or of subsidiaries has to say so; a
     * list that passes nothing draws a founder's row like any other. A function
     * because the word agrees with the row - see `utils/founders.ts`. */
    founderLabel?: (edge: EdgeNode) => string;
  }>();

const emit = defineEmits<{
  add: [];
  remove: [edge: EdgeNode];
  /** A row went live; the caller refetches if it draws the relation twice. */
  published: [];
}>();

/** What the row says about its relation, where it is a founder's. */
function founderText(edge: EdgeNode): string | undefined {
  if (!founderLabel || edge.type !== "owns" || edge.founder !== true) {
    return undefined;
  }
  return founderLabel(edge);
}

function getPeopleCount(edge: EdgeNode) {
  const stats = edge.richNode.stats as
    | {
        nodeGroupSize?: number;
        people?: number;
      }
    | undefined;
  return stats?.nodeGroupSize ?? stats?.people ?? 0;
}

const edgesSorted = computed(() => {
  return [...edges].sort((a, b) => {
    const countDiff = getPeopleCount(b) - getPeopleCount(a);
    if (countDiff !== 0) return countDiff;
    return (a.richNode.name || "").localeCompare(b.richNode.name || "");
  });
});
</script>

<style scoped>
/* On a phone the row's icon gives way to the name: the 24px icon and its 32px
   gap took a sixth of the width, and long institutional names were cut short.
   The desktop keeps it. Picked by Szymon on 2026-11-11 over a smaller icon and
   Vuetify's slim gap (board round public-founders-label-r2). */
@media (max-width: 599.98px) {
  .connection-list :deep(.v-list-item__prepend) {
    display: none;
  }
}
</style>
