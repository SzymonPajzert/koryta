import {
  ForceLayout,
  type ForceNodeDatum,
  type ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";
import * as d3 from "d3-force";

type d3Type = typeof d3;

type CreateSimulationFunction = (
  d3: d3Type,
  nodes: ForceNodeDatum[],
  edges: ForceEdgeDatum[]
) => d3.Simulation<ForceNodeDatum, ForceEdgeDatum>;

export const useSimulationStore = defineStore("simulation", () => {
  const simulationProgress = ref(0);
  const runSimulation = ref(true);

  function simulation(initial: boolean): CreateSimulationFunction {
    return (d3, nodes, edges) => {
      // d3-force parameters
      const forceLink = d3
        .forceLink<ForceNodeDatum, ForceEdgeDatum>(edges)
        .id((d: any) => d.id);

      const target = 0.001;
      const log_target = Math.log10(target);

      const temporary = d3
        .forceSimulation(nodes)
        .force("edge", forceLink.distance(80).strength(0.3))
        .force("charge", d3.forceManyBody().strength(-400))
        .force("center", d3.forceCenter().strength(0.3))
        .force("x", d3.forceX().strength(0.02))
        .force("y", d3.forceY().strength(0.02));

      let result;
      if (initial) {
        result = temporary
          .velocityDecay(0.2)
          .alphaDecay(0.003)
          .stop()
          .tick(3000)
          .restart();
      } else {
        result = temporary.alphaDecay(0.05);
      }

      result.on("tick.monitor", () => {
        const currentAlpha = result.alpha();
        // we start from 1, i.e log 0, the target can be 0.001 i.e -3 (log_target)
        const linear = Math.log10(currentAlpha) / log_target;
        simulationProgress.value = 100 * linear;
      });
      result.on("end.monitor", () => {
        runSimulation.value = false;
        simulationProgress.value = 0;
      });

      return result;
    };
  }

  const newForceLayout = (initial: boolean) =>
    new ForceLayout({
      positionFixedByDrag: false,
      positionFixedByClickWithAltKey: true,
      createSimulation: simulation(initial),
    });

  return { simulationProgress, runSimulation, simulation, newForceLayout }
});
