import { describe, it, expect, vi } from "vitest";
import { simulation, target, log_target } from "~~/shared/graph/simulation";
import type {
  ForceNodeDatum,
  ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";

describe("shared/graph/simulation.ts", () => {
  it("exports constants", () => {
    expect(target).toBe(0.001);
    expect(log_target).toBe(-3);
  });

  describe("simulation function", () => {
    // Mock the fluid d3 interfaces
    const createD3Mock = () => {
      const linkForceMock = {
        id: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
      };

      const simulationMock = {
        force: vi.fn().mockReturnThis(),
        velocityDecay: vi.fn().mockReturnThis(),
        alphaDecay: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
        tick: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        alpha: vi.fn().mockReturnValue(0.5),
      };

      const d3Mock = {
        forceLink: vi.fn().mockReturnValue(linkForceMock),
        forceSimulation: vi.fn().mockReturnValue(simulationMock),
        forceManyBody: vi
          .fn()
          .mockReturnValue({ strength: vi.fn().mockReturnThis() }),
        forceCenter: vi
          .fn()
          .mockReturnValue({ strength: vi.fn().mockReturnThis() }),
        forceX: vi.fn().mockReturnValue({ strength: vi.fn().mockReturnThis() }),
        forceY: vi.fn().mockReturnValue({ strength: vi.fn().mockReturnThis() }),
      };

      return { d3Mock, simulationMock, linkForceMock };
    };

    it("should create simulation with common config", () => {
      const { d3Mock, simulationMock, linkForceMock } = createD3Mock();
      const nodes: ForceNodeDatum[] = [{ id: "n1" }];
      const edges: ForceEdgeDatum[] = [{ source: "n1", target: "n2" }];

      const simFn = simulation(false);

      // @ts-expect-error Mocking d3 interface is sufficient for test
      const result = simFn(d3Mock, nodes, edges);

      expect(d3Mock.forceLink).toHaveBeenCalledWith(edges);
      expect(linkForceMock.id).toHaveBeenCalled();
      expect(d3Mock.forceSimulation).toHaveBeenCalledWith(nodes);

      expect(simulationMock.force).toHaveBeenCalledWith(
        "edge",
        expect.anything(),
      );
      expect(simulationMock.force).toHaveBeenCalledWith(
        "charge",
        expect.anything(),
      );
      expect(simulationMock.force).toHaveBeenCalledWith(
        "center",
        expect.anything(),
      );
      expect(simulationMock.force).toHaveBeenCalledWith("x", expect.anything());
      expect(simulationMock.force).toHaveBeenCalledWith("y", expect.anything());

      expect(result).toBe(simulationMock);
    });

    it("should use initial config when initial is true", () => {
      const { d3Mock, simulationMock } = createD3Mock();
      const simFn = simulation(true);
      // @ts-expect-error Mocking d3 interface is sufficient for test
      simFn(d3Mock, [], []);

      expect(simulationMock.velocityDecay).toHaveBeenCalledWith(0.2);
      expect(simulationMock.alphaDecay).toHaveBeenCalledWith(0.001);
      expect(simulationMock.stop).toHaveBeenCalled();
      expect(simulationMock.tick).toHaveBeenCalledWith(10000);
    });

    it("should use non-initial config when initial is false", () => {
      const { d3Mock, simulationMock } = createD3Mock();
      const simFn = simulation(false);
      // @ts-expect-error Mocking d3 interface is sufficient for test
      simFn(d3Mock, [], []);

      expect(simulationMock.velocityDecay).toHaveBeenCalledWith(0.5);
      expect(simulationMock.alphaDecay).toHaveBeenCalledWith(0.01);
      expect(simulationMock.stop).not.toHaveBeenCalled();
      expect(simulationMock.tick).not.toHaveBeenCalled();
    });

    it("should register tick callback if provided", () => {
      const { d3Mock, simulationMock } = createD3Mock();
      const tickCallback = vi.fn();

      const simFn = simulation(false, tickCallback);
      // @ts-expect-error Mocking d3 interface is sufficient for test
      simFn(d3Mock, [], []);

      expect(simulationMock.on).toHaveBeenCalledWith(
        "tick.monitor",
        expect.any(Function),
      );

      // Simulate the tick event firing
      const onCall = simulationMock.on.mock.calls.find(
        (c) => c[0] === "tick.monitor",
      );
      expect(onCall).toBeDefined();
      if (onCall) {
        onCall[1](); // Call the callback
        expect(simulationMock.alpha).toHaveBeenCalled();
        expect(tickCallback).toHaveBeenCalledWith(0.5); // alpha value
      }
    });

    it("should register done callback if provided", () => {
      const { d3Mock, simulationMock } = createD3Mock();
      const doneCallback = vi.fn();

      const simFn = simulation(false, undefined, doneCallback);
      // @ts-expect-error Mocking d3 interface is sufficient for test
      simFn(d3Mock, [], []);

      expect(simulationMock.on).toHaveBeenCalledWith(
        "end.monitor",
        doneCallback,
      );
    });

    it("should call the id extractor properly", () => {
      const { d3Mock, linkForceMock } = createD3Mock();
      const simFn = simulation(false);
      // @ts-expect-error Mocking d3 interface is sufficient for test
      simFn(d3Mock, [], []);

      const idExtractor = linkForceMock.id.mock.calls[0][0];
      expect(idExtractor({ id: "test-node" })).toBe("test-node");
    });
  });
});
