<template>
  <v-navigation-drawer location="right" width="300" permanent>
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

const { nodeGroups } = storeToRefs(graphStore)
const { runSimulation, simulationProgress} = storeToRefs(simulationStore)

const router = useRouter()
const route = useRoute<'/zobacz/graf/[[id]]' | '/zobacz/lista/[[id]]'>()
</script>
