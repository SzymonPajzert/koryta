<template>
  <v-card
    :key="edge.richNode.id"
    :prepend-icon="entityIcon(edge.richNode.type)"
    :to="nodeLinkUrl(edge.richNode)"
  >
    <template #title>{{ edge.richNode.name }}</template>
    <template #subtitle>
      <div v-if="edge.type === 'election'" class="d-flex flex-wrap gap-x-2">
        <v-chip v-if="edge.party" size="x-small" density="compact" class="mr-1">
          {{ edge.party }}
        </v-chip>
        <span v-if="edge.position" class="font-weight-bold mr-1">{{
          edge.position
        }}</span>
        <span v-if="edge.term" class="text-caption">({{ edge.term }})</span>
      </div>
      <div>{{ edge.label }}</div>
      <div v-if="edge.start_date || edge.end_date" class="text-caption">
        {{ edge.start_date }} - {{ edge.end_date || "obecnie" }}
      </div>
    </template>
    <!-- Admins only. The card itself is a link to the other end, so this stops
         the click rather than letting it navigate away from the relation it is
         about - same as the sources button on a person's rows. -->
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
    <v-card-text v-if="edge.richNode.content">
      {{ edge.richNode.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { mdiTrashCanOutline } from "@mdi/js";
import type { EdgeNode } from "~/composables/edges";
import { entityIcon } from "~/utils/entityIcon";
import { nodeLinkUrl } from "~/composables/slugs";

const { edge, canRemove } = defineProps<{
  edge: EdgeNode;
  /** Whether the card offers taking the relation off the graph outright, which
   * is an administrator's decision and nobody else's. */
  canRemove?: boolean;
}>();

const emit = defineEmits<{ remove: [edge: EdgeNode] }>();
</script>
