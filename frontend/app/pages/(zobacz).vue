<template>
  <v-navigation-drawer :location="location" :width="width" permanent>
    <PlaceFilter />
    <OpenAbstractDialog dialog="data" />
    <OpenAbstractDialog dialog="todo" />
    <OpenAbstractDialog dialog="employed" />
    <OpenAbstractDialog dialog="company" />
    <v-btn
      v-model="runSimulation"
      @click="runSimulation = !runSimulation"
      v-show="route.meta.isGraph"
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
    <v-select
      label="Typ problemu"
      v-model="allowedIssues"
      :items="issueNames"
      multiple
      v-show="route.meta.isHelp"
    />
  </v-navigation-drawer>
  <RouterView :allowedIssues="allowedIssues"></RouterView>
</template>

<script setup lang="ts">
import { useSimulationStore } from "@/stores/simulation";
import { useDrawer } from "@/composables/drawer";
import { useEntityStatus } from "@/composables/entities/status";

const { issueNames } = useEntityStatus();
const { width, location } = useDrawer();
const simulationStore = useSimulationStore();
const { runSimulation, simulationProgress } = storeToRefs(simulationStore);

const route = useRoute();
const allowedIssues = ref<string[]>([]);
</script>
