<script setup lang="ts">
import { defineConfigs } from "v-network-graph";
import  {
  type EventHandlers,
  type NodeEvent,
  type ViewEvent,
  type LayoutHandler,
  SimpleLayout
} from "v-network-graph";
import {
  ForceLayout,
  type ForceNodeDatum,
  type ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";
import * as d3 from "d3-force";

import { useDialogStore } from "@/stores/dialog";
import { useGraph } from "@/composables/graph";

const dialogStore = useDialogStore();

// TODO read this from user config
const showActiveArticles = ref(false);
const showInactiveArticles = ref(false);
const runSimulation = ref(true)

const { nodes, edges } = useGraph(showActiveArticles, showInactiveArticles);


const handleNodeClick = ({ node }: NodeEvent<MouseEvent>) => {
  dialogStore.openExisting(node);
};

type d3Type = typeof d3;

type CreateSimulationFunction = (
  d3: d3Type,
  nodes: ForceNodeDatum[],
  edges: ForceEdgeDatum[]
) => d3.Simulation<ForceNodeDatum, ForceEdgeDatum>;

const simulationProgress = ref(0);
function simulation(initial: boolean): CreateSimulationFunction {
  return (d3, nodes, edges) => {
    // d3-force parameters
    const forceLink = d3
      .forceLink<ForceNodeDatum, ForceEdgeDatum>(edges)
      .id((d: any) => d.id);

    const target = 0.001
    const log_target = Math.log10(target)

    const temporary = d3
      .forceSimulation(nodes)
      .force("edge", forceLink.distance(80).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter().strength(0.3))
      .force("x", d3.forceX().strength(0.02))
      .force("y", d3.forceY().strength(0.02))

    let result;
    if (initial) {
      result = temporary
        .velocityDecay(0.2)
        .alphaDecay(0.003)
        .stop()
        .tick(3000)
        .restart();
    } else {
      result = temporary
        .alphaDecay(0.05)
    }

    result.on("tick.monitor", () => {
      const currentAlpha = result.alpha();
      // we start from 1, i.e log 0, the target can be 0.001 i.e -3 (log_target)
      const linear = Math.log10(currentAlpha) / log_target
      simulationProgress.value = 100 * linear;
    })
    result.on("end.monitor", () => {
      runSimulation.value = false
      simulationProgress.value = 0
    })

    return result;
  };
}

const newForceLayout = (initial: boolean) => new ForceLayout({
  positionFixedByDrag: false,
  positionFixedByClickWithAltKey: true,
  createSimulation: simulation(initial),
})

const handleDoubleClick = (event : ViewEvent<MouseEvent>) => {
  dialogStore.openMain()
}

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "view:dblclick": handleDoubleClick,
};

const configs = reactive(defineConfigs({
  node: {
    normal: {
      type: (node) => node.type,
      width: (node) => (node.sizeMult ?? 1) * 32,
      height: (node) => (node.sizeMult ?? 1) * 32,
      color: (node) => node.color,
    },
    label: {
      color: "#fff",
    },
  },
  edge: {
    label: {
      fontSize: 11,
      color: "#fff",
    },
  },
  view: {
    scalingObjects: true,
    layoutHandler: newForceLayout(true) as LayoutHandler,
    doubleClickZoomEnabled: false,
  },
}));

watch(runSimulation, (value) => {
  if(value) {
    configs.view.layoutHandler = newForceLayout(false)
  } else {
    configs.view.layoutHandler = new SimpleLayout()
  }
})
</script>

<template>
  <v-navigation-drawer
    location="right"
    permanent>
    <v-checkbox
      v-model="showActiveArticles"
      label="Pokaż aktywne artykuły"
    ></v-checkbox>
    <v-checkbox
      v-model="showInactiveArticles"
      label="Pokaż nieaktywne artykuły"
    ></v-checkbox>
    <v-btn v-model="runSimulation" @click="runSimulation = !runSimulation">
      Symuluj wierzchołki
      <v-progress-linear
        v-model="simulationProgress"
        :active="runSimulation"
        color="deep-purple-accent-4"
        location="bottom"
        absolute
      ></v-progress-linear>
    </v-btn>
  </v-navigation-drawer>
  <v-network-graph
    :nodes="nodes"
    :edges="edges"
    :configs="configs"
    :eventHandlers="eventHandlers"
  >
    <template #edge-label="{ edge, ...slotProps }">
      <v-edge-label
        :text="edge.label"
        align="center"
        vertical-align="above"
        v-bind="slotProps"
      />
    </template>
  </v-network-graph>

</template>
