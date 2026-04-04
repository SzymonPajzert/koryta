import { describe, it, expect } from "vitest";
import { getNodeGroups, getEdges, getNodesNoStats } from "~~/shared/graph/util";
import type { Person, Company, Region, Edge as DBEdge } from "~~/shared/model";

describe("graph utils", () => {
  describe("getNodeGroups", () => {
    it("should include candidate in region but not candidate's outside connections via election edge", () => {
      // Mock data
      const people: Record<string, Person> = {
        p1: {
          name: "Candidate",
          parties: [] as string[],
          type: "person",
        } as Person,
        p2: {
          name: "Candidate Friend",
          parties: [] as string[],
          type: "person",
        } as Person,
      };
      const companies: Record<string, Company> = {};
      const regions: Record<string, Region> = {
        r1: { name: "Region", type: "region" } as Region,
      };

      const partyColors = {};
      const nodesNoStats = getNodesNoStats(
        people,
        companies,
        regions,
        partyColors,
      );

      // Candidate ran in Region
      const edgeElection: DBEdge = {
        id: "e1",
        source: "p1",
        target: "r1",
        type: "election",
        content: "",
        name: "test",
        visibility: "public",
        references: [],
      };

      // Candidate knows Candidate Friend
      const edgeConnection: DBEdge = {
        id: "e2",
        source: "p1",
        target: "p2",
        type: "connection",
        content: "",
        name: "zna",
        visibility: "public",
        references: [],
      };

      const edges = getEdges([edgeElection, edgeConnection]);

      const groups = getNodeGroups(
        nodesNoStats,
        edges,
        people,
        companies,
        regions,
      );

      const regionGroup = groups.find((g) => g.id === "r1");
      expect(regionGroup).toBeDefined();

      // The region group should include the Region and Candidate
      expect(regionGroup?.connected).toContain("r1");
      expect(regionGroup?.connected).toContain("p1");

      // The region group should NOT include the Candidate's Friend!
      // This verifies that `backward: "dead_end"` correctly stopped the traversal at the Candidate
      expect(regionGroup?.connected).not.toContain("p2");
    });
  });

  describe("getNodesNoStats", () => {
    it("should preserve original DB type via entityType and overwrite Graph type for visual rendering", () => {
      const people: Record<string, Person> = {
        p1: { name: "Person A", type: "person" } as Person,
      };
      const companies: Record<string, Company> = {
        c1: { name: "Company B", type: "place" } as Company,
      };
      const regions: Record<string, Region> = {
        r1: { name: "Region C", type: "region" } as Region,
      };

      const nodesNoStats = getNodesNoStats(people, companies, regions, {});

      // Verify the person node
      expect(nodesNoStats["p1"]).toBeDefined();
      expect(nodesNoStats["p1"].type).toBe("circle");
      expect((nodesNoStats["p1"] as any).entityType).toBe("person");

      // Verify the company/place node
      expect(nodesNoStats["c1"]).toBeDefined();
      expect(nodesNoStats["c1"].type).toBe("rect");
      expect((nodesNoStats["c1"] as any).entityType).toBe("place");

      // Verify the region node
      expect(nodesNoStats["r1"]).toBeDefined();
      expect(nodesNoStats["r1"].type).toBe("document");
      expect((nodesNoStats["r1"] as any).entityType).toBe("region");
    });
  });
});
