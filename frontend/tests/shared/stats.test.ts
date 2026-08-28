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

    const pipelineVote = (uid: string, interesting: number) =>
      ({
        userUid: uid,
        nodeId: "n1",
        categoryVotes: { interesting },
      }) as unknown as VoteDocument;

    it("takes the best model rather than summing them", () => {
      // Five models agreeing that somebody is a 4 is one dataset seen five
      // ways, not five voters — summing would put them at 20 on a 1-5 scale.
      const stats = computeVoteStats([
        pipelineVote("pipeline", 2),
        pipelineVote("pipeline-pagerank", 4),
        pipelineVote("pipeline-turnover", 1),
      ]);

      expect(stats.interesting).toBe(4);
      expect(stats.humanVoted).toBe(false);
    });

    it("adds the best model's score on top of the human votes", () => {
      const stats = computeVoteStats([
        { userUid: "aB3xYz", categoryVotes: { interesting: 3 } },
        { userUid: "cD4wVu", categoryVotes: { interesting: 2 } },
        pipelineVote("pipeline-together", 5),
        pipelineVote("pipeline-capture", 1),
      ] as unknown as VoteDocument[]);

      expect(stats.interesting).toBe(3 + 2 + 5);
      expect(stats.humanVoted).toBe(true);
    });

    it("records what each model said so a reader can tell them apart", () => {
      const stats = computeVoteStats([
        pipelineVote("pipeline-pagerank", 5),
        pipelineVote("pipeline-capture", 2),
      ]);

      expect(stats.models).toEqual({
        "pipeline-pagerank": 5,
        "pipeline-capture": 2,
      });
    });

    it("counts the people who voted, not the votes they cast", () => {
      // The total cannot say whether a 4 is four models agreeing or one reader
      // insisting; this is the number that tells them apart.
      const stats = computeVoteStats([
        { userUid: "aB3xYz", categoryVotes: { interesting: 3 } },
        { userUid: "cD4wVu", categoryVotes: { interesting: 1 } },
        pipelineVote("pipeline-capture", 5),
      ] as unknown as VoteDocument[]);

      expect(stats.humanCount).toBe(2);
    });

    it("counts one person voting twice as one voter", () => {
      // One reader casting a verdict in two categories is one person who
      // looked, which is what the count is meant to answer.
      const stats = computeVoteStats([
        { userUid: "aB3xYz", categoryVotes: { interesting: 3 } },
        { userUid: "aB3xYz", categoryVotes: { quality: -1 } },
      ] as unknown as VoteDocument[]);

      expect(stats.humanCount).toBe(1);
    });

    it("leaves humanCount off a node no person has voted on", () => {
      // Absent rather than 0: firestore cannot query for a field that is not
      // there, and writing a 0 onto every node to say nothing happened is a
      // migration with no reader.
      const stats = computeVoteStats([pipelineVote("pipeline-capture", 5)]);

      expect(stats.humanCount).toBeUndefined();
    });

    it("leaves a re-scoring run out of lastVotedAt", () => {
      // The field reads as "when did somebody last look at this", and a
      // nightly re-run is not somebody looking.
      const stats = computeVoteStats([
        {
          userUid: "aB3xYz",
          categoryVotes: { interesting: 1 },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          userUid: "pipeline-pagerank",
          categoryVotes: { interesting: 5 },
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ] as unknown as VoteDocument[]);

      expect(stats.lastVotedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("computeEdgeStats", () => {
    it("should partition all vs approved edges and extract target arrays", () => {
      const edges: Edge[] = [
        { target: "node1", type: "connection" } as Edge, // hidden
        { target: "node2", type: "employed", published: true } as Edge, // public
        { target: "node3", type: "election" } as Edge, // hidden election
        { target: "node4", type: "election", published: true } as Edge, // public election
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
        { target: "company1", type: "employed", published: true } as Edge,
        { target: "company2", type: "employed" } as Edge, // hidden
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

    describe("seats on an unpaid supervisory organ", () => {
      // How the 892 stored SPZOZ seats look: a public hospital, an `employed`
      // edge, and the role every supervisory seat carries whatever the organ
      // is really called.
      const councilSeat = {
        target: "szpital",
        type: "employed",
        name: "Rada Nadzorcza",
        start_date: "2024-01-01T00:00:00Z",
      } as Edge;

      it("drops them from every employment number", () => {
        const edges: Edge[] = [
          councilSeat,
          {
            target: "public-co",
            type: "employed",
            name: "Zarząd",
            start_date: "2020-01-01T00:00:00Z",
            end_date: "2021-01-01T00:00:00Z",
          } as Edge,
        ];

        const stats = computeEdgeStats(
          edges,
          new Set(["szpital", "public-co"]),
          {},
          new Set(["szpital"]),
        );

        // The 2024 seat is the most recent thing this person did, and it must
        // not be what the „Ostatnie zatrudnienie" column reports.
        expect(stats.all.latestEmploymentStart).toBe("2020-01-01");
        expect(stats.all.experienceMonths).toBeCloseTo(1.0, 1);
        expect(stats.all.currentlyEmployed).toBe(false);
        expect(stats.all.currentlyEmployedTargetNodeIds).toEqual([]);
      });

      it("leaves the hospital reachable as a target", () => {
        const stats = computeEdgeStats(
          [councilSeat],
          new Set(["szpital"]),
          {},
          new Set(["szpital"]),
        );

        // The seat is still a fact about the person, so they stay in the
        // hospital's „Firmy" column and on the graph. Only the counters change.
        expect(stats.all.targetNodeIds).toEqual(["szpital"]);
      });

      it("keeps a management post at the same hospital", () => {
        // The register lists an SPZOZ's kierownik as its representation, which
        // rejestr.io reports as a board seat: 16 stored `Zarząd` edges point at
        // these hospitals, and every one of them is a salaried director.
        const edges: Edge[] = [
          {
            target: "szpital",
            type: "employed",
            name: "Zarząd",
            start_date: "2024-01-01T00:00:00Z",
          } as Edge,
        ];

        const stats = computeEdgeStats(
          edges,
          new Set(["szpital"]),
          {},
          new Set(["szpital"]),
        );

        expect(stats.all.latestEmploymentStart).toBe("2024-01-01");
        expect(stats.all.currentlyEmployed).toBe(true);
      });

      it("keeps the same seat at a company with an ordinary board", () => {
        const stats = computeEdgeStats(
          [{ ...councilSeat, target: "public-co" } as Edge],
          new Set(["public-co"]),
          {},
          new Set(["szpital"]),
        );

        expect(stats.all.latestEmploymentStart).toBe("2024-01-01");
      });

      it("counts everything when no caller worked the organs out", () => {
        const stats = computeEdgeStats([councilSeat], new Set(["szpital"]));

        expect(stats.all.latestEmploymentStart).toBe("2024-01-01");
      });
    });

    describe("removed relations", () => {
      // A relation an admin deleted, or one a merge collapsed into the
      // survivor's copy, keeps its document with `deleted: true`. The
      // `approved` scope dropped it through `pageIsPublic`; the `all` scope -
      // what a logged-in editor's table is filtered and sorted by - did not.
      const deletedJob = {
        target: "szpital",
        type: "employed",
        published: true,
        deleted: true,
        start_date: "2024-01-01",
      } as Edge;

      it("leaves a deleted relation out of both scopes", () => {
        const stats = computeEdgeStats([deletedJob], new Set(["szpital"]));

        expect(stats.all.targetNodeIds).toEqual([]);
        expect(stats.all.currentlyEmployed).toBe(false);
        expect(stats.all.latestEmploymentStart).toBe(null);
        expect(stats.all.currentlyEmployedTargetNodeIds).toEqual([]);
        expect(stats.approved.targetNodeIds).toEqual([]);
      });

      it("does not carry a deleted seat's region into the targets", () => {
        const stats = computeEdgeStats(
          [{ target: "company1", type: "seat", deleted: true } as Edge],
          new Set(),
          { company1: ["region-A"] },
        );

        expect(stats.all.targetNodeIds).toEqual([]);
        expect(stats.all.seatNodeIds).toEqual([]);
      });

      it("still counts the relations that were left alone", () => {
        const stats = computeEdgeStats(
          [
            deletedJob,
            {
              target: "szpital",
              type: "employed",
              published: true,
              start_date: "2020-01-01",
            } as Edge,
          ],
          new Set(["szpital"]),
        );

        expect(stats.all.targetNodeIds).toEqual(["szpital"]);
        expect(stats.all.latestEmploymentStart).toBe("2020-01-01");
      });
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
