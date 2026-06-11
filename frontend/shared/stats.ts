import type { NodeStats, VoteDocument, Note, Edge } from "./model";

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

  if (intervals.length === 0) {
    return 0;
  }

  intervals.sort((a, b) => a.start - b.start);

  let mergedExperienceMs = 0;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;

  for (let i = 1; i < intervals.length; i++) {
    const nextInterval = intervals[i];
    if (nextInterval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, nextInterval.end);
    } else {
      mergedExperienceMs += currentEnd - currentStart;
      currentStart = nextInterval.start;
      currentEnd = nextInterval.end;
    }
  }
  mergedExperienceMs += currentEnd - currentStart;

  const experienceMonths = mergedExperienceMs / (1000 * 60 * 60 * 24 * 30.44);
  return Math.floor((experienceMonths / 12) * 10) / 10;
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
  const approvedEdges = nodeEdges.filter((e) => !!e.revision_id);

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
    },
    approved: {
      experienceMonths: calculateExperience(approvedEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(approvedEdges),
      targetNodeIds: approvedTargetNodeIds,
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
