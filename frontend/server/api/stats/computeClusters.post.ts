import { getFirestore } from "firebase-admin/firestore";
import { requireAdmin } from "~~/server/utils/auth";
import { rebuildClusterStats } from "~~/server/utils/clusterStats";

/** Rebuild the story clusters now.
 *
 * /api/stats/clusters rebuilds them by itself once a day, so this is not how
 * they normally get written - it is for the afternoon somebody publishes the
 * last half of a town's board and wants to see the cluster move without waiting
 * until tomorrow, and for a deploy that changes the arithmetic.
 *
 * `requireAdmin`, for the reason computeNodes.post.ts gives at greater length:
 * this reads most of two collections and decides what the home page says about
 * a named politician. /api/stats/compute has no gate at all and is the example
 * not to follow.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const db = getFirestore("koryta-pl");
  const doc = await rebuildClusterStats(db, new Date());

  /* The endpoint that serves these is cached for six hours, and the point of
   * asking for a rebuild is to see the result. Same call as every other write
   * endpoint that invalidates an aggregate - and with the same caveat: it
   * clears this container's copy, not the CDN's. */
  await useStorage("cache").clear("nitro:handlers");

  return {
    status: "success",
    computedAt: doc.computedAt,
    clusters: doc.clusters.length,
    hiresConsidered: doc.hiresConsidered,
    hiresVisible: doc.hiresVisible,
  };
});
