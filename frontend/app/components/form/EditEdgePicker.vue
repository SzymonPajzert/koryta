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
      :data-testid="'edge-picker-' + button.edgeType"
      @click="startAddEdge(button.edgeType, button.direction)"
    >
      {{ button.text }}
    </v-btn>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type { NodeType } from "~~/shared/model";
import { useEdgeButtons } from "~/composables/useEdgeTypes";

const props = defineProps<{
  nodeId: string;
  nodeType: NodeType;
  nodeName?: string;
}>();

const emit = defineEmits<{
  (e: "pick", edgeType: string, direction: string): void;
}>();

const newEdgeButtons = computed(() =>
  useEdgeButtons(props.nodeName || "Ten węzeł"),
);

const effectiveNodeType = computed(() => props.nodeType);

const filteredButtons = computed(() =>
  newEdgeButtons.value.filter((b) => b.nodeType === effectiveNodeType.value),
);

function startAddEdge(edgeType: string, direction: string) {
  emit("pick", edgeType, direction);
}
</script>
