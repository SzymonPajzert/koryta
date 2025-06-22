<script setup lang="ts">
  import { useListEmployment } from '@/composables/party'
  import { useListEntity, type Nameable } from '@/composables/entity'
  import { defineConfigs } from 'v-network-graph'
  const { people } = useListEmployment()
  const { entities: companies } = useListEntity('company')

  const nodes = computed(() => {
    const result: Record<string, Nameable> = {}
    Object.entries(people.value).forEach(([key, person]) => {
      result[key] = person
    })
    if (!companies.value) return result
    Object.entries(companies.value).forEach(([key, company]) => {
      result[key] = company
    })
    return result
  })

  const edges = computed(() => {
    //     edge1: { source: "node1", target: "node2" },
    const result : { source: string, target: string }[] = []

    Object.entries(people.value).forEach(([key, person]) => {
      Object.values(person.employments ?? {}).forEach((connection) => {
        if (connection?.connection?.id) {
          console.log("found")
          result.push({ source: key, target: connection.connection.id })
        }
      })
      Object.values(person.connections ?? {}).forEach((connection) => {
        if (connection?.connection?.id) {
          console.log("found")
          result.push({ source: key, target: connection.connection.id })
        }
      })
    })

    return result
  })

  const configs = defineConfigs({
    node: {
      label: {
        color: "#fff"
      }
    }
  })
</script>

<template>
  <v-network-graph
    class="graph"
    :nodes="nodes"
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
