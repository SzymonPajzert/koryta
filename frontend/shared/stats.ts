import type { NodeStats, VoteDocument, Note, Edge } from "./model";

export function calculateExperience(edges: Edge[]): number {
  let experienceMonths = 0;
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

      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : new Date();

      if (start && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const diffMs = end.getTime() - start.getTime();
        experienceMonths += diffMs / (1000 * 60 * 60 * 24 * 30.44);
      }
    }
  }
  return Math.floor((experienceMonths / 12) * 10) / 10;
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
      targetNodeIds: allTargetNodeIds,
    },
    approved: {
      experienceMonths: calculateExperience(approvedEdges),
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
