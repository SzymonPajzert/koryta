import type { Firestore, Query } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { ActivityKind } from "~~/shared/activity";
import { normalizeUpdateTime } from "~~/shared/revisions";
import type { ActivityEvent } from "~~/server/utils/activityStats";

/** Per-collection ceiling on how many documents one scan may pull.
 *
 * Scans are bounded by a date, not by volume, so a busy quarter or a runaway
 * import could otherwise turn one page view into a full-collection scan. When a
 * scan hits the cap its kind is reported as truncated rather than quietly
 * short — the page says so instead of drawing a dip that never happened. */
const SCAN_CAP = 20_000;

export type CollectedEvents = {
  events: ActivityEvent[];
  /** Kinds whose scan hit `SCAN_CAP`, so their counts are a lower bound. */
  truncated: ActivityKind[];
};

/** The half-open instant range a scan covers: `[since, until)`.
 *
 * `until` is what lets one day be read on its own, which is what the daily
 * rollup in `activityRollup.ts` is built out of. Leaving it off reads everything
 * from `since` to now, which is what a live read of the current day wants — it
 * has no end yet.
 */
export type EventWindow = {
  sinceIso: string;
  /** Exclusive. Omit for "up to now". */
  untilIso?: string;
};

/** Applies the window to a query on `field`.
 *
 * Both bounds are on the same field, so this stays a single-field range scan
 * and needs no composite index — which is the reason every collection is read
 * on one timestamp rather than on a filter plus a date.
 */
function windowed(
  query: Query,
  field: string,
  window: EventWindow,
  asTimestamp = false,
): Query {
  const value = (iso: string) =>
    asTimestamp ? Timestamp.fromDate(new Date(iso)) : iso;

  let scoped = query.where(field, ">=", value(window.sinceIso));
  if (window.untilIso) {
    scoped = scoped.where(field, "<", value(window.untilIso));
  }
  return scoped.orderBy(field, "desc");
}

/** Read every human interaction recorded inside `window`, from each of the
 * collections that records one, and flatten them into a single event list.
 *
 * The four reads are independent, so they run together; each is a range scan
 * on a single field, which Firestore indexes without a composite. */
export async function collectActivityEvents(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const [votes, notes, revisions, publications] = await Promise.all([
    collectVotes(db, window),
    collectNoteSources(db, window),
    collectRevisions(db, window),
    collectPublications(db, window),
  ]);

  return {
    events: [
      ...votes.events,
      ...notes.events,
      ...revisions.events,
      ...publications.events,
    ],
    truncated: [
      ...votes.truncated,
      ...notes.truncated,
      ...revisions.truncated,
      ...publications.truncated,
    ],
  };
}

/** Pages an administrator made public.
 *
 * Read from `audit` rather than from a field on the node: `published` is a
 * boolean the next decision overwrites, so it says what is public now and
 * nothing about when, or by whom, it became so.
 *
 * Only `publish` on `nodes` counts. The rest of what an administrator does —
 * approving, rejecting, hiding, removing, and the `publish` filed per *edge* by
 * `publishEdgeInBatch` — was counted here too, as an `adminDecision` kind, and
 * is not any more. A page reaching the public is the outcome the whole review
 * pipeline exists to produce and the one number worth watching on a chart of
 * days; the steps on the way to it say how much reviewing is happening, which
 * is a different question and one the admin panel's own queues answer. Dropping
 * the edge rows is also what makes this a count of decisions rather than of
 * writes: publishing one person with a dozen relations files twenty-five rows,
 * of which exactly one is the page.
 *
 * This does not double-count against `revision`: that kind counts a change
 * being *proposed* (`update_time`), and this one counts a page being published.
 *
 * Rows are still folded per (who, which page, second), which costs nothing
 * today — `/api/nodes/publish` is the only writer and files one row per request
 * — and keeps a future batch that files two rows for one page in one commit
 * from being read as two decisions. Two *different* pages published in the same
 * second stay two, which is why the page id is in the key.
 */
async function collectPublications(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  // Not filtered in the query: `action` and `collection` alongside a range on
  // `at` would need a composite index, and the scan is capped either way. The
  // rows that are not publications are dropped here instead.
  const snap = await windowed(db.collection("audit"), "at", window)
    .select("user", "at", "action", "collection", "target_id")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const doc of snap.docs) {
    if (doc.get("action") !== "publish" || doc.get("collection") !== "nodes") {
      continue;
    }

    const uid = doc.get("user");
    const at = doc.get("at");
    if (typeof uid !== "string" || typeof at !== "string") continue;

    // Second precision: `at` is `recordAudit`'s ISO instant, so cutting the
    // milliseconds off is what collapses one commit into one decision.
    const commit = `${uid}|${String(doc.get("target_id"))}|${at.slice(0, 19)}`;
    if (seen.has(commit)) continue;
    seen.add(commit);

    events.push({ uid, at, kind: "publication" });
  }

  const truncated: ActivityKind[] =
    snap.size >= SCAN_CAP ? ["publication"] : [];
  return { events, truncated };
}

/** A vote document is one per (target, voter), merged in place, so `updatedAt`
 * is the last time that voter touched that target rather than the moment of
 * any single click.
 *
 * Rating a person in the explore table and rating a fact the extraction
 * pipeline proposed land in the same collection and are told apart only by
 * which id field is set. They were two kinds here and are one now: both are
 * somebody reading a claim and saying whether it holds, and which surface they
 * were looking at when they did it is not what the page is asking. */
async function collectVotes(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(db.collection("votes"), "updatedAt", window)
    .select("userUid", "updatedAt")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    const uid = doc.get("userUid");
    const at = doc.get("updatedAt");
    if (typeof uid !== "string" || typeof at !== "string") continue;
    events.push({ uid, at, kind: "vote" });
  }

  const truncated: ActivityKind[] = snap.size >= SCAN_CAP ? ["vote"] : [];
  return { events, truncated };
}

/** Note entries, counted one per source rather than one per document.
 *
 * A note is a single document per (author, node) that gains sources over time,
 * and only the document carries a timestamp — so every source it holds is
 * attributed to the last time its note was written. For a recent window that
 * reads as "entries this person added"; over a long one it drags older sources
 * forward onto the day their note was last edited.
 *
 * Both timestamps have to be queried: a note written long ago and edited
 * yesterday has `createdAt` outside the window, and a note written yesterday
 * and never edited has no `updatedAt` at all.
 *
 * **And both of the two types they are stored in**, which is why this column
 * was reading a small fraction of the truth. `saveNote` stamps with
 * `serverTimestamp()` — deliberately, so one contributor's wrong clock cannot
 * pin their note to the top of the admin queue — and it has done since about
 * 2026-08-02; before that the field held an ISO string. Firestore orders values
 * by type before it orders them by value, so one range bound can only ever
 * match one of the two, and a scan bounded by a string skipped every note
 * written since the changeover. In the export of 2026-08-30 that is 173 notes
 * carrying 254 sources unseen, against the 16 notes and 18 sources the string
 * bound did find inside a 30-day window.
 *
 * So each field is asked for twice, once per type, and the four results are
 * folded by document id the way the two already were. The mixture is not
 * permanent — the last string-dated note is from 2026-08-01, so it falls out of
 * even the 90-day window during October — but until then dropping either half
 * loses real entries. `normalizeUpdateTime` reads both back the same way.
 *
 * Notes are the one kind here that is not append-only, which is also why the
 * daily rollup does not trust a day until it has settled — see
 * `SETTLE_HOURS` in `activityRollup.ts`. */
async function collectNoteSources(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const fields = ["userUid", "createdAt", "updatedAt", "sources"] as const;
  const scan = (field: string, asTimestamp: boolean) =>
    windowed(db.collection("notes"), field, window, asTimestamp)
      .select(...fields)
      .limit(SCAN_CAP)
      .get();

  const snapshots = await Promise.all([
    scan("createdAt", true),
    scan("updatedAt", true),
    scan("createdAt", false),
    scan("updatedAt", false),
  ]);

  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const uid = doc.get("userUid");
    const at = normalizeUpdateTime(
      doc.get("updatedAt") ?? doc.get("createdAt"),
    );
    const sources = doc.get("sources");
    if (typeof uid !== "string" || !at) continue;
    const count = Array.isArray(sources) ? sources.length : 0;
    if (count === 0) continue;

    events.push({ uid, at, kind: "noteSource", count });
  }

  const truncated: ActivityKind[] = snapshots.some(
    (snapshot) => snapshot.size >= SCAN_CAP,
  )
    ? ["noteSource"]
    : [];
  return { events, truncated };
}

/** Manually proposed changes.
 *
 * Two kinds of write are dropped here, and they are dropped for the same
 * reason: neither is somebody deciding that the data should say something
 * different.
 *
 * **The ingest's own revisions.** `createRevisionTransaction` now writes
 * `update_automatic` whichever way it goes, but it wrote nothing at all for a
 * human change until 2026-08-21, and 1,760 revisions in production still carry
 * no flag. An absent field therefore still means a human made the change, and
 * the filter has to stay "not true" rather than "equals false" — which is also
 * why it cannot be pushed into the query. `/api/revisions/queue` draws the same
 * line and explains what it costs.
 *
 * **Article nodes the ingest opened for itself.** `ensureArticleNode` writes one
 * revision per page that is crawled, captured from the extension or pasted into
 * /zrodla, and writes it with `update_automatic: false` because the same
 * endpoint serves all three. It is bookkeeping either way: the node is the url,
 * the title and the date lifted off the page, and nothing about it was ever
 * proposed. Counting it as a change is what put the ingest at the top of the
 * ranking - in the 30 days before this was written, 48 of the 51 revisions
 * credited to the busiest contributor were article nodes.
 *
 * The test is not "is this an article" but "was this ever offered for review".
 * `article` is a `proposableNodeType`, so somebody can edit an article's title
 * through the propose-edit dialog like any other page, and that is real work
 * that has to keep counting. `wasNeverProposed` is what separates the two; see
 * it for how each era of the collection is recognised.
 *
 * Reading the type off `data.type` on the revision rather than from the node it
 * points at costs one projected field instead of a lookup per row, and applies
 * to the history as much as to what the ingest writes from here on.
 */
async function collectRevisions(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(
    db.collection("revisions"),
    "update_time",
    window,
    true,
  )
    .select(
      "update_user",
      "update_time",
      "update_automatic",
      "review_time",
      "status",
      "data.type",
    )
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    if (doc.get("update_automatic") === true) continue;
    const uid = doc.get("update_user");
    const at = normalizeUpdateTime(doc.get("update_time"));
    if (typeof uid !== "string" || !at) continue;
    if (doc.get("data.type") === "article" && wasNeverProposed(doc, at)) {
      continue;
    }
    events.push({ uid, at, kind: "revision" });
  }

  const truncated: ActivityKind[] = snap.size >= SCAN_CAP ? ["revision"] : [];
  return { events, truncated };
}

/** Whether a revision was written straight into the data rather than offered to
 * a reviewer — which is what `ensureArticleNode` does and what a person using
 * the propose-edit dialog never does.
 *
 * Two signatures, one per era of the collection:
 *
 * - **No `status` at all.** `/api/revisions/create` has always written
 *   `status: "pending"` on a human proposal, so a revision without the field
 *   predates it, and every article revision from that era came from the ingest.
 *   All 292 in the export of 2026-07-20 carry exactly four fields — `data`,
 *   `node_id`, `update_time`, `update_user` — and nothing else.
 * - **Approved in its own commit.** `createRevisionTransaction` with
 *   `approve: true` stamps `review_time` from the same variable as
 *   `update_time`, so the two are identical to the nanosecond. A proposal that
 *   a person reviewed was reviewed in a later request and never matches.
 */
function wasNeverProposed(
  doc: { get(field: string): unknown },
  updatedAt: string,
): boolean {
  if (doc.get("status") === undefined) return true;
  return normalizeUpdateTime(doc.get("review_time")) === updatedAt;
}
