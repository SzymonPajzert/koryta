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
import type { EdgeNode } from "~~/app/composables/edges";
import { nodeLinkUrl } from "~/composables/slugs";

const { edges, title, canRemove } = defineProps<{
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
</script>
