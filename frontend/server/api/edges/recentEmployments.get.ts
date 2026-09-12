import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { fetchEdgeEndpointNodes } from "~~/server/utils/edgeNodes";
import { asArray, pageIsPublic } from "~~/shared/model";
import { displayRole } from "~~/shared/companyBodies";
import { publicBadgeIds } from "~~/shared/badges";
import type { Company, Edge, Person } from "~~/shared/model";
import type { H3Event } from "h3";
import { z } from "zod";

/** One spell of employment, flattened into what a card needs to draw itself.
 *
 * The person and the company are both named here rather than left as ids: the
 * feed is read by somebody who has not opened either page, and a second round
 * trip per card to find out whose job this was would be the whole cost of the
 * section.
 */
export type RecentEmployment = {
  /** The edge id, which is what keys the card in the list. */
  id: string;
  personId: string;
  personName: string;
  /** Parties the person is filed under, for the chips on the card. */
  parties: string[];
  /** Odznaki this person carries, as bare catalogue ids (no `badge:` prefix),
   * for `BadgePersonRow`.
   *
   * Only the ones in state "public": these cards are served to a logged-out
   * visitor and to Google, and the two other states - a proposal below the
   * threshold, and one over it that no editor has approved - are by definition
   * one or three readers' unreviewed opinion about a named person. That filter
   * is `publicBadgeIds`, never a comparison written out here: the rule has four
   * outcomes and shared/badges.ts is the one place it is decided.
   *
   * Omitted rather than sent empty, like `companyCategories` above and for the
   * same reason - almost nobody has a badge, and this is twenty cards. */
  badges?: string[];
  companyId: string;
  companyName: string;
  /** Enough of the company for `ChipPublicCompany` to decide what to say. Both
   * flags mean nothing on their own - see `publicSectorKnown`. */
  companyIsPublic?: boolean;
  companyIsPublicSource?: "manual";
  /** The sectors the company is filed under, for `ChipCompanyCategories`.
   * Already unwrapped from the sanitized-array form, and omitted rather than
   * sent empty - most companies have none, and this is twenty cards. */
  companyCategories?: string[];
  /** The role, as the edge names it - except that a supervisory seat is named
   * after the organ the company actually has, which the edge cannot be: see
   * `displayRole`. Null where nobody recorded one. */
  role: string | null;
  start_date: string;
  end_date: string | null;
};

export type RecentEmployments = {
  employments: RecentEmployment[];
  /** Where the next page starts, as `${start_date}|${edgeId}`. Null once the
   * feed is exhausted, which is what stops the scroll asking for more. */
  nextCursor: string | null;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/** How many edges to read per round trip while filling a page. Larger than the
 * page so that the rows dropped below survive one batch rather than costing a
 * second. */
const SCAN_PAGE = 60;

/** The most edge documents one request will read. A page that cannot be filled
 * within this returns short with a cursor, rather than scanning the collection
 * on the home page's behalf. */
const MAX_SCAN = 600;

/** Splits `${start_date}|${edgeId}` back into its two halves.
 *
 * On the first `|` rather than the only one: a Firestore document id may
 * contain anything but a slash, so the id is whatever is left, while
 * `start_date` never holds one.
 */
function parseCursor(
  cursor: string | undefined,
): { startDate: string; id: string } | null {
  if (!cursor) return null;
  const at = cursor.indexOf("|");
  if (at <= 0 || at === cursor.length - 1) return null;
  return { startDate: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

/** The employments the site knows about, most recently begun first.
 *
 * "Most recent" is `start_date`, not when the row was written: the reader is
 * being shown who has just taken a post, and the import order of a KRS batch
 * says nothing about that. The cost of that choice is that an employment with
 * no start date never appears here at all - a Firestore `orderBy` matches no
 * document missing the field it sorts on - which is the same 195-odd hand
 * entered edges `test_a_dated_edge_says_when_it_began` already budgets for.
 *
 * Published edges only, and then both endpoints checked again against the
 * nodes. The publish rule already refuses an edge whose ends are not both
 * live, and unpublishing a node cascades to its edges, so the flag on the edge
 * should be enough on its own - but "should" is doing the work of an invariant
 * that only the app maintains, and the pipelines write this collection too.
 * The endpoints have to be read anyway to name them, so checking costs
 * nothing beyond the read.
 */
async function recentEmployments(event: H3Event): Promise<RecentEmployments> {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore(getApp(), "koryta-pl");

  const employments: RecentEmployment[] = [];
  let cursor = parseCursor(query.cursor);
  let scanned = 0;
  let exhausted = false;

  while (employments.length < query.limit && scanned < MAX_SCAN && !exhausted) {
    let q = db
      .collection("edges")
      .where("type", "==", "employed")
      .where("published", "==", true)
      .orderBy("start_date", "desc")
      // Spelled out rather than left implicit, and the whole cursor depends on
      // it. Firestore only appends `__name__` for a cursor given as a document
      // snapshot (`createImplicitOrderByForCursor`); against raw values it
      // compares the count to the *declared* orders and throws "Too many cursor
      // values specified" - so a two-value `startAfter` under one `orderBy`
      // fails on every page but the first. The composite index needs no field
      // for it: an index ends in `__name__` in the direction of its last
      // ordered field, which is descending here.
      //
      // The id half is not decoration either. Every row of a KRS import shares
      // a start date, so a date-only cursor landing inside one of those groups
      // would resume at the top of it and loop.
      .orderBy(FieldPath.documentId(), "desc")
      .limit(SCAN_PAGE);
    if (cursor) q = q.startAfter(cursor.startDate, cursor.id);

    const snap = await q.get();
    scanned += snap.size;
    if (snap.empty) {
      exhausted = true;
      break;
    }

    const edges = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Edge),
    }));
    const nodes = await fetchEdgeEndpointNodes(db, edges);

    // The cursor follows what was examined rather than what was returned, so
    // that filling the page halfway through a batch does not skip the rest of
    // it. `unpublished.get.ts` makes the same argument at greater length.
    let consumed = 0;
    for (const edge of edges) {
      consumed += 1;
      // Not `edge.start_date!`: /api/edges/create writes an explicit null when
      // the form field was left blank, and null is a value the index sorts
      // (last, descending) rather than one it drops. Such a row cannot be a
      // cursor - `${null}|id` would resume nowhere - so it is skipped without
      // moving the cursor past it, which the next scan does by ordering.
      if (typeof edge.start_date !== "string") continue;
      cursor = { startDate: edge.start_date, id: edge.id };
      if (edge.deleted === true || !edge.source || !edge.target) continue;

      const person = nodes.get(edge.source);
      const company = nodes.get(edge.target);
      // An employment runs person -> place. Anything else is a row the ingest
      // mislabelled, and the card has nowhere to send a click.
      if (person?.type !== "person" || company?.type !== "place") continue;
      if (!pageIsPublic(person) || !pageIsPublic(company)) continue;

      const categories = asArray<string>((company as Company).categories);
      // Free: `fetchEdgeEndpointNodes` is called above with no field mask, so
      // it has already read the whole person document (server/utils/edgeNodes.ts
      // - `fieldMask` omitted means `db.getAll(...refs)`), and Firestore bills a
      // document rather than a field. Both inputs are therefore in memory
      // already; the badges cost this endpoint zero additional reads and only
      // the bytes of a short array of slugs in nitro's cached result.
      //
      // `stats` lives on `PageBase` and needs no cast; `badgeModeration` lives
      // on `Person` (shared/model.ts:362), and the map holds `Person | Company`,
      // so that one does - the same cast `parties` below already makes.
      const badges = publicBadgeIds(
        person.stats?.badges,
        (person as Person).badgeModeration,
      );

      employments.push({
        id: edge.id,
        personId: edge.source,
        personName: person.name,
        parties: (person as Person).parties ?? [],
        ...(badges.length ? { badges } : {}),
        companyId: edge.target,
        companyName: company.name,
        companyIsPublic: (company as Company).isPublic,
        companyIsPublicSource: (company as Company).isPublicSource,
        ...(categories.length ? { companyCategories: categories } : {}),
        role:
          typeof edge.name === "string"
            ? (displayRole(edge.name, company as Company) ?? null)
            : null,
        start_date: edge.start_date,
        end_date: edge.end_date ?? null,
      });
      if (employments.length >= query.limit) break;
    }

    // Only a batch read to its end, and shorter than what was asked for, means
    // there is nothing behind it.
    if (consumed === snap.size && snap.size < SCAN_PAGE) exhausted = true;
  }

  return {
    employments,
    nextCursor:
      exhausted || !cursor ? null : `${cursor.startDate}|${cursor.id}`,
  };
}

/** Fifteen minutes rather than the six hours `authCachedEventHandler` defaults
 * to. This is the one block on the home page that claims to be current, and an
 * ingest run whose results only surface the following afternoon reads as a
 * feed that has stopped moving. Short enough to notice a run, long enough that
 * the home page is not paying forty document reads a visitor. */
export default editorFreshCachedEventHandler(recentEmployments, {
  maxAge: 900,
  name: "recentEmployments",
});
