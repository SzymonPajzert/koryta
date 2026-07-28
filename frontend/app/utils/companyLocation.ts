/** The part of a region node this reads, typed to what Firestore really holds
 * rather than to `Region`: `stats` is written by the recompute job, so a region
 * it has not reached yet carries it partly or not at all.
 */
type RegionWithTargets = {
  name: string;
  teryt?: string;
  stats?: {
    edges?: {
      all?: { targetNodeIds?: string[] };
      approved?: { targetNodeIds?: string[] };
    };
  };
};

/** Region name for every company the loaded regions claim, keyed by place id.
 *
 * A company's seat is an `owns` edge from the region to the company, which the
 * stats job folds into the *region's* target node ids. The lookup runs in that
 * direction because company nodes almost never carry stats of their own - 66 of
 * 3706 in production - so reading `place.stats` left the location blank for all
 * but a handful of them.
 *
 * The region hierarchy uses the same edge type, so a region's targets also list
 * its child regions; those keys are simply never looked up. Should two regions
 * ever claim one company, the more specific one wins - a powiat over the
 * województwo around it.
 */
export function regionNamesByPlaceId(
  regions: Record<string, RegionWithTargets>,
  edgeScope: "all" | "approved",
): Record<string, string> {
  const names: Record<string, string> = {};
  const specificities: Record<string, number> = {};

  for (const region of Object.values(regions)) {
    const targets = region.stats?.edges?.[edgeScope]?.targetNodeIds;
    if (!Array.isArray(targets)) continue;

    const specificity = region.teryt?.length ?? 0;
    for (const id of targets) {
      if (id in names && specificities[id]! >= specificity) continue;
      names[id] = region.name;
      specificities[id] = specificity;
    }
  }

  return names;
}
