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
      <v-list density="compact">
        <v-list-item
          v-for="edge in edgesShown"
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
               company. -->
          <ChipCompanyCategories :company="edgeCompany(edge)" />

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
      <!-- What the cap left out. A link rather than a "show more", because the
           rows past the cap are the ones nobody scrolls to, and the table is
           the surface built for reading a region at length. -->
      <v-card-text v-if="hiddenCount > 0" class="pt-0">
        <NuxtLink v-if="moreHref" :to="moreHref" class="text-caption">
          … i {{ hiddenCount }} {{ relationsPlural(hiddenCount) }} więcej
        </NuxtLink>
        <span v-else class="text-caption text-medium-emphasis">
          … i {{ hiddenCount }} {{ relationsPlural(hiddenCount) }} więcej
        </span>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiPlus, mdiTrashCanOutline } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import { edgeCompany, type EdgeNode } from "~~/app/composables/edges";
import { nodeLinkUrl } from "~/composables/slugs";
import { relationsPlural } from "~/composables/edges";

const { edges, title, canRemove, limit } = defineProps<{
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
  /** Most rows to render, if the list should not be rendered whole.
   *
   * A region is why this exists. Warszawa has 758 relations and every one of
   * them would reach the markup: at the ~4 KB of html a row costs - measured
   * across three prod company pages of 8, 15 and 24 relations - that page
   * would go out at about 3 MB. Absent by default, so a person or a company
   * still renders every relation it has; none of them comes near that.
   */
  limit?: number;
  /** Where the rows past `limit` can be read instead. */
  moreHref?: string;
}>();

const emit = defineEmits<{ add: []; remove: [edge: EdgeNode] }>();

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

const edgesShown = computed(() =>
  limit === undefined ? edgesSorted.value : edgesSorted.value.slice(0, limit),
);
const hiddenCount = computed(
  () => edgesSorted.value.length - edgesShown.value.length,
);
</script>
