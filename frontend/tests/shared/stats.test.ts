import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateExperience,
  computeVoteStats,
  computeEdgeStats,
  computeNodeStats,
} from "~~/shared/stats";
import type { Edge, VoteDocument, Note } from "~~/shared/model";

describe("shared/stats.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a consistent 'now' so calculations are deterministic
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateExperience", () => {
    it("should return 0 for empty edges", () => {
      expect(calculateExperience([])).toBe(0);
    });

    it("should ignore non-employed edges", () => {
      const edges: Edge[] = [
        { type: "connection", source: "a", target: "b" } as Edge,
        { type: "election", source: "a", target: "c" } as Edge,
      ];
      expect(calculateExperience(edges)).toBe(0);
    });

    it("should calculate years of experience correctly based on dates", () => {
      const edges: Edge[] = [
        {
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2021-01-01T00:00:00Z",
        } as Edge,
      ];
      // 1 year = 365 or 366 days. The function uses 30.44 days/month.
      // 366 days / 30.44 = 12.02 months -> 1.0 years
      expect(calculateExperience(edges)).toBeCloseTo(1.0, 1);
    });

    it("should assume current date if end_date is missing", () => {
      const edges: Edge[] = [
        {
          type: "employed",
          start_date: "2023-01-01T00:00:00Z",
        } as Edge,
      ];
      // From 2023-01-01 to 2024-01-01 is 1 year.
      expect(calculateExperience(edges)).toBeCloseTo(0.9, 1);
    });

    it("should correctly handle overlapping employment periods", () => {
      const edges: Edge[] = [
        {
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2022-01-01T00:00:00Z",
        } as Edge,
        {
          type: "employed", // Fully overlapping inside
          start_date: "2020-06-01T00:00:00Z",
          end_date: "2021-06-01T00:00:00Z",
        } as Edge,
        {
          type: "employed", // Overlapping tail end
          start_date: "2021-06-01T00:00:00Z",
          end_date: "2023-01-01T00:00:00Z",
        } as Edge,
      ];
      // Total span is 2020-01-01 to 2023-01-01. That's exactly 3 years (1096 days).
      // 1096 / 30.44 = 36 months -> 3.0 years
      expect(calculateExperience(edges)).toBeCloseTo(3.0, 1);
    });

    it("should correctly handle non-overlapping employment periods", () => {
      const edges: Edge[] = [
        {
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2021-01-01T00:00:00Z", // 366 days
        } as Edge,
        {
          type: "employed",
          start_date: "2022-01-01T00:00:00Z",
          end_date: "2023-01-01T00:00:00Z", // 365 days
        } as Edge,
      ];
      // Total span is 366 + 365 = 731 days
      // 731 / 30.44 = 24.01 months -> 2.0 years
      expect(calculateExperience(edges)).toBeCloseTo(2.0, 1);
    });
  });

  describe("computeVoteStats", () => {
    it("should aggregate votes across categories", () => {
      const votes: VoteDocument[] = [
        {
          categoryVotes: { interesting: 1, quality: 1, other: 5 },
        } as unknown as VoteDocument,
        {
          categoryVotes: { interesting: -1, other: 2 },
        } as unknown as VoteDocument,
      ];

      const stats = computeVoteStats(votes);
      expect(stats.interesting).toBe(0);
      expect(stats.quality).toBe(1);
      expect(stats.other).toBe(7);
    });

    it("should handle empty votes with default keys", () => {
      const stats = computeVoteStats([]);
      expect(stats).toEqual({ interesting: 0, quality: 0, humanVoted: false });
    });
  });

  describe("computeEdgeStats", () => {
    it("should partition all vs approved edges and extract target arrays", () => {
      const edges: Edge[] = [
        { target: "node1", type: "connection" } as Edge, // unapproved
        { target: "node2", type: "employed", revision_id: "rev1" } as Edge, // approved
        { target: "node3", type: "election" } as Edge, // unapproved election
        { target: "node4", type: "election", revision_id: "rev2" } as Edge, // approved election
      ];

      const stats = computeEdgeStats(edges, new Set(["node2"]));

      // 'all' expectations
      expect(stats.all.targetNodeIds).toEqual([
        "node1",
        "node2",
        "node3",
        "node4",
      ]);

      // 'approved' expectations
      expect(stats.approved.targetNodeIds).toEqual(["node2", "node4"]);
    });

    it("should include transitive targets for companies", () => {
      const edges: Edge[] = [
        { target: "company1", type: "employed", revision_id: "rev1" } as Edge,
        { target: "company2", type: "employed" } as Edge, // unapproved
      ];

      const transitiveTargets = {
        company1: ["region-A", "region-B"],
        company2: ["region-C"],
      };

      const stats = computeEdgeStats(
        edges,
        new Set(["company1", "company2"]),
        transitiveTargets,
      );

      // 'all' expectations should include all companies and their regions
      expect(stats.all.targetNodeIds).toEqual([
        "company1",
        "region-A",
        "region-B",
        "company2",
        "region-C",
      ]);

      // 'approved' expectations should only include approved companies and their regions
      expect(stats.approved.targetNodeIds).toEqual([
        "company1",
        "region-A",
        "region-B",
      ]);
    });

    it("should count experience and latest employment only in public companies", () => {
      const edges: Edge[] = [
        {
          target: "public-co",
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2021-01-01T00:00:00Z",
        } as Edge,
        {
          // More recent, but private — must not win the latest-employment date
          target: "private-co",
          type: "employed",
          start_date: "2022-01-01T00:00:00Z",
          end_date: "2023-01-01T00:00:00Z",
        } as Edge,
      ];

      const stats = computeEdgeStats(edges, new Set(["public-co"]));

      expect(stats.all.latestEmploymentStart).toBe("2020-01-01");
      expect(stats.all.experienceMonths).toBeCloseTo(1.0, 1);
      // Both companies are still reachable targets, only the metrics are filtered
      expect(stats.all.targetNodeIds).toEqual(["public-co", "private-co"]);
    });

    it("should report no experience when every company is private", () => {
      const edges: Edge[] = [
        {
          target: "private-co",
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2021-01-01T00:00:00Z",
        } as Edge,
      ];

      const stats = computeEdgeStats(edges, new Set());

      expect(stats.all.latestEmploymentStart).toBeNull();
      expect(stats.all.experienceMonths).toBe(0);
    });

    it("should treat only public companies as current employment", () => {
      const edges: Edge[] = [
        // Ongoing, but private
        { target: "private-co", type: "employed" } as Edge,
        {
          target: "public-co",
          type: "employed",
          start_date: "2020-01-01T00:00:00Z",
          end_date: "2021-01-01T00:00:00Z",
        } as Edge,
      ];

      const stats = computeEdgeStats(edges, new Set(["public-co"]));

      expect(stats.all.currentlyEmployed).toBe(false);
      expect(stats.all.currentlyEmployedTargetNodeIds).toEqual([]);
    });

    it("should list only public companies as current employers", () => {
      const edges: Edge[] = [
        { target: "public-co", type: "employed" } as Edge,
        { target: "private-co", type: "employed" } as Edge,
      ];

      const stats = computeEdgeStats(edges, new Set(["public-co"]), {
        "public-co": ["region-A"],
        "private-co": ["region-B"],
      });

      expect(stats.all.currentlyEmployed).toBe(true);
      expect(stats.all.currentlyEmployedTargetNodeIds).toEqual([
        "public-co",
        "region-A",
      ]);
    });

    it("should ignore non-employment edges pointing at public companies", () => {
      const edges: Edge[] = [
        {
          target: "public-co",
          type: "election",
          start_date: "2023-01-01T00:00:00Z",
        } as Edge,
      ];

      const stats = computeEdgeStats(edges, new Set(["public-co"]));

      expect(stats.all.latestEmploymentStart).toBeNull();
      expect(stats.all.experienceMonths).toBe(0);
    });
  });

  describe("computeNodeStats", () => {
    it("should compose all stats and sum up note sources", () => {
      const edges: Edge[] = [{ type: "connection", target: "t1" } as Edge];
      const notes: Note[] = [
        { sources: ["s1", "s2"] } as Note,
        { sources: ["s3"] } as Note,
        {} as Note, // No sources
      ];
      const votes: VoteDocument[] = [
        { categoryVotes: { quality: 5 } } as unknown as VoteDocument,
      ];

      const transitiveTargets = {
        t1: ["region-XYZ"],
      };

      const stats = computeNodeStats(
        true,
        edges,
        notes,
        votes,
        new Set(),
        transitiveTargets,
      );

      expect(stats.isApproved).toBe(true);
      expect(stats.notesCount).toBe(3);
      expect(stats.votes.quality).toBe(5);
      expect(stats.edges.all.targetNodeIds).toEqual(["t1", "region-XYZ"]);
    });
  });
});
