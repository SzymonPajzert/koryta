import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { fetchEdgeEndpointNodes } from "~~/server/utils/edgeNodes";
import { pageIsPublic } from "~~/shared/model";
import {
  bodyIsPaidPost,
  displayRole,
  namesASupervisorySeat,
} from "~~/shared/companyBodies";
import { warsawDate } from "~~/shared/dates";
import {
  dayIso,
  dayNumber,
  mergeSpells,
  milestonesInWindow,
} from "~~/shared/serviceMilestones";
import type { Company, Edge, Person } from "~~/shared/model";
import type { H3Event } from "h3";
import { z } from "zod";

/** The day somebody's service in public institutions adds up to a whole number
 * of years, flattened into what a card needs to draw itself.
 *
 * Not the anniversary of a post. A career with a gap in it reaches ten years
 * later than the tenth anniversary of the day it began, by however long the
 * gap was, and working that date out is the whole point of the page - see
 * `milestoneDay`.
 */
export type ServiceMilestone = {
  /** `${personId}:${years}`. A person can only ever have one milestone inside
   * a window this narrow - consecutive ones are a year of service apart - so
   * this is unique, but it is keyed on both halves rather than on the person
   * so that a wider window would not silently collide. */
  id: string;
  personId: string;
  personName: string;
  /** Parties the person is filed under, for the chips on the card. */
  parties: string[];
  /** The whole number of years reached. At least 1. */
  years: number;
  /** The day it is reached, ISO. */
  date: string;
  /** Days from today: negative for one already past, 0 for today, positive for
   * one still to come. */
  daysFromToday: number;
  /** The post being held that day - the one the milestone falls inside. Where
   * several were held at once it is the longest-running of them. */
  companyId: string;
  companyName: string;
  /** Enough of the company for `ChipPublicCompany` to decide what to say. */
  companyIsPublic?: boolean;
  companyIsPublicSource?: "manual";
  /** The role, named after the organ the institution actually has - see
   * `displayRole`. Null where nobody recorded one. */
  role: string | null;
  /** How many further posts were held on the same day. */
  alsoHeld: number;
  /** How many distinct institutions the total is spread across. */
  institutions: number;
  /** How many separate spells of service the total is made of. More than one
   * means the career has a gap, so the date is not an anniversary of anything
   * and the card says so. */
  spells: number;
  /** Whether the milestone is reached in a post nobody has closed - which
   * makes a future one a projection rather than a fact, and is worth marking
   * as such. */
  projected: boolean;
};

/** Which slice of the window is being asked for.
 *
 * `upcoming` and `past` are the two halves /eksploruj/staz toggles between and
 * they partition the window: today counts as upcoming, being the one day that
 * has not gone by. `recent` is the two of them the other way round - today and
 * everything behind it, newest first - which is not a half but the shape a
 * reverse-chronological feed of things that have *happened* needs. The home
 * page merges it into its own feed, where a date still ahead of us would sort
 * above every card around it and read as news. */
export const milestoneScopes = ["upcoming", "past", "recent"] as const;

export type MilestoneScope = (typeof milestoneScopes)[number];

export type ServiceMilestones = {
  milestones: ServiceMilestone[];
  /** Which slice this page is taken from, echoed so the toggle can be drawn
   * from the response rather than trusted from the url. */
  scope: MilestoneScope;
  /** How many the requested slice holds, which is what its own feed ends at. */
  total: number;
  /** Both halves' sizes, sent whichever slice was asked for, because the
   * toggle labels both buttons and neither can be read off the cards on
   * screen. */
  upcoming: number;
  past: number;
  /** Where the next page starts, or null once the feed is exhausted. */
  nextOffset: number | null;
  /** The Warsaw day the list was computed against. */
  today: string;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  scope: z.enum(milestoneScopes).default("upcoming"),
});

/** How far either side of today the window reaches, in days. */
const WINDOW_DAYS = 30;

/** How many edges to read per round trip while scanning. */
const SCAN_PAGE = 500;

/** The most edge documents one computation will read. */
const MAX_SCAN = 20000;

/** The node fields this endpoint reads.
 *
 * Field-masked because it now has to fetch every node the published
 * employments touch - roughly 2,500 documents - rather than only the few
 * hundred a date filter used to leave: the total is a property of the whole
 * career, so no edge can be dropped before the person has been added up. The
 * read count is the same either way; what this keeps down is the size of the
 * cached result sitting in nitro's in-memory store.
 */
const NODE_FIELDS = [
  "name",
  "type",
  "published",
  "deleted",
  "parties",
  "isPublic",
  "isPublicSource",
  "supervisoryBody",
];

/** Whether this post counts towards the service the site reports.
 *
 * The same two rules `publicEmployment` in `shared/stats.ts` applies, and they
 * have to be the same two: the card puts „10 lat pracy” against a career the
 * rest of the site totals with those rules, so a seat counted in one and not
 * the other would move the date this page is built on. Known-public places
 * only, and no rada spoleczna seat at an SPZOZ, because nobody is paid to sit
 * on one.
 */
function countsAsPublicService(edge: Edge, company: Company): boolean {
  if (company.isPublic !== true) return false;
  if (
    !bodyIsPaidPost(company.supervisoryBody) &&
    namesASupervisorySeat(edge.name)
  ) {
    return false;
  }
  return true;
}

type CountedEdge = Edge & { id: string };

/** Every milestone falling in the window, oldest first.
 *
 * One row per person and milestone. A person can hold three seats at once and
 * still have one career, which is the difference between this and a feed of
 * post anniversaries: the seats are merged into stretches of service first and
 * the years are counted off the merged total.
 */
function collect(
  byPerson: Map<string, CountedEdge[]>,
  nodes: Map<string, Person | Company>,
  today: number,
): ServiceMilestone[] {
  const rows: ServiceMilestone[] = [];
  const from = today - WINDOW_DAYS;
  const to = today + WINDOW_DAYS;

  for (const [personId, edges] of byPerson) {
    const person = nodes.get(personId);
    if (person?.type !== "person" || !pageIsPublic(person)) continue;

    const merged = mergeSpells(
      edges.map((edge) => ({ start: edge.start_date!, end: edge.end_date })),
    );
    if (merged.length === 0) continue;

    for (const { years, day } of milestonesInWindow(merged, from, to)) {
      // Which post carried them over the line. Longest-running first, so a
      // seat taken up that morning does not outrank the job they have held
      // for a decade.
      const held = edges
        .filter((edge) => {
          const start = dayNumber(edge.start_date);
          const end = edge.end_date ? dayNumber(edge.end_date) : null;
          return start !== null && start <= day && (end === null || end >= day);
        })
        .sort(
          (a, b) =>
            (dayNumber(a.start_date) ?? 0) - (dayNumber(b.start_date) ?? 0),
        );

      // By construction the milestone falls inside a stretch of service, so
      // something was being held that day - but the stretch was merged from
      // these same edges, so this is an assertion about the merge rather than
      // about the data, and a row with nothing to name is not worth drawing.
      const carrying = held[0];
      if (!carrying) continue;
      const company = nodes.get(carrying.target);
      if (company?.type !== "place") continue;

      rows.push({
        id: `${personId}:${years}`,
        personId,
        personName: person.name,
        parties: (person as Person).parties ?? [],
        years,
        date: dayIso(day),
        daysFromToday: day - today,
        companyId: carrying.target,
        companyName: company.name,
        companyIsPublic: (company as Company).isPublic,
        companyIsPublicSource: (company as Company).isPublicSource,
        role:
          typeof carrying.name === "string"
            ? (displayRole(carrying.name, company as Company) ?? null)
            : null,
        alsoHeld: held.length - 1,
        institutions: new Set(edges.map((edge) => edge.target)).size,
        spells: merged.length,
        // The last stretch has no end, so anything at or beyond its start is
        // being counted on the post staying held.
        projected: merged[merged.length - 1]!.end === null && day >= today,
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      b.years - a.years ||
      a.personName.localeCompare(b.personName, "pl"),
  );
  return rows;
}

/** The whole window, computed once a day and paged out of memory.
 *
 * Keyed on the Warsaw day rather than on the page being asked for. The scan
 * cannot be narrowed - a milestone is a property of somebody's whole career,
 * so there is no query that returns only the careers with one falling this
 * month - which means reading every published `employed` edge, 3,047 of them
 * on 2026-09-09, and then every node they touch. Paging that through the
 * handler's own cache would charge it again for every offset a reader scrolls
 * to.
 */
const cachedMilestones = defineCachedFunction(
  async (today: string): Promise<ServiceMilestone[]> => {
    const todayDay = dayNumber(today);
    if (todayDay === null) return [];

    const db = getFirestore(getApp(), "koryta-pl");
    const edges: CountedEdge[] = [];
    let scanned = 0;
    let cursor: { startDate: string; id: string } | null = null;

    for (;;) {
      let q = db
        .collection("edges")
        .where("type", "==", "employed")
        .where("published", "==", true)
        // Not the order this view wants - it wants none - but it is the index
        // `edges` already carries for these two filters, and it gives the scan
        // a cursor to resume from. See recentEmployments for why `__name__` is
        // spelled out.
        .orderBy("start_date", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(SCAN_PAGE);
      if (cursor) q = q.startAfter(cursor.startDate, cursor.id);

      const snap = await q.get();
      scanned += snap.size;
      if (snap.empty) break;

      for (const doc of snap.docs) {
        const edge = { id: doc.id, ...(doc.data() as Edge) };
        // An explicit null start_date is a value the index sorts rather than
        // one it drops, and it cannot be a cursor either.
        if (typeof edge.start_date !== "string") continue;
        cursor = { startDate: edge.start_date, id: edge.id };
        if (edge.deleted === true || !edge.source || !edge.target) continue;
        edges.push(edge);
      }

      if (snap.size < SCAN_PAGE || scanned >= MAX_SCAN) break;
    }

    const nodes = await fetchEdgeEndpointNodes(db, edges, NODE_FIELDS);

    // Grouped after the nodes are in, because whether a post counts is a fact
    // about the institution rather than about the edge.
    const byPerson = new Map<string, CountedEdge[]>();
    for (const edge of edges) {
      const company = nodes.get(edge.target);
      if (company?.type !== "place" || !pageIsPublic(company)) continue;
      if (!countsAsPublicService(edge, company as Company)) continue;
      const held = byPerson.get(edge.source);
      if (held) held.push(edge);
      else byPerson.set(edge.source, [edge]);
    }

    return collect(byPerson, nodes, todayDay);
  },
  {
    maxAge: 3600,
    name: "serviceMilestones",
    getKey: (today: string) => today,
  },
);

/** Whole years of service in public institutions, reached this month or next.
 *
 * One slice of the window per request, each opening on the day nearest today:
 * the upcoming ones soonest first, the past and the recent ones most recent
 * first.
 */
async function serviceMilestones(event: H3Event): Promise<ServiceMilestones> {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const today = warsawDate();
  const all = await cachedMilestones(today);

  // Today belongs to the upcoming half: it has not gone by, and it is the one
  // card on the page that is happening now.
  const upcoming = all.filter((item) => item.daysFromToday >= 0);
  // Sorted backwards rather than reversed, so the half runs from yesterday
  // towards the edge of the window while a single day still puts the longer
  // service first.
  const past = all
    .filter((item) => item.daysFromToday < 0)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.years - a.years ||
        a.personName.localeCompare(b.personName, "pl"),
    );

  // Today and everything behind it, ordered like `past` and with today's cards
  // in front. Overlaps both halves on purpose - it is a different question,
  // not a third piece of the same partition - so `upcoming` and `past` below
  // stay the counts the toggle labels itself with whichever scope was asked
  // for.
  const recent = all
    .filter((item) => item.daysFromToday <= 0)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.years - a.years ||
        a.personName.localeCompare(b.personName, "pl"),
    );

  const scoped =
    query.scope === "past"
      ? past
      : query.scope === "recent"
        ? recent
        : upcoming;
  const page = scoped.slice(query.offset, query.offset + query.limit);
  const next = query.offset + page.length;

  return {
    milestones: page,
    scope: query.scope,
    total: scoped.length,
    upcoming: upcoming.length,
    past: past.length,
    nextOffset: next < scoped.length ? next : null,
    today,
  };
}

/** An hour, matching the computation behind it.
 *
 * `editorFreshCachedEventHandler` rather than the plain cached one so that a
 * signed in reader gets a fresh *slice* - `offset` indexes into a list whose
 * contents an editor can change. It does not recompute the window: that sits
 * behind `cachedMilestones` and stays an hour old for everybody, deliberately,
 * since bypassing it would charge the whole scan to every page an editor
 * scrolls to.
 */
export default editorFreshCachedEventHandler(serviceMilestones, {
  maxAge: 3600,
  name: "serviceMilestones",
});
