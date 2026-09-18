import { pageIsPublic, type NodeRevisions } from "./model";
import { normalizeUpdateTime } from "./revisions";

/** When a page last said something different, and how the sitemap says so.
 *
 * `<lastmod>` is a hint about when a crawler should come back, and the one way
 * to lose it is to move it when nothing changed: Google stops trusting the
 * field for a whole site once it spot-checks a moved date against unmoved
 * content, after which a page that genuinely changed gets no benefit from it
 * either. So the value here is only ever an instant something recorded - never
 * `new Date()` at render time, never a build stamp - and only ever one a reader
 * could have noticed.
 *
 * A page is not only its own document. A person's page is mostly the relations
 * hanging off it, and publishing an employment changes what both ends of it say
 * while writing neither node: `publishEdgeInBatch` updates the edge and files
 * an audit row, and `functions/src/edges.ts` then marks only the edge's
 * *source* dirty for `stats.edges`. Measured against the export of 2026-09-18,
 * 4,761 of the 6,802 pages in the sitemap - 70%, nearly all of them companies -
 * are only ever an edge's `target`, so nothing on the site writes to them at
 * all when a relation appears on them. `content_changed_at` is what closes
 * that gap; this module is the pair of it that reads the answer back.
 */

/** The field, on a node document.
 *
 * ISO 8601 UTC, a string rather than a `Timestamp`, and not for symmetry with
 * `AuditEntry.at` alone: this value is read back through a cached handler whose
 * stored answer is JSON, and a `Timestamp` that has been through JSON is
 * `{_seconds, _nanoseconds}`. @nuxtjs/sitemap's `normaliseDate` takes the
 * string branch or calls `getUTCFullYear` on whatever it was handed, so a map
 * there is an uncaught `TypeError` - and it is raised while building the
 * urlset, so one such value 500s the whole of /sitemap.xml rather than dropping
 * one entry. A string it either accepts or discards, entry intact.
 *
 * A constant rather than a literal because three unrelated files write it -
 * /api/nodes/publish, the edge trigger and the backfill - and the rules about
 * what may move it live here, in `sitemapLastmod`. */
export const CONTENT_CHANGED_AT = "content_changed_at";

/** How far ahead of the reader's own clock a stored date may be and still be
 * believed. Two containers a second apart is ordinary; a year is a bad write,
 * and Google discards a future `lastmod` outright, so past this the field is
 * left out rather than clamped into a claim of freshness the page has not
 * earned. */
const CLOCK_SKEW_ALLOWANCE_MS = 60_000;

function instant(value: unknown): number | undefined {
  // `normalizeUpdateTime` already knows the three shapes a Firestore instant
  // arrives in - the class, the JSON husk of it, and an ISO string somebody
  // already converted - so this does not need a fourth parser of its own.
  const iso = normalizeUpdateTime(value);
  if (iso === null) return undefined;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The `<lastmod>` for one page, or nothing to leave the element out.
 *
 * The newer of two recorded instants:
 *
 * 1. `content_changed_at` - the page went live, came down, or a relation at
 *    either end of it was published, hidden or edited while live.
 * 2. `revisions.latest_time` - the newest revision written against the node.
 *    Present, a string, and exact on 6,802 of 6,802 sitemap-eligible pages,
 *    which is what gives every url an honest date on the day this ships with no
 *    backfill, and what keeps covering a plain content edit afterwards without
 *    any write site having to remember to stamp anything.
 *
 * `latest_time` is dropped where `has_unapproved` is true, and that is the
 * whole reason the flag is read here. `computeRevisionsObj` picks the newest
 * revision regardless of status, so a proposal nobody has accepted moves that
 * date while the public page still says exactly what it said before - 7 of the
 * 6,802 pages are in that state today, and the number grows with editor
 * activity rather than with anything a reader sees. Those pages go out without
 * a `<lastmod>` until something real happens to them, which is what the
 * sitemap spec asks for where the date is not known.
 *
 * Deliberately *not* moved by: a vote, `stats.factsCount`, `stats.edges`, a
 * `nameChunksLower` rewrite, a `/api/stats/computeNodes` pass that rewrites all
 * 17,686 nodes, a draft relation nobody has published, or a nightly re-ingest
 * that restated a company it learned nothing new about - `revisionChangesNothing`
 * skips that write, so no revision is filed and this date does not move.
 */
export function sitemapLastmod(
  node: { content_changed_at?: string; revisions?: NodeRevisions | null },
  now: Date = new Date(),
): string | undefined {
  const stamped = instant(node.content_changed_at);
  const revised =
    node.revisions?.has_unapproved === true
      ? undefined
      : instant(node.revisions?.latest_time);

  const candidates = [stamped, revised].filter(
    (value): value is number => value !== undefined,
  );
  if (candidates.length === 0) return undefined;

  const latest = Math.max(...candidates);
  const nowMs = now.getTime();

  // Beyond the allowance the date is not skew but a bad write, and saying
  // nothing is better than saying something a crawler will throw away anyway.
  if (latest > nowMs + CLOCK_SKEW_ALLOWANCE_MS) return undefined;

  // Inside it, clamp: a `lastmod` in the future is the one value the spec calls
  // invalid, and a page really was modified a second ago.
  return new Date(Math.min(latest, nowMs)).toISOString();
}

/** The pages an edge write changed, from the edge before and after it.
 *
 * Both ends of both versions. `before` is what makes a relation that moved off
 * a page still move that page's date, and `target` is what makes the company
 * hear about an employment at all - `functions/src/edges.ts` marks only the
 * `source` dirty for `stats.edges`, which is the right rule for counting what a
 * node points at and the wrong one for a page.
 *
 * Empty unless the edge was public on one side of the write, and that gate is
 * the difference between a `lastmod` Google keeps using and one it stops
 * trusting site-wide. Two edges in three are drafts - 33,475 of 49,583 - and
 * the ingest creates, corrects and deletes them by the thousand: 880 edge
 * writes a day on average and 4,373 on the worst day measured, against 0-53
 * publication flips a day. Ungated, a routine ingest run would hand a fresh
 * date to thousands of already-published company pages on which a reader would
 * find nothing new. A draft relation is invisible, so it cannot change a page
 * until it is published - and when it is, that write passes this gate.
 *
 * Here rather than beside its one caller in `functions/src/edges.ts` so that it
 * can be tested: a test importing that module resolves `firebase-admin` through
 * `functions/node_modules`, which `vi.mock` cannot reach and which a fresh
 * worktree does not even have.
 */
export function pagesChangedByEdgeWrite(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  if (!pageIsPublic(before ?? {}) && !pageIsPublic(after ?? {})) return [];

  return [
    ...new Set(
      [before, after]
        .flatMap((edge) => [edge?.source, edge?.target])
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}
