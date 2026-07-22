import type { NodeStats, VoteDocument, Note, Edge } from "./model";
import { pageIsPublic } from "./model";

export function calculateExperience(edges: Edge[]): number {
  const intervals: { start: number; end: number }[] = [];

  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;
      const endStr =
        edge.end_date && typeof edge.end_date === "string"
          ? edge.end_date.split("T")[0]
          : null;

      const start = startStr ? new Date(startStr).getTime() : null;
      const end = endStr ? new Date(endStr).getTime() : new Date().getTime();

      if (start && !isNaN(start) && !isNaN(end)) {
        if (start <= end) {
          intervals.push({ start, end });
        }
      }
    }
  }

  if (intervals.length === 0 || intervals[0] === undefined) {
    return 0;
  }
  intervals.sort((a, b) => a.start - b.start);

  const result = intervals.reduce<{
    mergedExperienceMs: number;
    start: number;
    end: number;
  }>(
    (acc, nextInterval) => {
      if (nextInterval.start <= acc.end) {
        acc.end = Math.max(acc.end, nextInterval.end);
      } else {
        acc.mergedExperienceMs += acc.end - acc.start;
        acc.start = nextInterval.start;
        acc.end = nextInterval.end;
      }
      return acc;
    },
    { mergedExperienceMs: 0, start: intervals[0].start, end: intervals[0].end },
  );

  result.mergedExperienceMs += result.end - result.start;

  const experienceMonths =
    result.mergedExperienceMs / (1000 * 60 * 60 * 24 * 30.44);
  return Math.floor((experienceMonths / 12) * 10) / 10;
}

export function calculateCurrentlyEmployed(edges: Edge[]): boolean {
  for (const edge of edges) {
    if (edge.type === "employed") {
      if (!edge.end_date) {
        return true;
      }
      const end = new Date(edge.end_date).getTime();
      if (!isNaN(end) && end >= new Date().getTime()) {
        return true;
      }
    }
  }
  return false;
}

export function calculateLatestEmploymentStart(edges: Edge[]): string | null {
  let latest: string | null = null;
  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;

      if (startStr) {
        if (!latest || startStr > latest) {
          latest = startStr;
        }
      }
    }
  }
  return latest;
}

export function computeVoteStats(
  nodeVotes: VoteDocument[],
): Record<string, unknown> {
  const aggregatedVotes: Record<string, unknown> = {
    interesting: 0,
    quality: 0,
    humanVoted: false,
  };

  let latestDate: Date | null = null;

  for (const v of nodeVotes) {
    if (v.userUid !== "pipeline") {
      aggregatedVotes.humanVoted = true;
    }
    if (v.updatedAt) {
      const d = new Date(v.updatedAt);
      if (!latestDate || d > latestDate) {
        latestDate = d;
      }
    }

    for (const [category, value] of Object.entries(v.categoryVotes)) {
      aggregatedVotes[category] =
        ((aggregatedVotes[category] as number) || 0) + (value as number);
    }
  }

  if (latestDate) {
    aggregatedVotes.lastVotedAt = latestDate.toISOString();
  }

  return aggregatedVotes;
}

export function computeEdgeStats(
  nodeEdges: Edge[],
  transitiveTargets: Record<string, string[]> = {},
) {
  const approvedEdges = nodeEdges.filter((e) => pageIsPublic(e));

  const allTargetNodeIds = [
    ...new Set(
      nodeEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  const approvedTargetNodeIds = [
    ...new Set(
      approvedEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  return {
    all: {
      experienceMonths: calculateExperience(nodeEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(nodeEdges),
      targetNodeIds: allTargetNodeIds,
      currentlyEmployed: calculateCurrentlyEmployed(nodeEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          nodeEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
    approved: {
      experienceMonths: calculateExperience(approvedEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(approvedEdges),
      targetNodeIds: approvedTargetNodeIds,
      currentlyEmployed: calculateCurrentlyEmployed(approvedEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          approvedEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
  };
}

export function computeNodeStats(
  nodeIsApproved: boolean,
  nodeEdges: Edge[],
  nodeNotes: Note[],
  nodeVotes: VoteDocument[],
  transitiveTargets: Record<string, string[]> = {},
): NodeStats {
  return {
    isApproved: nodeIsApproved,
    // We're interested in the total number of sources
    notesCount: nodeNotes
      .map((n) => n.sources?.length || 0)
      .reduce((a, b) => a + b, 0),
    votes: computeVoteStats(nodeVotes),
    edges: computeEdgeStats(nodeEdges, transitiveTargets),
  };
}
