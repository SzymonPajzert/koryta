import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { fetchEdgeEndpointNodes } from "~~/server/utils/edgeNodes";
import { asArray, pageIsPublic } from "~~/shared/model";
import { canonicalParty, partyColors, partyMergedLabels } from "~~/shared/misc";
import { categoryTitle, isKnownCategory } from "~~/shared/companyCategories";
import { wojewodztwoLabel, wojewodztwoOf } from "~~/shared/teryt";
import { warsawDate } from "~~/shared/dates";
import {
  buildTimeline,
  effectiveEnd,
  type HeldPost,
  type Timeline,
} from "~~/shared/homeTimeline";
import type { Company, Edge, Person } from "~~/shared/model";

/** The dimensions the chart can be split by.
 *
 * The tuple is the source of truth and the type is derived from it, so the
 * response and the picker cannot drift apart.
 */
export const timelineGroupings = ["party", "region", "category"] as const;

export type TimelineGrouping = (typeof timelineGroupings)[number];

export type HomeTimelineResponse = {
  /** Every month the series cover, shared by all three groupings. */
  months: string[];
  /** One set of lines per grouping, all three computed together: the payload is
   * 26 kB, the reader switches between them with a click, and a request per
   * grouping would make that click wait on a scan of the whole edge collection.
   */
  groupings: Record<TimelineGrouping, Timeline["series"]>;
  /** How many posts each grouping could place, and how many distinct people
   * those are. Not equal across the three: every published post has a party
   * here, nearly all have a seat, and 42% carry a sector. The chart says so
   * rather than quietly drawing a smaller population. */
  coverage: Record<TimelineGrouping, { posts: number; people: number }>;
  /** How many published posts went into the whole computation, whichever
   * grouping can place them - the denominator the coverage is out of. */
  posts: number;
  /** The Warsaw month the series end on, `YYYY-MM`. */
  today: string;
};

/** How many edges to read per round trip while scanning. */
const SCAN_PAGE = 500;

/** The most edge documents one computation will read. Six times the 3,256
 * published employments on the 2026-09-12 export, so the ceiling is a guard
 * against a runaway query rather than a limit the data is near. */
const MAX_SCAN = 20000;

/** The node fields this endpoint reads.
 *
 * Field-masked because it fetches every node the published employments touch -
 * roughly 2,500 documents - and then holds the result in nitro's cache;
 * `activity`, `stats` and the revision pointers are no part of the answer. The
 * read count is the same either way. Same argument /api/edges/serviceMilestones
 * makes at greater length.
 */
const NODE_FIELDS = ["type", "published", "deleted", "parties", "categories"];

/** The region fields the seat lookup reads.
 *
 * A company's seat is a `seat` edge from the region to the company, which the
 * stats job folds into the *region's* `seatNodeIds` - so the question is
 * answered by reading 1,389 region documents rather than by a second scan of
 * `edges`. `approved` is the right scope for a public, cached endpoint: the
 * `all` scope would place a company on the strength of a seat nobody has
 * approved. `app/utils/companyLocation.ts` does the same walk in the browser,
 * and says more about why it runs region-first.
 */
const REGION_FIELDS = [
  "name",
  "teryt",
  "stats.edges.approved.seatNodeIds",
  "stats.edges.approved.targetNodeIds",
];

type SeatRegion = { name: string; teryt: string };

/** The województwo each company sits in, keyed by company node id.
 *
 * Only województwa: a powiat is the more specific answer and the one
 * `regionsByPlaceId` keeps, but sixteen lines is already past what a chart can
 * carry and 380 powiaty is not a grouping. The most specific region claiming a
 * company decides which województwo it is in, which is the same tie-break, just
 * read two digits in.
 */
async function seatsByCompany(
  db: FirebaseFirestore.Firestore,
): Promise<Map<string, SeatRegion>> {
  const snap = await db
    .collection("nodes")
    .where("type", "==", "region")
    .select(...REGION_FIELDS)
    .get();

  const wojewodztwa = new Map<string, string>();
  const seats = new Map<string, SeatRegion>();
  const specificity = new Map<string, number>();

  for (const doc of snap.docs) {
    const data = doc.data();
    const teryt = typeof data.teryt === "string" ? data.teryt : "";
    if (!teryt) continue;
    if (teryt.length === 2 && typeof data.name === "string") {
      wojewodztwa.set(teryt, wojewodztwoLabel(data.name));
    }

    const scoped = data.stats?.edges?.approved;
    // `seatNodeIds` rather than `targetNodeIds`, falling back while the stats
    // migration runs: since the register's shareholder lists arrived a region
    // points at both the companies seated in it and the ones it merely holds
    // shares in, and only the first is a location.
    const targets = asArray<string>(
      scoped?.seatNodeIds ?? scoped?.targetNodeIds,
    );

    for (const id of targets) {
      if (typeof id !== "string") continue;
      // The more specific region wins - a powiat over the województwo around
      // it - which matters only for the name we could show; both agree on the
      // first two digits.
      if (seats.has(id) && specificity.get(id)! >= teryt.length) continue;
      seats.set(id, { name: data.name, teryt });
      specificity.set(id, teryt.length);
    }
  }

  // Rewritten to the województwo, now that every region has been seen: a
  // company placed by a powiat still has to be labelled with the voivodeship
  // above it, and that node may have come later in the scan.
  const placed = new Map<string, SeatRegion>();
  for (const [id, seat] of seats) {
    const code = wojewodztwoOf(seat.teryt);
    if (!code) continue;
    placed.set(id, { teryt: code, name: wojewodztwa.get(code) ?? seat.name });
  }
  return placed;
}

/** Every published employment, as posts a timeline can count.
 *
 * The whole collection, because a monthly count is a fact about every post open
 * in that month and no query returns "the ones open in March 2016". That is the
 * same scan /api/edges/serviceMilestones does, for the same reason, and it is
 * why the result is cached for a day rather than computed per request: the
 * numbers only move when somebody publishes a page.
 *
 * Both ends are checked against the nodes rather than trusted from the edge.
 * The publish rule already refuses an edge whose ends are not both live and
 * unpublishing a node cascades to its edges - but the pipelines write this
 * collection too, and the nodes have to be read anyway to find the parties and
 * the sectors.
 *
 * Every published post counts, not only the ones in a state-owned company: a
 * page is on the site because an editor judged it worth publishing, so that
 * filter has been applied by hand already. `isPublic` would have dropped a
 * quarter of the posts, most of them companies nobody has classified yet rather
 * than companies known to be private.
 */
const cachedTimeline = defineCachedFunction(
  async (today: string): Promise<HomeTimelineResponse> => {
    const db = getFirestore(getApp(), "koryta-pl");

    const edges: (Edge & { id: string })[] = [];
    let scanned = 0;
    let cursor: { startDate: string; id: string } | null = null;

    for (;;) {
      let q = db
        .collection("edges")
        .where("type", "==", "employed")
        .where("published", "==", true)
        // Not the order this view wants - it wants none - but it is the index
        // `edges` already carries for these two filters, and it gives the scan
        // a cursor to resume from. `__name__` is spelled out because a raw
        // `startAfter` is checked against the *declared* orders; see
        // /api/edges/recentEmployments for the full story.
        .orderBy("start_date", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(SCAN_PAGE);
      if (cursor) q = q.startAfter(cursor.startDate, cursor.id);

      const snap = await q.get();
      scanned += snap.size;
      if (snap.empty) break;

      for (const doc of snap.docs) {
        const edge = { id: doc.id, ...(doc.data() as Edge) };
        // An explicit null start_date is a value the index sorts (last, going
        // down) rather than one it drops, and it cannot be a cursor either - so
        // it is skipped without moving the cursor past it.
        if (typeof edge.start_date !== "string") continue;
        cursor = { startDate: edge.start_date, id: edge.id };
        if (edge.deleted === true || !edge.source || !edge.target) continue;
        edges.push(edge);
      }

      if (snap.size < SCAN_PAGE || scanned >= MAX_SCAN) break;
    }

    const [nodes, seats] = await Promise.all([
      fetchEdgeEndpointNodes(db, edges, NODE_FIELDS),
      seatsByCompany(db),
    ]);

    const byGrouping: Record<TimelineGrouping, HeldPost[]> = {
      party: [],
      region: [],
      category: [],
    };
    const regionNames = new Map<string, string>();
    let posts = 0;

    for (const edge of edges) {
      const person = nodes.get(edge.source);
      if (person?.type !== "person" || !pageIsPublic(person)) continue;
      const employer = nodes.get(edge.target);
      if (!employer || !pageIsPublic(employer)) continue;

      posts += 1;
      const post = {
        personId: edge.source,
        start: edge.start_date!,
        end: effectiveEnd(edge.end_date),
      };

      // `asArray`, not `.parties ?? []`: a node written before 2026-07-28 holds
      // `{"0": "PiS"}` where the array belongs, and reading it as an array loses
      // the value silently rather than failing.
      //
      // Only the parties the site has a colour for. One it has not is stored and
      // then invisible everywhere else - no chip, no graph legend - and a chart
      // is the wrong place to start showing them, a line with no colour of its
      // own being a line nobody can name.
      const parties = asArray<string>((person as Person).parties)
        .filter((party) => typeof party === "string" && party in partyColors)
        .map(canonicalParty);
      if (parties.length > 0)
        byGrouping.party.push({ ...post, groups: parties });

      const seat = seats.get(edge.target);
      if (seat) {
        regionNames.set(seat.teryt, seat.name);
        byGrouping.region.push({ ...post, groups: [seat.teryt] });
      }

      // Absent and empty differ on this field - absent means nobody has decided,
      // which is true of most companies - so a post with no sector is left out
      // of that grouping rather than counted as "other". `coverage` is what says
      // how many that is.
      const categories = asArray<string>(
        (employer as Company).categories,
      ).filter((value) => typeof value === "string" && isKnownCategory(value));
      if (categories.length > 0) {
        byGrouping.category.push({ ...post, groups: categories });
      }
    }

    const labels: Record<TimelineGrouping, (key: string) => string> = {
      party: (key) => partyMergedLabels[key] ?? key,
      region: (key) => regionNames.get(key) ?? key,
      category: categoryTitle,
    };
    const otherLabels: Record<TimelineGrouping, string> = {
      party: "Pozostałe partie",
      region: "Pozostałe województwa",
      category: "Pozostałe branże",
    };

    // The month the axis opens on, shared by all three. A sector was first
    // filed years after the first party was, and three sets of lines cannot
    // share an axis unless they are all cut to the same one.
    const from = timelineGroupings
      .flatMap((grouping) => byGrouping[grouping])
      .reduce<string | null>(
        (earliest, post) =>
          earliest === null || post.start < earliest ? post.start : earliest,
        null,
      );

    const groupings = {} as HomeTimelineResponse["groupings"];
    const coverage = {} as HomeTimelineResponse["coverage"];
    let months: string[] = [];

    for (const grouping of timelineGroupings) {
      const built = buildTimeline(byGrouping[grouping], today, {
        labelOf: labels[grouping],
        otherLabel: otherLabels[grouping],
        from: from ?? undefined,
      });
      groupings[grouping] = built.series;
      coverage[grouping] = {
        posts: byGrouping[grouping].length,
        people: new Set(byGrouping[grouping].map((post) => post.personId)).size,
      };
      if (built.months.length > months.length) months = built.months;
    }

    return { months, groupings, coverage, posts, today: today.slice(0, 7) };
  },
  {
    // A day. The series is 300-odd months long and its last point moves when
    // somebody publishes a page, which is not something a reader of the home
    // page is waiting on; an editor who wants it fresh passes `?latest`.
    maxAge: 86400,
    name: "homeTimeline",
    getKey: (today: string) => today,
  },
);

/** How many people held a post each month, split three ways.
 *
 * Feeds the „Wykres” panel of the home page explorer - the busiest route on the
 * site - so it is cached hard on both sides: a day in `cachedTimeline`, keyed on
 * the Warsaw day, behind the six-hour response cache every public endpoint has.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<HomeTimelineResponse> => cachedTimeline(warsawDate()),
  { name: "api-stats-homeTimeline" },
);
