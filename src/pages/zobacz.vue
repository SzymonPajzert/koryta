<template>
  <v-navigation-drawer
    :location="location"
    :width="width"
    permanent
  >
    <v-btn
      v-model="runSimulation"
      @click="runSimulation = !runSimulation"
      v-if="route.path.startsWith('/zobacz/graf')"
    >
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
import { useSimulationStore } from "@/stores/simulation";
import { useDrawer } from "@/composables/drawer";

const { width, location } = useDrawer();
const simulationStore = useSimulationStore();
const { runSimulation, simulationProgress } = storeToRefs(simulationStore);

const route = useRoute<"/zobacz/graf/[[id]]" | "/zobacz/lista/[[id]]">();
</script>
