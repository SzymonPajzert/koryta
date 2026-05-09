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
): Record<string, number> {
  const aggregatedVotes: Record<string, number> = {
    interesting: 0,
    quality: 0,
  };
  for (const v of nodeVotes) {
    for (const [category, value] of Object.entries(v.categoryVotes)) {
      aggregatedVotes[category] =
        (aggregatedVotes[category] || 0) + (value as number);
    }
  }
  return aggregatedVotes;
}

export function computeEdgeStats(nodeEdges: Edge[]) {
  const approvedEdges = nodeEdges.filter((e) => !!e.revision_id);

  const allTargetNodeIds = [...new Set(nodeEdges.map((e) => e.target))].filter(
    Boolean,
  );
  const approvedTargetNodeIds = [
    ...new Set(approvedEdges.map((e) => e.target)),
  ];

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
): NodeStats {
  return {
    isApproved: nodeIsApproved,
    // We're interested in the total number of sources
    notesCount: nodeNotes
      .map((n) => n.sources?.length || 0)
      .reduce((a, b) => a + b, 0),
    votes: computeVoteStats(nodeVotes),
    edges: computeEdgeStats(nodeEdges),
  };
}
