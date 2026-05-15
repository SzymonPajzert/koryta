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

      const stats = computeEdgeStats(edges);

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

      const stats = computeEdgeStats(edges, transitiveTargets);

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
        transitiveTargets,
      );

      expect(stats.isApproved).toBe(true);
      expect(stats.notesCount).toBe(3);
      expect(stats.votes.quality).toBe(5);
      expect(stats.edges.all.targetNodeIds).toEqual(["t1", "region-XYZ"]);
    });
  });
});
