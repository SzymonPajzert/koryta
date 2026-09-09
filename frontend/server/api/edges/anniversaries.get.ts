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
import { isoDay, warsawDate } from "~~/shared/dates";
import type { IsoDay } from "~~/shared/dates";
import type { Company, Edge, Person } from "~~/shared/model";
import type { H3Event } from "h3";
import { z } from "zod";

/** One anniversary of one post, flattened into what a card needs to draw
 * itself.
 *
 * Both ends are named here rather than left as ids, for the same reason
 * `RecentEmployment` names them: nobody reading the feed has opened either
 * page, and a round trip per card to find out whose job this was would be the
 * whole cost of the view.
 */
export type WorkAnniversary = {
  /** The edge id, which is what keys the card in the list. */
  id: string;
  personId: string;
  personName: string;
  /** Parties the person is filed under, for the chips on the card. */
  parties: string[];
  companyId: string;
  companyName: string;
  /** Enough of the company for `ChipPublicCompany` to decide what to say. */
  companyIsPublic?: boolean;
  companyIsPublicSource?: "manual";
  /** The role, named after the organ the institution actually has - see
   * `displayRole`. Null where nobody recorded one. */
  role: string | null;
  /** The day the post began. */
  start_date: string;
  /** Whether the post is still held, which is what the card tints. */
  ongoing: boolean;
  /** The day this year's anniversary falls on, ISO. */
  date: string;
  /** Which anniversary it is. Always at least 1 - a post taken up four months
   * ago has not had one yet. */
  years: number;
  /** Days from today: negative for one already past, 0 for today, positive for
   * one still to come. */
  daysFromToday: number;
  /** Everything this person has served in public institutions, in years, as
   * `stats.edges.approved.experienceMonths` already totals it. Not the same
   * number as `years` above: that one is this post, this one is the sum of
   * every post they hold or have held. */
  experienceYears: number;
};

export type WorkAnniversaries = {
  anniversaries: WorkAnniversary[];
  /** How many the window holds in total, so the page can say so without
   * scrolling to the end of the feed. */
  total: number;
  /** How many of those have not happened yet, today's included. Counted here
   * rather than off the loaded cards, which are only ever a prefix of the
   * window and would undercount the half the reader has not scrolled to. */
  upcoming: number;
  /** Where the next page starts, or null once the feed is exhausted - which is
   * what stops the scroll asking for more. */
  nextOffset: number | null;
  /** The Warsaw day the list was computed against. Sent because it is what
   * `daysFromToday` is relative to, and a response served from cache can be a
   * few hours old. */
  today: string;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** How far either side of today the window reaches, in days.
 *
 * "One month" as the request put it, and a fixed 30 rather than a calendar
 * month so that the page holds roughly the same number of cards whichever
 * month it is read in.
 */
const WINDOW_DAYS = 30;

/** How many edges to read per round trip while scanning. */
const SCAN_PAGE = 500;

/** The most edge documents one computation will read.
 *
 * There were 3,047 published `employed` edges on 2026-09-09, so the whole
 * collection fits several times over and the cap only exists so that this
 * cannot quietly turn into a full-collection scan the way /api/nodes did - see
 * the note on `_cachedFetchNodes`. Hitting it truncates the window rather than
 * failing, which is the right way round for a page nobody is deciding anything
 * from.
 */
const MAX_SCAN = 20000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days the given month of the given year has. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The anniversary of `start` that falls inside the window around `today`, or
 * null if none does.
 *
 * A 29 February start is kept rather than dropped: it is clamped to the 28th
 * in a year that has no 29th, which is what every register and every payroll
 * does with one. Without the clamp `Date.UTC` would roll it into 1 March and
 * the card would name a day the post did not begin on.
 *
 * At most one candidate year can land in the window - it is 61 days wide and
 * anniversaries are a year apart - so the first hit is the answer.
 */
function anniversaryOf(
  start: IsoDay,
  today: IsoDay,
): { date: string; years: number; daysFromToday: number } | null {
  const todayMs = Date.UTC(today.y, today.m - 1, today.d);

  for (const year of [today.y - 1, today.y, today.y + 1]) {
    const years = year - start.y;
    // A post taken up eight months ago has an "anniversary" this year that is
    // its own start date. That is not an anniversary, it is the day it began,
    // and /api/edges/recentEmployments is the feed for those.
    if (years < 1) continue;

    const day = Math.min(start.d, daysInMonth(year, start.m));
    const ms = Date.UTC(year, start.m - 1, day);
    const daysFromToday = Math.round((ms - todayMs) / DAY_MS);
    if (daysFromToday < -WINDOW_DAYS || daysFromToday > WINDOW_DAYS) continue;

    const iso = `${year}-${String(start.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { date: iso, years, daysFromToday };
  }
  return null;
}

/** Whether this post counts towards the experience the site reports.
 *
 * The same two rules `publicEmployment` in `shared/stats.ts` applies, and they
 * have to be the same two: the card puts "10. rocznica" next to a total that
 * comes straight out of `stats.edges.approved`, so a seat that is in one and
 * not the other prints an anniversary of service the total says never
 * happened. A rada społeczna seat at an SPZOZ is the case that bites - 21 of
 * the 411 anniversaries in the window on 2026-09-09 - because nobody is paid
 * to sit on one.
 *
 * `isPublic !== true` is the other half, and it is deliberately strict: a place
 * whose ownership nobody has established is left out rather than guessed at,
 * so this page is a floor. See `Company.isPublic`.
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

/** Every anniversary in the window, oldest first.
 *
 * Ordered as the reader asked for it: the ones already past, running up to
 * today and on into the ones still to come. Ties are broken by the longer
 * service and then by name, so a day that carries a 25th and a 2nd puts the
 * 25th first.
 */
function collect(
  edges: (Edge & { id: string })[],
  nodes: Map<string, Person | Company>,
  today: IsoDay,
): WorkAnniversary[] {
  const rows: WorkAnniversary[] = [];

  for (const edge of edges) {
    if (edge.deleted === true || !edge.source || !edge.target) continue;
    if (typeof edge.start_date !== "string") continue;
    const start = isoDay(edge.start_date.slice(0, 10));
    if (!start) continue;

    const when = anniversaryOf(start, today);
    if (!when) continue;

    const person = nodes.get(edge.source);
    const company = nodes.get(edge.target);
    // An employment runs person -> place. Anything else is a row the ingest
    // mislabelled, and the card has nowhere to send a click.
    if (person?.type !== "person" || company?.type !== "place") continue;
    // "Already published people", and the same argument recentEmployments
    // makes: the edge's own `published` flag should imply both ends are live,
    // but only the app maintains that invariant and the pipelines write this
    // collection too. The nodes are read anyway to name them.
    if (!pageIsPublic(person) || !pageIsPublic(company)) continue;
    if (!countsAsPublicService(edge, company as Company)) continue;

    // `NodeStats` declares `edges.approved` as required and a stored document
    // is under no such obligation: one of the 1,065 published people in the
    // 2026-09-09 export carries a `stats` with no `edges` at all, having never
    // been through `computeNodes`. Read through a shape that admits it, rather
    // than optional-chaining a type the compiler already believes is there.
    const stats = (person as Person).stats as
      { edges?: { approved?: { experienceMonths?: number } } } | undefined;
    const experience = stats?.edges?.approved?.experienceMonths;

    rows.push({
      id: edge.id,
      personId: edge.source,
      personName: person.name,
      parties: (person as Person).parties ?? [],
      companyId: edge.target,
      companyName: company.name,
      companyIsPublic: (company as Company).isPublic,
      companyIsPublicSource: (company as Company).isPublicSource,
      role:
        typeof edge.name === "string"
          ? (displayRole(edge.name, company as Company) ?? null)
          : null,
      start_date: edge.start_date.slice(0, 10),
      ongoing: !edge.end_date,
      date: when.date,
      years: when.years,
      daysFromToday: when.daysFromToday,
      // Despite the name the field holds years - `calculateExperience` divides
      // by twelve before it returns. The explore table reads the same one and
      // labels it „lat pracy”.
      experienceYears: typeof experience === "number" ? experience : 0,
    });
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
 * Cached separately from the handler, and keyed on the Warsaw day rather than
 * on the page being asked for, because the scan cannot be narrowed: Firestore
 * cannot be asked for the documents whose `start_date` falls on some month and
 * day, only for a range, so finding the anniversaries means reading every
 * published `employed` edge. Paging that through the handler's own cache would
 * charge those ~3,000 reads again for every offset the reader scrolls to.
 * Computed once, sliced twenty at a time.
 */
const cachedAnniversaries = defineCachedFunction(
  async (today: string): Promise<WorkAnniversary[]> => {
    const day = isoDay(today);
    if (!day) return [];

    const db = getFirestore(getApp(), "koryta-pl");
    const kept: (Edge & { id: string })[] = [];
    let scanned = 0;
    let cursor: { startDate: string; id: string } | null = null;

    for (;;) {
      let q = db
        .collection("edges")
        .where("type", "==", "employed")
        .where("published", "==", true)
        // The order is not what this view wants - it wants a month and a day,
        // which no index holds - but it is the one index `edges` already
        // carries for these two filters (`type, published, start_date DESC`),
        // and it gives the scan a cursor it can resume from. See
        // recentEmployments for why `__name__` is spelled out.
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
        // one it drops, and it cannot be a cursor either - `${null}|id`
        // resumes nowhere - so it is skipped without moving the cursor.
        if (typeof edge.start_date !== "string") continue;
        cursor = { startDate: edge.start_date, id: edge.id };
        // Cheap enough to run before the nodes are read, and it is what keeps
        // the `getAll` below down to the few hundred rows that survive.
        const start = isoDay(edge.start_date.slice(0, 10));
        if (start && anniversaryOf(start, day)) kept.push(edge);
      }

      if (snap.size < SCAN_PAGE || scanned >= MAX_SCAN) break;
    }

    const nodes = await fetchEdgeEndpointNodes(db, kept);
    return collect(kept, nodes, day);
  },
  {
    // An hour, not the six the public cache defaults to. The list turns over
    // at Warsaw midnight and the key turns over with it, so the only thing
    // this bounds is how long a card can go on saying „za 3 dni” after an
    // editor has published the person behind it.
    maxAge: 3600,
    name: "workAnniversaries",
    getKey: (today: string) => today,
  },
);

/** Anniversaries of service in public institutions, for published people.
 *
 * Both halves of the window in one feed, in calendar order: the ones that have
 * just gone by, then today's, then the month ahead. A card is one post, so
 * somebody who took two jobs in the same fortnight years apart appears twice -
 * which is the honest answer, the two being different anniversaries at
 * different institutions.
 */
async function anniversaries(event: H3Event): Promise<WorkAnniversaries> {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const today = warsawDate();
  const all = await cachedAnniversaries(today);

  const page = all.slice(query.offset, query.offset + query.limit);
  const next = query.offset + page.length;

  return {
    anniversaries: page,
    total: all.length,
    upcoming: all.filter((item) => item.daysFromToday >= 0).length,
    nextOffset: next < all.length ? next : null,
    today,
  };
}

/** An hour, matching the computation behind it.
 *
 * `editorFreshCachedEventHandler` rather than the plain cached one so that a
 * signed in reader gets a fresh *slice* - which matters, because `offset`
 * indexes into a list whose contents an editor can change. What it does not
 * do is recompute the window: that sits behind `cachedAnniversaries` and stays
 * an hour old for everybody, deliberately, since bypassing it would charge a
 * three thousand document scan to every page an editor scrolls to. Somebody
 * who has just published a person sees them here within the hour. */
export default editorFreshCachedEventHandler(anniversaries, {
  maxAge: 3600,
  name: "anniversaries",
});
