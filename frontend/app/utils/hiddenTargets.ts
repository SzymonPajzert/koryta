/** The part of a node's stats the "log in to see more" banner reads, typed to
 * what either kind of reader is actually sent. */
type EdgeStatsLike = {
  edges?: {
    all?: { targetNodeIds?: unknown[] };
    approved?: { targetNodeIds?: unknown[] };
    hiddenTargets?: number;
  };
};

/** How many more things a node is joined to than its published relations
 * show - the number the logged-out banner on /eksploruj/tabela and the
 * autograf offers behind a sign-in.
 *
 * A logged-out reader is sent it ready-made as `hiddenTargets`: the server
 * takes `stats.edges.all` off their copy (`dropDraftStats`), because the ids in
 * it say where the unpublished relations lead. Worked out from `all` and
 * `approved` wherever those are still there to subtract.
 */
export function hiddenTargetCount(stats: EdgeStatsLike | undefined): number {
  const edges = stats?.edges;
  if (typeof edges?.hiddenTargets === "number") return edges.hiddenTargets;
  const all = edges?.all?.targetNodeIds;
  const approved = edges?.approved?.targetNodeIds;
  if (!all || !approved) return 0;
  return Math.max(0, all.length - approved.length);
}
