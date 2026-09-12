import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { fetchEdgeEndpointNodes } from "~~/server/utils/edgeNodes";
import { asArray, pageIsPublic } from "~~/shared/model";
import { partyColors } from "~~/shared/misc";
import { warsawDate } from "~~/shared/dates";
import {
  buildPartyTimeline,
  effectiveEnd,
  type HeldPost,
  type PartyTimeline,
} from "~~/shared/partyTimeline";
import type { Edge, Person } from "~~/shared/model";

export type PartyTimelineResponse = PartyTimeline & {
  /** The Warsaw month the series ends on, `YYYY-MM`, so the chart can label its
   * right-hand edge without a second clock. */
  today: string;
  /** How many posts went into it, for the „na podstawie N stanowisk” line. */
  posts: number;
  /** How many distinct people those posts belong to. Not the sum of the last
   * month's lines - somebody filed under two parties is on two of them. */
  people: number;
};

/** How many edges to read per round trip while scanning. */
const SCAN_PAGE = 500;

/** The most edge documents one computation will read. Twice the 3,256
 * published employments on the 2026-09-12 export, so the ceiling is a guard
 * against a runaway query rather than a limit the data is near. */
const MAX_SCAN = 20000;

/** The node fields this endpoint reads. Field-masked because it fetches every
 * node the published employments touch - roughly 2,500 documents - and then
 * holds the result in nitro's cache; `activity`, `categories` and `stats` are
 * no part of the answer. Same argument /api/edges/serviceMilestones makes. */
const NODE_FIELDS = ["type", "published", "deleted", "parties"];

/** Every published employment, as posts the timeline can count.
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
 * collection too, and the nodes have to be read anyway to find the parties.
 *
 * Every published post counts, not only the ones in a state-owned company:
 * a page is on the site because an editor judged it worth publishing, so the
 * filter has already been applied by hand. `isPublic` would have dropped a
 * quarter of the posts, and most of what it dropped is companies nobody has
 * classified yet rather than companies known to be private.
 */
const cachedTimeline = defineCachedFunction(
  async (today: string): Promise<PartyTimelineResponse> => {
    const db = getFirestore(getApp(), "koryta-pl");

    const edges: (Edge & { id: string })[] = [];
    let scanned = 0;
    let cursor: { startDate: string; id: string } | null = null;

    for (;;) {
      let q = db
        .collection("edges")
        .where("type", "==", "employed")
        .where("published", "==", true)
        // The order is not one this view wants - it wants none - but it is the
        // index `edges` already carries for these two filters, and it gives the
        // scan a cursor to resume from. `__name__` is spelled out because a raw
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

    const nodes = await fetchEdgeEndpointNodes(db, edges, NODE_FIELDS);

    const posts: HeldPost[] = [];
    const people = new Set<string>();
    for (const edge of edges) {
      const person = nodes.get(edge.source);
      if (person?.type !== "person" || !pageIsPublic(person)) continue;
      const employer = nodes.get(edge.target);
      if (!employer || !pageIsPublic(employer)) continue;

      // `asArray`, not `.parties ?? []`: a node written before 2026-07-28 holds
      // `{"0": "PiS"}` where the array belongs, and reading it as an array
      // loses the value silently rather than failing.
      const parties = asArray((person as Person).parties).filter(
        // Only the parties the site has a colour for. One it has not is stored
        // and then invisible everywhere else - no chip, no legend entry, no
        // line here - and a chart is the wrong place to start showing them,
        // since a line with no colour of its own is a line nobody can name.
        (party) => typeof party === "string" && party in partyColors,
      );
      if (parties.length === 0) continue;

      people.add(edge.source);
      posts.push({
        personId: edge.source,
        parties,
        start: edge.start_date!,
        end: effectiveEnd(edge.end_date),
      });
    }

    return {
      ...buildPartyTimeline(posts, today),
      today: today.slice(0, 7),
      posts: posts.length,
      people: people.size,
    };
  },
  {
    // A day. The series is 300-odd months long and its last point moves when
    // somebody publishes a page, which is not something a reader of the home
    // page is waiting on; an editor who wants it fresh passes `?latest`.
    maxAge: 86400,
    name: "partyTimeline",
    getKey: (today: string) => today,
  },
);

/** How many people held a post each month, one line per party.
 *
 * Feeds the chart above „Co nowego” on the home page - the busiest route on the
 * site - so it is cached hard on both sides: a day in `cachedTimeline`, keyed on
 * the Warsaw day, behind the six-hour response cache every public endpoint has.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<PartyTimelineResponse> => cachedTimeline(warsawDate()),
  { name: "api-stats-partyTimeline" },
);
