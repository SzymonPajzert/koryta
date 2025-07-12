<template>
  <v-navigation-drawer location="right" width="300" permanent>
    <v-checkbox
      v-model="showActiveArticles"
      label="Pokaż aktywne artykuły"
    ></v-checkbox>
    <v-checkbox
      v-model="showInactiveArticles"
      label="Pokaż nieaktywne artykuły"
    ></v-checkbox>
    <v-btn v-model="runSimulation" @click="runSimulation = !runSimulation" v-if="route.path.startsWith('/zobacz/graf')">
      Uporządkuj wierzchołki
      <v-progress-linear
        v-model="simulationProgress"
        :active="runSimulation"
        color="deep-purple-accent-4"
        location="bottom"
        absolute
      ></v-progress-linear>
    </v-btn>
    <PlaceFilter />
  </v-navigation-drawer>
  <RouterView></RouterView>
</template>

<script setup lang="ts">
import { useGraphStore } from "@/stores/graph";
import { useSimulationStore } from "@/stores/simulation";

const graphStore = useGraphStore();
const simulationStore = useSimulationStore();

const { nodeGroups, showActiveArticles, showInactiveArticles, nodeGroupPicked } = storeToRefs(graphStore)
const { runSimulation, simulationProgress} = storeToRefs(simulationStore)

const router = useRouter()
const route = useRoute<'/zobacz/graf/[[id]]' | '/zobacz/lista/[[id]]'>()

onMounted(() => {
  const params = route.params
  if (params.id) {
    nodeGroupPicked.value = nodeGroups.value.find(x => x.id == params.id)
  }
})

watch(nodeGroupPicked, (value) => {
  const params = value ? { id: value.id } : {}
  router.push({ name: route.name, params: params })
})
</script>
