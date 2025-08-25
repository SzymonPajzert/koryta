import type {
  ForceNodeDatum,
  ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";
import type * as d3 from "d3-force";

type d3Type = typeof d3;

type CreateSimulationFunction = (
  d3: d3Type,
  nodes: ForceNodeDatum[],
  edges: ForceEdgeDatum[],
) => d3.Simulation<ForceNodeDatum, ForceEdgeDatum>;

export const target = 0.001 as const;
export const log_target = -3 as const;

export function simulation(
  initial: boolean,
  tick?: (currentAlpha: number) => void,
  done?: () => void,
): CreateSimulationFunction {
  return (d3, nodes, edges) => {
    // d3-force parameters
    const forceLink = d3
      .forceLink<ForceNodeDatum, ForceEdgeDatum>(edges)
      .id((d: ForceNodeDatum) => d.id);

    const commonConfig = d3
      .forceSimulation(nodes)
      .force("edge", forceLink.distance(80).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter().strength(0.3))
      .force("x", d3.forceX().strength(0.02))
      .force("y", d3.forceY().strength(0.02));

    let result;
    if (initial) {
      result = commonConfig
        .velocityDecay(0.2)
        .alphaDecay(0.001)
        .stop()
        .tick(10000);
    } else {
      result = commonConfig.velocityDecay(0.5).alphaDecay(0.01);
    }

    if (tick) {
      result.on("tick.monitor", () => {
        tick(result.alpha());
      });
    }
    if (done) {
      result.on("end.monitor", done);
    }

    return result;
  };
}
