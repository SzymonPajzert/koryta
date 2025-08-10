import { ForceLayout } from "v-network-graph/lib/force-layout";
import { simulation, log_target } from "~~/shared/graph/simulation";

export const useSimulationStore = defineStore("simulation", () => {
  const simulationProgress = ref(0);
  const runSimulation = ref(true);

  function newForceLayout(initial: boolean) {
    return new ForceLayout({
      positionFixedByDrag: false,
      positionFixedByClickWithAltKey: true,
      createSimulation: simulation(
        initial,
        (currentAlpha: number) => {
          // we start from 1, i.e log 0, the target can be 0.001 i.e -3 (log_target)
          const linear = Math.log10(currentAlpha) / log_target;
          simulationProgress.value = 100 * linear;
        },
        () => {
          runSimulation.value = false;
          simulationProgress.value = 0;
        },
      ),
    });
  }

  return { simulationProgress, runSimulation, newForceLayout };
});
