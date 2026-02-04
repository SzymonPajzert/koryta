<template>
  <div class="d-flex flex-column gap-2">
    <!-- Initial Buttons to pick edge type for a given node type -->
    <v-btn
      v-for="button in filteredButtons"
      :key="button.edgeType + '-' + button.direction"
      variant="tonal"
      :prepend-icon="button.icon"
      color="primary"
      class="mb-2"
      @click="startAddEdge(button.edgeType, button.direction)"
    >
      {{ button.text }}
    </v-btn>
  </div>
</template>

<script lang="ts" setup>
import type { NodeType } from "~~/shared/model";

const props = defineProps<{
  nodeId: string;
  nodeType: NodeType;
  nodeName?: string;
}>();

const newEdgeButtons = computed(() =>
  useEdgeButtons(props.nodeName || "Ten węzeł"),
);

const filteredButtons = computed(() =>
  newEdgeButtons.value.filter((b) => b.nodeType === effectiveNodeType.value),
);
</script>
