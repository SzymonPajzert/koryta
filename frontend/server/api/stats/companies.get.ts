import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import { pageIsPublic } from "~~/shared/model";
import { fetchNodes } from "~~/server/utils/fetch";
import {
  countCompanyPeople,
  type CompanyPeopleStats,
  type EmploymentEdgeRow,
} from "~~/server/utils/companyPeople";

/** Re-exported so the page can name the response without reaching into
 * `server/utils`, the way /eksploruj/szpitale names HospitalStats. Types only:
 * `server/` is not bundled for the browser. */
export type {
  CompanyPeople,
  CompanyPeopleStats,
} from "~~/server/utils/companyPeople";

/** The most employment edges one computation will read. 3,586 are published on
 * the 2026-09-29 export; this is headroom for the publishing backlog, not a
 * number the answer is expected to reach. */
const MAX_EDGES = 20_000;

/** How many people on the site each institution has had - the „Osoby” column of
 * the companies view on /eksploruj/tabela.
 *
 * Two reads, both projected, neither of them per institution:
 *
 * 1. every published `employed` edge - 3,586 documents on the 2026-09-29
 *    export, against 23,805 employments in all. Two equalities, which
 *    Firestore serves by merging its single-field indexes. The same two
 *    equalities /api/edges/serviceMilestones uses, but without its
 *    `orderBy("start_date")`: an edge with no `start_date` - 156 of them - is
 *    somebody who worked there all the same, and that `orderBy` would drop it.
 * 2. every published person, for the check the edge cannot make about the
 *    node it hangs off - 1,209 documents, the `published` flag and nothing
 *    else. `published` rather than `stats.isApproved`, which is only the copy
 *    of it a trigger keeps in step, so the answer holds wherever that trigger
 *    has not run - an emulator whose functions were not built, say.
 *
 * About 4,800 reads a computation, and every institution is in it. That is
 * what lets one cached answer serve the whole view: the category, the region
 * and the institutions are filtered in the browser, over the place and region
 * lists the page already holds, and the table can be ordered by the count
 * whichever of them is set. Asking per filter instead - the employments of one
 * sector's institutions, thirty `in` values at a time - would be a cache entry
 * and a cold computation per combination a reader picks, and the view with no
 * filter at all would still have to read everything.
 *
 * Six hours, shared by everybody, and deliberately not
 * `editorFreshCachedEventHandler`. The answer does not depend on who asks: it
 * counts published people only, for an editor as for anybody else. And the page
 * fetches it without `authFetch`, so a signed-in reader does not carry
 * `latest=true` into it and skip the cache - which is what cost
 * /api/stats/hospitals 47,056 reads in 28 hours for one person reloading it.
 * The price is that a count can trail a publication by up to six hours, which
 * a column of counts can afford where a page an editor has just changed could
 * not.
 *
 * A cached function under one constant key, like /api/stats/homeTimeline, and
 * not a cached handler: that keys on the whole url, so `?latest=true` - or any
 * `?x=1` a crawler or a reader adds - would start a cold computation of its
 * own, 4,800 reads apiece, for the same answer.
 */
const cachedCompanyPeople = defineCachedFunction(
  async (): Promise<CompanyPeopleStats> => {
    const db = getFirestore("koryta-pl");

    const [edgesSnap, peopleSnap] = await Promise.all([
      db
        .collection("edges")
        .where("type", "==", "employed")
        .where("published", "==", true)
        .select(
          "source",
          "target",
          "start_date",
          "end_date",
          "published",
          "deleted",
        )
        .limit(MAX_EDGES)
        .get(),
      db
        .collection("nodes")
        .where("type", "==", "person")
        .where("published", "==", true)
        .select("published", "deleted")
        .get(),
    ]);

    if (edgesSnap.size >= MAX_EDGES) {
      // Loud rather than silent: past this the counts are short, and nothing
      // on the page could tell.
      logger.warn("[api/stats/companies] employment scan hit its cap", {
        cap: MAX_EDGES,
      });
    }

    const publishedPeople = new Set(
      peopleSnap.docs
        // A merged-away page keeps its `published` flag beside `deleted: true`
        // - see server/utils/merge.ts - so the query alone would let it in.
        .filter((doc) => pageIsPublic(doc.data()))
        .map((doc) => doc.id),
    );

    // A post can hang off a region's urząd as well as off a company - 27 of
    // the published ones on the 2026-09-29 export - and the view lists only
    // institutions. The region list is the cached one /api/nodes serves the
    // same page its seats from, so this is normally no read at all.
    const regionIds = new Set(Object.keys(await fetchNodes("region")));
    const companies = Object.fromEntries(
      Object.entries(
        countCompanyPeople(
          edgesSnap.docs.map((doc) => doc.data() as EmploymentEdgeRow),
          publishedPeople,
        ),
      ).filter(([id]) => !regionIds.has(id)),
    );

    return { generatedAt: new Date().toISOString(), companies };
  },
  {
    name: "stats-companies",
    maxAge: 21600,
    swr: true,
    getKey: () => "all",
  },
);

export default defineEventHandler(() => cachedCompanyPeople());
