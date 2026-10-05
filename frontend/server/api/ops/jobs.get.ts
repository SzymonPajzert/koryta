import { defineEventHandler } from "h3";
import { requireDatascience, getUser } from "~~/server/utils/auth";
import { jobsOverview } from "~~/server/utils/jobs";

/** Every job's recent runs, for /admin/procesy. The datascience group only:
 * a run's errors name companies and urls, and the paid scrape's counters are
 * money. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  return await jobsOverview();
});
