<template>
  <v-navigation-drawer :location="location" :width="width" permanent>
    <PlaceFilter />
    <OpenAbstractDialog dialog="data" />
    <OpenAbstractDialog dialog="employed" />
    <OpenAbstractDialog dialog="company" />
    <v-btn
      v-show="route.meta.isGraph"
      v-model="runSimulation"
      @click="runSimulation = !runSimulation"
    >
      Uporządkuj wierzchołki
      <v-progress-linear
        v-model="simulationProgress"
        :active="runSimulation"
        color="deep-purple-accent-4"
        location="bottom"
        absolute
      />
    </v-btn>
    <v-select
      v-show="route.meta.isHelp"
      v-model="allowedIssues"
      label="Typ problemu"
      :items="issueNames"
      multiple
    />
  </v-navigation-drawer>
  <RouterView :allowed-issues="allowedIssues"/>
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
