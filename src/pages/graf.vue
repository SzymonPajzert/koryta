<script setup lang="ts">
import { useListEmployment } from "@/composables/party";
import { useListEntity } from "@/composables/entity";
import { type Company } from '@/composables/model'
import { defineConfigs, type Node as vNGNode, type EventHandlers, type NodeEvent } from "v-network-graph";
import {
  ForceLayout,
  type ForceNodeDatum,
  type ForceEdgeDatum,
} from "v-network-graph/lib/force-layout"; // Corrected import path for ForceLayout
import {usePartyStatistics} from '@/composables/party'
import UserDetailDialog from '@/components/dialog/UserDetailDialog.vue'

const { people } = useListEmployment();
const { entities: companies } = useListEntity("company");

interface Node extends vNGNode {
  type: "circle" | "rect"
  color: string
}

const { partyColors } = usePartyStatistics()

const nodes = computed(() => {
  const result: Record<string, Node> = {};
  Object.entries(people.value).forEach(([key, person]) => {
    result[key] = {
      ...person,
      type: "circle",
      color: person.parties && person.parties.length > 0 ? partyColors.value[person.parties[0]] : "#4466cc"
    };
  });
  if (!companies.value) return result;
  Object.entries(companies.value).forEach(([key, company]) => {
    result[key] = {
      ...company,
      type: "rect",
      color: "gray"
    };
  });
  return result;
});

const edges = computed(() => {
  //     edge1: { source: "node1", target: "node2" },
  const result: { source: string; target: string; label: string }[] = [];

  Object.entries(people.value).forEach(([key, person]) => {
    Object.values(person.employments ?? {}).forEach((connection) => {
      if (connection?.connection?.id) {
        result.push({
          source: key,
          target: connection.connection.id,
          label: connection.relation,
        });
      }
    });
    Object.values(person.connections ?? {}).forEach((connection) => {
      if (connection?.connection?.id) {
        result.push({
          source: key,
          target: connection.connection.id,
          label: connection.relation,
        });
      }
    });
  });

  Object.entries(companies.value ?? {}).forEach(([key, company]) => {
    if (company.manager) result.push({
      source: key,
      target: company.manager.id,
      label: "zarządzający",
    });
    if (company.owner) result.push({
      source: key,
      target: company.owner.id,
      label: "właściciel",
    });
  })

  return result;
});

const dialog = ref<typeof UserDetailDialog>();

const handleNodeClick = ({node}: NodeEvent<MouseEvent>) => {
  console.log("click")
  if (dialog.value) dialog.value.setNode(node)
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
}

const configs = defineConfigs({
  node: {
    normal: {
      type: node => node.type,
      color: node => node.color,
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
    layoutHandler: new ForceLayout({
      positionFixedByDrag: false,
      positionFixedByClickWithAltKey: true,
      createSimulation: (d3, nodes, edges) => {
        // d3-force parameters
        const forceLink = d3
          .forceLink<ForceNodeDatum, ForceEdgeDatum>(edges)
          .id((d: any) => d.id);
        return d3
          .forceSimulation(nodes)
          .force("edge", forceLink.distance(80).strength(0.3))
          .force("charge", d3.forceManyBody().strength(-400))
          .force("center", d3.forceCenter().strength(0.3))
          .force("x", d3.forceX().strength(0.02))
          .force("y", d3.forceY().strength(0.02))
          .alpha(1)
          .velocityDecay(0.2)
          .alphaDecay(0.0001)
      },
    }),
  },
});
</script>

<template>
  <UserDetailDialog ref="dialog"></UserDetailDialog>

  <v-network-graph
    :nodes="nodes"
    :edges="edges"
    :configs="configs"
    :eventHandlers="eventHandlers"
  >
    <template #edge-label="{ edge, ...slotProps }">
      <v-edge-label :text="edge.label" align="center" vertical-align="above" v-bind="slotProps" />
    </template>
  </v-network-graph>
</template>
