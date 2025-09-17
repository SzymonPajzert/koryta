<template>
  <v-dialog v-model="visible" max-width="500">
    <EmployedDetail
      v-if="node"
      :node="node"
      :close="
        () => {
          visible = false;
        }
      "
    />
  </v-dialog>
</template>

<script lang="ts" setup>
const visible = ref(false);
const node = ref<string | undefined>();

// This exposes the node setting option, so the users of this component can just call it.
defineExpose({
  setNode: function (nodeId: string) {
    node.value = nodeId;
    visible.value = true;
  },
});
</script>
