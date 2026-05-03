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
  const aggregatedVotes: Record<string, number> = {};
  for (const v of nodeVotes) {
    for (const [category, value] of Object.entries(v.categoryVotes)) {
      aggregatedVotes[category] =
        (aggregatedVotes[category] || 0) + (value as number);
    }
  }
  return aggregatedVotes;
}

export function computeEdgeStats(
  nodeEdges: any[],
  getNodeName: (id: string) => string | undefined,
) {
  const approvedEdges = nodeEdges.filter((e) => !!e.revision_id);

  const allTargetNodeIds = [...new Set(nodeEdges.map((e) => e.target))].filter(
    Boolean,
  );
  const approvedTargetNodeIds = [
    ...new Set(approvedEdges.map((e) => e.target)),
  ].filter(Boolean);

  const allElectionTargetIds = [
    ...new Set(
      nodeEdges.filter((e) => e.type === "election").map((e) => e.target),
    ),
  ].filter(Boolean);
  const approvedElectionTargetIds = [
    ...new Set(
      approvedEdges.filter((e) => e.type === "election").map((e) => e.target),
    ),
  ].filter(Boolean);

  const allElectionLocations = [
    ...new Set(
      allElectionTargetIds.map((id) => getNodeName(id)).filter(Boolean),
    ),
  ];
  const approvedElectionLocations = [
    ...new Set(
      approvedElectionTargetIds.map((id) => getNodeName(id)).filter(Boolean),
    ),
  ];

  return {
    all: {
      experienceMonths: calculateExperience(nodeEdges),
      targetNodeIds: allTargetNodeIds,
      electionLocations: allElectionLocations,
    },
    approved: {
      experienceMonths: calculateExperience(approvedEdges),
      targetNodeIds: approvedTargetNodeIds,
      electionLocations: approvedElectionLocations,
    },
  };
}

export function computeNodeStats(
  nodeIsApproved: boolean,
  nodeEdges: Edge[],
  nodeNotes: Note[],
  nodeVotes: Votes[],
  getNodeName: (id: string) => string | undefined,
): NodeStats {
  return {
    isApproved: nodeIsApproved,
    notesCount: nodeNotes.length,
    votes: computeVoteStats(nodeVotes),
    edges: computeEdgeStats(nodeEdges, getNodeName),
  };
}
