import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { getOptionalUser } from "~~/server/utils/auth";
import { ensureClusterStats } from "~~/server/utils/clusterStats";
import type { StoryCluster } from "~~/shared/clusters";
import type { H3Event } from "h3";

/** The story clusters, strongest first.
 *
 * What a reader gets and what an editor gets differ, and it is the same
 * difference /eksploruj draws: a cluster's hires include people whose pages
 * nobody has published, and those are drafts. A logged out caller is served
 * only the clusters that stand up without them - three or more hires they can
 * actually open - with the draft rows stripped out of each. A signed in one
 * gets everything, which is the editorial queue: „tu coś się dzieje, ale nikt
 * tego jeszcze nie opublikował”.
 *
 * The gate is `getOptionalUser`, not `wantsLatest`. `latest=true` only bypasses
 * the response cache - anybody may add it to a url - and the two happen to
 * travel together because `authFetch` appends it for a signed in reader, which
 * is also what keeps a reader from being served an editor's cached copy.
 */

export type ClusterFeed = {
  clusters: StoryCluster[];
  /** When the underlying scan last ran, so the page can say. */
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  hiresConsidered: number;
  hiresVisible: number;
  /** Whether drafts are included, which is what the page says out loud rather
   * than leaving a signed in reader to wonder why their list is longer. */
  includesDrafts: boolean;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(12),
  kind: z.enum(["region", "sector", "owner"]).optional(),
});

/** How many openable hires a cluster needs before a logged out reader sees it.
 *
 * Three. Two is a coincidence and one is a card that repeats what the feed
 * above it already said; three is the smallest number that reads as a pattern.
 * Measured on the graph as it stands, it leaves seven clusters - Chełm, Gmina
 * Skierniewice, lubelskie, sport, Powiat tomaszowski, Kraków, Wrocław.
 */
const MIN_VISIBLE_HIRES = 3;

/** A cluster as a logged out reader may see it: the draft hires and the draft
 * crew removed, and the counts left as they are.
 *
 * The counts stay whole on purpose. „12 z 24 zmian, które znamy” is the fact
 * the cluster exists to state, and a card that quietly reported 12 of 12 would
 * be claiming the register said something it did not. What is withheld is the
 * names of people nobody has published, not the shape of the thing.
 */
function withoutDrafts(cluster: StoryCluster): StoryCluster {
  const hires = cluster.hires.filter((hire) => hire.visible);
  const visiblePeople = new Set(hires.map((hire) => hire.personId));
  return {
    ...cluster,
    hires,
    crew: cluster.crew.filter((member) => visiblePeople.has(member.personId)),
  };
}

async function clusterFeed(event: H3Event): Promise<ClusterFeed> {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const user = await getOptionalUser(event);
  const db = getFirestore("koryta-pl");

  const stats = await ensureClusterStats(db, new Date());
  const stored = stats?.clusters ?? [];

  const scoped = query.kind
    ? stored.filter((cluster) => cluster.kind === query.kind)
    : stored;
  const clusters = user
    ? scoped
    : scoped
        .filter((cluster) => cluster.visible >= MIN_VISIBLE_HIRES)
        .map(withoutDrafts);

  return {
    clusters: clusters.slice(0, query.limit),
    computedAt: stats?.computedAt ?? "",
    windowStart: stats?.windowStart ?? "",
    windowEnd: stats?.windowEnd ?? "",
    hiresConsidered: stats?.hiresConsidered ?? 0,
    hiresVisible: stats?.hiresVisible ?? 0,
    includesDrafts: !!user,
  };
}

/** Six hours, the default, rather than the fifteen minutes the recent
 * employments feed takes. That feed claims to be current and this does not: the
 * document behind it is rebuilt once a day, so a shorter cache would buy
 * nothing but the read that notices it has not changed. */
export default editorFreshCachedEventHandler(clusterFeed, {
  name: "storyClusters",
});
