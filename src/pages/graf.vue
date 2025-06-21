<script setup lang="ts">
  import { useListEmployment } from '@/composables/party'
  import { defineConfigs } from 'v-network-graph'
  const { people } = useListEmployment()

  const configs = defineConfigs({
    node: {
      label: {
        color: "#fff"
      }
    }
  })


  const edges = {
    edge1: { source: "node1", target: "node2" },
    edge2: { source: "node2", target: "node3" },
    edge3: { source: "node3", target: "node4" },
  }
</script>

<template>
  <v-network-graph
    class="graph"
    :nodes="people"
    :edges="edges"
    :configs="configs"
  />
</template>

<style>
.graph {
  width: 800px;
  height: 600px;
  border: 1px solid #000;
}
</style>
