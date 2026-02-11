<template>
  <!-- Render Fixed Node it's already set -->
  <div v-if="nodeName" class="d-flex flex-column align-center w-100">
    <v-chip
      class="mb-1 text-truncate"
      style="max-width: 100%"
      color="primary"
      variant="outlined"
    >
      {{ nodeName }}
    </v-chip>
    <div class="text-caption text-medium-emphasis">
      {{ label || "Źródło" }}
    </div>
  </div>

  <!-- Render Picker we need to pick it -->
  <div v-else class="w-100">
    <FormEntityPicker
      v-model="pickedNode"
      :entity="nodeType"
      :label="`Wyszukaj ${nodeType === 'person' ? 'osobę' : nodeType === 'place' ? 'firmę' : nodeType === 'region' ? 'region' : 'obiekt'}`"
      density="compact"
      hide-details
      v-bind="$attrs"
    />
    <div class="text-caption text-medium-emphasis mt-1">
      {{ label || "Źródło" }}
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeType, Link } from "~~/shared/model";

defineProps<{
  nodeName?: string;
  nodeType: NodeType;
  label?: string;
}>();

const pickedNode = defineModel<Link<NodeType> | undefined>({
  default: undefined,
});
</script>
