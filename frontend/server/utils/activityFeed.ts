import type { Firestore, Query } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  countedFeedKinds,
  FEED_BATCH_GAP_MS,
  type FeedKind,
  type FeedTargetType,
  type RawFeed,
  type RawFeedBatch,
  type RawFeedTarget,
} from "~~/shared/activityFeed";
import { auditActions, type AuditAction } from "~~/shared/audit";
import { revisionCollection } from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";
import { isAutomatedUid } from "~~/shared/stats";
import {
  isFeedDocId,
  resolveFeedTargets,
  unreadFeedTarget,
  type FeedTargetRef,
  type ResolvedFeedTarget,
  type UnreadFeedTarget,
} from "~~/server/utils/feedTargets";

/** Per-scan ceiling, the same one `activityEvents.ts` puts on the stats scans:
 * a window is bounded by dates, not by volume, and a runaway import must not
 * turn one rebuild into a full-collection read. */
const SCAN_CAP = 20_000;

/** The imports scan's own, far lower ceiling, newest first. What an
 * administrator on trial uploads is one line counted in revisions, and one bulk
 * upload is thousands of them - every one re-read on every rebuild for as long
 * as it is in the window, for a line that names fifty. So an upload is counted
 * up to this many and `imports` is reported truncated past it, which the page
 * already words as "the window is a lower bound". The scan also returns the
 * same people's own revisions and throws them away, so this bounds the reads,
 * not only the imports. */
const IMPORT_SCAN_CAP = 1_000;

/** `in` takes at most 30 values. */
const IMPORT_UIDS_CAP = 30;

/** `getAll` takes any number of refs, but one request has to fit in a call. */
const READ_CHUNK = 300;

/** How long after a node's approval its publication still counts as the same
 * click. `/api/nodes/publish` approves the newest revision in one commit and
 * files the publication in the next, so the two are a round-trip apart - and
 * its publish row, unlike an edge's, does not say which revision it went out
 * with. */
const PUBLISH_PAIRING_MS = 10_000;

/** How long after a direct write the audit row that accounts for it may come.
 * Merge, split and edge removal stamp their side-effect revisions and their
 * row in one synchronous call on one clock, so the two are milliseconds apart;
 * the rest is slack for a slow commit, not room for a second click.
 *
 * The bound does real work: a removal's row names its revision, but a merge's
 * or a split's names only the pages and relations it touched (`into`,
 * `collapsed`, `enriched`). The administrator's own edit of a relation the
 * merge then enriches is on the same target id as the merge's write, and only
 * the time tells the two apart. */
const SIDE_EFFECT_BOUND_MS = 5_000;

/** How many targets a batch lists. A voting session is dozens of people nobody
 * reads through, so it names a handful; an administrator's decisions are what
 * the monitoring is for, so those are listed far enough to check. */
const LISTED_TARGETS: Partial<Record<FeedKind, number>> = {
  vote: 12,
  note: 12,
};
const LISTED_TARGETS_DEFAULT = 50;

function listedTargets(kind: FeedKind): number {
  return LISTED_TARGETS[kind] ?? LISTED_TARGETS_DEFAULT;
}

export type FeedWindow = { sinceIso: string; untilIso: string };

/** One thing one person did, before its target has been read. */
export type PendingFeedEvent = {
  uid: string;
  kind: FeedKind;
  /** Canonical ISO instant, inside the window. */
  at: string;
  /** What the batch counts for kinds in `countedFeedKinds`: the vote,
   * note or revision document, or a merge's duplicate. */
  unit: string;
  target: FeedTargetRef;
  revisionId?: string;
  selfApproved?: boolean;
  reason?: string;
};

/** One thing one person did, with its target named - or, past what a line
 * that counts documents lists, left unread and only counted. */
export type FeedEvent = Omit<PendingFeedEvent, "target"> & {
  target: ResolvedFeedTarget | UnreadFeedTarget;
};

/** What the feed needs of a revision, from the scan or from a direct read. */
export type FeedRevision = {
  id: string;
  uid: string | null;
  /** `update_time`, normalised but not canonicalised - it is compared with
   * `review_time` normalised the same way. */
  at: string | null;
  reviewUser: string | null;
  reviewAt: string | null;
  status: unknown;
  automatic: boolean;
  collection: "nodes" | "edges";
  targetId: string | null;
  type: string | null;
  name: string | null;
  ends?: { source: string; target: string };
  deleted: boolean;
  deleteReason?: string;
};

/** An audit row the feed can use: a known action by a person, in the window. */
export type FeedAuditRow = {
  id: string;
  uid: string;
  at: string;
  ms: number;
  action: AuditAction;
  collection: "nodes" | "edges";
  targetId: string;
  revisionId?: string;
  reason?: string;
  merge?: { into: string | null; collapsed: string[]; enriched: string[] };
};

type Getter = (path: string) => unknown;

/** Everything people did in `[sinceIso, untilIso)`, batched per person per
 * sitting, with every restricted field still on it - `present` in the endpoint
 * strips it per caller.
 *
 * Each source is one range scan on one timestamp, which the automatic
 * single-field indexes serve, plus two scans on `revisions` that existing
 * composite indexes serve. Everything is then folded in memory, so that one
 * click reads as one action: an approval that was the first half of a
 * publication, and a revision that was the side effect of a merge, are not
 * listed a second time.
 *
 * The events are then grouped into sittings, and only after that are targets
 * named: every target of a line that names what it touched by type ("3 osoby i
 * 2 fakty"), but only the listed ones of a line that counts documents ("47
 * zmian"), whose other targets are counted by id and never read. So neither
 * what the folds throw away nor what no line shows costs a read - a bulk upload
 * of a thousand people is fifty target reads, not a thousand.
 *
 * `newAdminUids` adds what administrators on trial uploaded through the ingest
 * endpoints, which publish without leaving an audit row and would otherwise be
 * the one thing they do that nobody sees.
 */
export async function buildActivityFeed(
  db: Firestore,
  options: FeedWindow & { newAdminUids: string[] },
): Promise<RawFeed> {
  const window = { sinceIso: options.sinceIso, untilIso: options.untilIso };
  if (!parseWindow(window)) {
    throw new Error(
      `activityFeed: not a window: ${window.sinceIso} - ${window.untilIso}`,
    );
  }

  const [votes, notes, revisions, audit, imports] = await Promise.all([
    scanVotes(db, window),
    scanNotes(db, window),
    scanRevisions(db, window),
    scanAudit(db, window),
    scanImports(db, window, options.newAdminUids),
  ]);

  const known = new Map<string, FeedRevision>();
  for (const revision of [...revisions.rows, ...imports.rows]) {
    known.set(revision.id, revision);
  }

  const folded = foldAuditRows(audit.rows);
  await readRevisions(
    db,
    folded
      .filter((row) => ["approve", "reject", "publish"].includes(row.action))
      .map((row) => row.revisionId),
    known,
  );

  const pending: PendingFeedEvent[] = [
    ...votes.rows,
    ...notes.rows,
    ...classifyRevisions(revisions.rows, audit.rows, window),
    ...auditFeedEvents(folded, known),
    ...imports.rows.flatMap((revision) => {
      const event = importFeedEvent(revision, window);
      return event ? [event] : [];
    }),
  ];

  // An id that cannot name a document is known to be unnameable without a
  // read, so it never holds a sitting open either.
  const sittings = feedSittings(
    pending.filter((event) => isFeedDocId(event.target.id)),
  );

  return {
    batches: summariseSittings(await nameSittings(db, sittings)),
    truncated: [votes, notes, revisions, audit, imports]
      .filter((scan) => scan.truncated)
      .map((scan) => scan.source),
  };
}

/** Each sitting's events with their targets named: every one of a kind whose
 * sentence counts targets by type, and of a kind in `countedFeedKinds` only
 * those of the targets its line will list - the newest distinct ones, as
 * `summarise` orders them. The rest of such a sitting is kept unread, counted
 * towards `count` and `moreTargets` on the strength of its id alone.
 *
 * An event whose target was read and cannot be named is dropped, as
 * `resolveFeedTargets` explains. Its sitting stays one line all the same: it
 * was decided before anything was read, and the person was there, whatever it
 * was they touched.
 */
async function nameSittings(
  db: Firestore,
  sittings: readonly PendingFeedEvent[][],
): Promise<FeedEvent[][]> {
  const refs: FeedTargetRef[] = [];
  const planned = sittings.map((events) => {
    const kind = events[0]?.kind;
    const listed =
      kind && countedFeedKinds.has(kind)
        ? newestTargetKeys(events, listedTargets(kind))
        : null;
    return events.map((event) => ({
      event,
      slot:
        listed && !listed.has(targetKey(event.target))
          ? null
          : refs.push(event.target) - 1,
    }));
  });

  const targets = await resolveFeedTargets(db, refs);
  return planned.map((events) =>
    events.flatMap(({ event, slot }): FeedEvent[] => {
      if (slot === null) {
        return [{ ...event, target: unreadFeedTarget(event.target) }];
      }
      const target = targets[slot];
      return target ? [{ ...event, target }] : [];
    }),
  );
}

/** The first `limit` distinct targets of a sitting, newest first. */
function newestTargetKeys(
  events: readonly PendingFeedEvent[],
  limit: number,
): Set<string> {
  const keys = new Set<string>();
  for (let i = events.length - 1; i >= 0 && keys.size < limit; i--) {
    keys.add(targetKey(events[i]!.target));
  }
  return keys;
}

/** A target within a line: a page and a fact with the same id are two. */
function targetKey(target: { collection: string; id: string }): string {
  return `${target.collection}/${target.id}`;
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

type Scan<T> = { source: string; rows: T[]; truncated: boolean };

/** A range on one field, newest first. The bounds are on the same field the
 * order is, so the query needs nothing beyond that field's own index - or,
 * after an equality filter, the composite whose second field it is. */
function inWindow(
  query: Query,
  field: string,
  window: FeedWindow,
  asTimestamp = false,
): Query {
  const bound = (iso: string) =>
    asTimestamp ? Timestamp.fromDate(new Date(iso)) : iso;
  return query
    .where(field, ">=", bound(window.sinceIso))
    .where(field, "<", bound(window.untilIso))
    .orderBy(field, "desc");
}

async function scanVotes(
  db: Firestore,
  window: FeedWindow,
): Promise<Scan<PendingFeedEvent>> {
  const snapshot = await inWindow(db.collection("votes"), "updatedAt", window)
    .select(
      "userUid",
      "updatedAt",
      "nodeId",
      "extractionId",
      "categoryVotes",
      "comment",
    )
    .limit(SCAN_CAP)
    .get();

  const rows = snapshot.docs.flatMap((doc) => {
    const event = voteFeedEvent(doc.id, (path) => doc.get(path), window);
    return event ? [event] : [];
  });
  return { source: "votes", rows, truncated: snapshot.size >= SCAN_CAP };
}

/** Notes are stamped with `serverTimestamp()`, and the last one stamped with a
 * string is from 2026-08-01 - before any window the feed offers - so unlike
 * the stats, which reach back 90 days, only the Timestamp half is read.
 *
 * Only `updatedAt` is: `saveNote` writes it on every save, the first one
 * included, and nothing on the server creates a note - so a scan on
 * `createdAt` would only find notes this one already has, and be billed for
 * them twice. */
async function scanNotes(
  db: Firestore,
  window: FeedWindow,
): Promise<Scan<PendingFeedEvent>> {
  const snapshot = await inWindow(
    db.collection("notes"),
    "updatedAt",
    window,
    true,
  )
    .select("userUid", "nodeId", "updatedAt", "sources")
    .limit(SCAN_CAP)
    .get();

  const rows = snapshot.docs.flatMap((doc) => {
    const event = noteFeedEvent(doc.id, (path) => doc.get(path), window);
    return event ? [event] : [];
  });
  return { source: "notes", rows, truncated: snapshot.size >= SCAN_CAP };
}

const REVISION_SCAN_FIELDS = [
  "update_user",
  "update_time",
  "review_user",
  "review_time",
  "status",
  "collection",
  "node_id",
  "nodeId",
  "data.type",
  "data.name",
  "data.source",
  "data.target",
  "data.deleted",
  "data.delete_reason",
];

/** Revisions a person wrote. `update_automatic == false` is exact here, where
 * the stats have to read it as "not true": the revisions that carry no flag
 * all predate 2026-08-22, outside any window the feed offers. The query is
 * the shape of the composite `(update_automatic, update_time DESC)` the
 * revision queue already uses - an ascending order would need one that does
 * not exist. */
async function scanRevisions(
  db: Firestore,
  window: FeedWindow,
): Promise<Scan<FeedRevision>> {
  const snapshot = await inWindow(
    db.collection("revisions").where("update_automatic", "==", false),
    "update_time",
    window,
    true,
  )
    .select(...REVISION_SCAN_FIELDS)
    .limit(SCAN_CAP)
    .get();

  return {
    source: "revisions",
    rows: snapshot.docs.map((doc) =>
      readFeedRevision(doc.id, (path) => doc.get(path)),
    ),
    truncated: snapshot.size >= SCAN_CAP,
  };
}

/** What administrators on trial uploaded through the ingest endpoints, on the
 * `(update_user, update_time DESC)` composite. Ingest revisions are the bulk
 * of the collection, so they are asked for by author rather than read for
 * everybody and thrown away - and only the newest `IMPORT_SCAN_CAP` of them. */
async function scanImports(
  db: Firestore,
  window: FeedWindow,
  newAdminUids: readonly string[],
): Promise<Scan<FeedRevision>> {
  const uids = [...new Set(newAdminUids)].filter(
    (uid) => uid && !isAutomatedUid(uid),
  );
  if (uids.length === 0)
    return { source: "imports", rows: [], truncated: false };
  if (uids.length > IMPORT_UIDS_CAP) {
    console.warn(
      `activityFeed: ${uids.length} administrators on trial, imports are read for the first ${IMPORT_UIDS_CAP}`,
    );
  }

  const snapshot = await inWindow(
    db
      .collection("revisions")
      .where("update_user", "in", uids.slice(0, IMPORT_UIDS_CAP)),
    "update_time",
    window,
    true,
  )
    .select("update_automatic", ...REVISION_SCAN_FIELDS)
    .limit(IMPORT_SCAN_CAP)
    .get();

  return {
    source: "imports",
    rows: snapshot.docs
      .filter((doc) => doc.get("update_automatic") === true)
      .map((doc) => readFeedRevision(doc.id, (path) => doc.get(path))),
    truncated: snapshot.size >= IMPORT_SCAN_CAP,
  };
}

/** Every audit row, whatever its action: filtering on `action` next to a range
 * on `at` would need a composite index, and the scan is capped either way. */
async function scanAudit(
  db: Firestore,
  window: FeedWindow,
): Promise<Scan<FeedAuditRow>> {
  const snapshot = await inWindow(db.collection("audit"), "at", window)
    .select(
      "user",
      "at",
      "action",
      "collection",
      "target_id",
      "revision_id",
      "reason",
      "merge",
    )
    .limit(SCAN_CAP)
    .get();

  const rows = snapshot.docs.flatMap((doc) => {
    const row = readFeedAuditRow(doc.id, (path) => doc.get(path), window);
    return row ? [row] : [];
  });
  return { source: "audit", rows, truncated: snapshot.size >= SCAN_CAP };
}

const REVISION_READ_FIELDS = [
  "update_user",
  "update_automatic",
  "collection",
  "node_id",
  "data.deleted",
  "data.delete_reason",
  "data.name",
  "data.type",
  "data.source",
  "data.target",
];

/** The revisions behind the approvals, rejections and publications that are
 * left after folding, when the scan did not already bring them: one approved
 * in the window may have been proposed long before it, or by the ingest. A
 * chunk that fails only costs the flags its rows would have carried. */
async function readRevisions(
  db: Firestore,
  ids: (string | undefined)[],
  known: Map<string, FeedRevision>,
): Promise<void> {
  const wanted = [...new Set(ids)].filter(
    (id): id is string => isFeedDocId(id) && !known.has(id),
  );
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += READ_CHUNK) {
    chunks.push(wanted.slice(i, i + READ_CHUNK));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snapshots = await db.getAll(
          ...chunk.map((id) => db.collection("revisions").doc(id)),
          { fieldMask: REVISION_READ_FIELDS },
        );
        for (const snapshot of snapshots) {
          if (!snapshot.exists) continue;
          known.set(
            snapshot.id,
            readFeedRevision(snapshot.id, (path) => snapshot.get(path)),
          );
        }
      } catch (error) {
        console.warn(
          `activityFeed: could not read ${chunk.length} revisions`,
          error,
        );
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Rows to events
// ---------------------------------------------------------------------------

/** The window as instants, or null when either end is not one. */
function parseWindow(
  window: FeedWindow,
): { sinceMs: number; untilMs: number } | null {
  const sinceMs = Date.parse(window.sinceIso);
  const untilMs = Date.parse(window.untilIso);
  return Number.isNaN(sinceMs) || Number.isNaN(untilMs)
    ? null
    : { sinceMs, untilMs };
}

/** `value` as a canonical ISO instant, when it is one inside the window.
 *
 * The range scans already bound it, but by comparing strings and types: a
 * vote's `updatedAt` is whatever the voter's browser sent, and anything that
 * sorts between the two bounds passes - including a date that does not parse,
 * or one with an offset that puts it outside. Each is dropped here rather than
 * pinned to the top of the feed. */
export function feedInstant(value: unknown, window: FeedWindow): string | null {
  const bounds = parseWindow(window);
  const iso = normalizeUpdateTime(value);
  if (!bounds || !iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms < bounds.sinceMs || ms >= bounds.untilMs) {
    return null;
  }
  return new Date(ms).toISOString();
}

/** The person behind a row, or null for a robot or nobody. */
function person(value: unknown): string | null {
  return typeof value === "string" && value && !isAutomatedUid(value)
    ? value
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A vote, unless it takes a vote back.
 *
 * Un-clicking a verdict writes a zero rather than deleting the document, and
 * still moves `updatedAt`; that is somebody changing their mind about having
 * said anything, and reads wrong as "ocenił/a". A comment on its own is kept:
 * the fact review writes one with no values, and it is a verdict all the same.
 * The target is told by which id field is set, as the vote trigger tells it. */
export function voteFeedEvent(
  id: string,
  get: Getter,
  window: FeedWindow,
): PendingFeedEvent | null {
  const uid = person(get("userUid"));
  const at = feedInstant(get("updatedAt"), window);
  if (!uid || !at) return null;

  const values = get("categoryVotes");
  const cast =
    typeof values === "object" &&
    values !== null &&
    Object.values(values).some(
      (value) => typeof value === "number" && value !== 0,
    );
  if (!cast && !text(get("comment"))) return null;

  const extractionId = get("extractionId");
  const nodeId = get("nodeId");
  const target: FeedTargetRef | null = extractionId
    ? typeof extractionId === "string"
      ? { collection: "extractions", id: extractionId }
      : null
    : typeof nodeId === "string" && nodeId
      ? { collection: "nodes", id: nodeId }
      : null;
  if (!target) return null;

  return { uid, kind: "vote", at, unit: id, target };
}

/** One note document per (author, page), dated by its last write. A note whose
 * entries were all removed is not somebody adding a note. */
export function noteFeedEvent(
  id: string,
  get: Getter,
  window: FeedWindow,
): PendingFeedEvent | null {
  const uid = person(get("userUid"));
  const at = feedInstant(get("updatedAt"), window);
  const nodeId = get("nodeId");
  const sources = get("sources");
  if (!uid || !at || typeof nodeId !== "string" || !nodeId) return null;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  return {
    uid,
    kind: "note",
    at,
    unit: id,
    target: { collection: "nodes", id: nodeId },
  };
}

export function readFeedRevision(id: string, get: Getter): FeedRevision {
  const source = text(get("data.source"));
  const target = text(get("data.target"));
  const deleteReason = text(get("data.delete_reason"));
  const uid = get("update_user");
  const reviewUser = get("review_user");
  return {
    id,
    uid: typeof uid === "string" ? uid : null,
    at: normalizeUpdateTime(get("update_time")),
    reviewUser: typeof reviewUser === "string" ? reviewUser : null,
    reviewAt: normalizeUpdateTime(get("review_time")),
    status: get("status"),
    automatic: get("update_automatic") === true,
    collection: revisionCollection({
      collection: get("collection"),
      data: { source, target },
    }),
    targetId: text(get("node_id")) ?? text(get("nodeId")) ?? null,
    type: text(get("data.type")) ?? null,
    name: text(get("data.name")) ?? null,
    ...(source && target ? { ends: { source, target } } : {}),
    deleted: get("data.deleted") === true,
    ...(deleteReason ? { deleteReason } : {}),
  };
}

export function readFeedAuditRow(
  id: string,
  get: Getter,
  window: FeedWindow,
): FeedAuditRow | null {
  const uid = person(get("user"));
  const at = feedInstant(get("at"), window);
  const action = get("action");
  const targetId = get("target_id");
  // An action this code does not know - the unmerged audit log adds `restore`
  // - is left out rather than guessed at.
  if (!uid || !at || !(auditActions as readonly unknown[]).includes(action)) {
    return null;
  }
  if (typeof targetId !== "string" || !targetId) return null;

  const merge = get("merge");
  const revisionId = text(get("revision_id"));
  const reason = text(get("reason"));
  return {
    id,
    uid,
    at,
    ms: Date.parse(at),
    action: action as AuditAction,
    collection: get("collection") === "edges" ? "edges" : "nodes",
    targetId,
    ...(revisionId ? { revisionId } : {}),
    ...(reason ? { reason } : {}),
    ...(typeof merge === "object" && merge !== null
      ? { merge: readMerge(merge as Record<string, unknown>) }
      : {}),
  };
}

function readMerge(merge: Record<string, unknown>): FeedAuditRow["merge"] {
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  return {
    into: text(merge.into) ?? null,
    collapsed: ids(merge.collapsed),
    enriched: ids(merge.enriched),
  };
}

/** Human revisions, as proposals or as direct edits.
 *
 * A revision approved by its own author in the commit that wrote it -
 * `review_time` the same instant as `update_time` - was never offered to
 * anybody: it is an administrator writing straight into the data. Most such
 * writes are the side effects of an action the audit log already names (the
 * relations a merge collapses or enriches, the person a split creates, the
 * removal behind an edge's deletion), and one of those is dropped only when an
 * audit row by the same person, stamped within `SIDE_EFFECT_BOUND_MS` after
 * it, names it - a removal by its revision id, a merge or a split by the page
 * or relation it was written on. The rest are `edit`s. Asking for both is what
 * keeps a dozen real edits made just before a merge from vanishing with it:
 * what the merge names keeps the unrelated ones, and the few seconds keep the
 * edit of a relation the merge went on to enrich.
 *
 * Everything else is a proposal, flagged when its author later approved it
 * themselves.
 *
 * The times are compared as normalised strings: two Timestamps of the same
 * instant are two objects, and `===` on them is never true.
 */
export function classifyRevisions(
  revisions: readonly FeedRevision[],
  audit: readonly FeedAuditRow[],
  window: FeedWindow,
): PendingFeedEvent[] {
  const accountingRows = new Map<string, FeedAuditRow[]>();
  for (const row of audit) {
    if (
      row.action !== "delete" &&
      row.action !== "merge" &&
      row.action !== "split"
    )
      continue;
    const rows = accountingRows.get(row.uid) ?? [];
    rows.push(row);
    accountingRows.set(row.uid, rows);
  }

  const events: PendingFeedEvent[] = [];
  for (const revision of revisions) {
    const uid = person(revision.uid);
    const at = feedInstant(revision.at, window);
    if (!uid || !at || !revision.targetId || !revision.at) continue;
    if (revision.type === "article" && wasNeverProposed(revision)) continue;

    const target = revisionTarget(revision, revision.targetId);
    const ownReview =
      revision.status === "approved" && revision.reviewUser === revision.uid;

    if (ownReview && revision.reviewAt === revision.at) {
      const writtenMs = Date.parse(revision.at);
      const accounted = (accountingRows.get(uid) ?? []).some(
        (row) =>
          row.ms >= writtenMs &&
          row.ms - writtenMs <= SIDE_EFFECT_BOUND_MS &&
          accountsFor(row, revision),
      );
      if (accounted) continue;
      events.push({
        uid,
        kind: "edit",
        at,
        unit: revision.id,
        target,
        revisionId: revision.id,
      });
      continue;
    }

    events.push({
      uid,
      kind: "proposal",
      at,
      unit: revision.id,
      target,
      revisionId: revision.id,
      ...(ownReview ? { selfApproved: true } : {}),
    });
  }
  return events;
}

/** `wasNeverProposed` in activityEvents.ts: the article node every crawl and
 * capture opens for itself, approved in its own commit. */
function wasNeverProposed(revision: FeedRevision): boolean {
  if (revision.status === undefined) return true;
  return revision.reviewAt === revision.at;
}

/** Whether an audit row names this revision as part of what it did: a removal
 * by the revision's own id, a merge or a split only by the page or relation it
 * was written on, which is why the caller also bounds it in time. */
function accountsFor(row: FeedAuditRow, revision: FeedRevision): boolean {
  const id = revision.targetId;
  if (row.action === "delete") return row.revisionId === revision.id;
  if (!row.merge || !id) return false;
  if (row.action === "split") return row.merge.into === id;
  return (
    row.merge.into === id ||
    row.merge.collapsed.includes(id) ||
    row.merge.enriched.includes(id)
  );
}

/** What a revision's event points at, with what the revision itself says of
 * it: the two ends of a relation, and the name and type of a page that may
 * exist only as this proposal. */
function revisionTarget(revision: FeedRevision, id: string): FeedTargetRef {
  return {
    collection: revision.collection,
    id,
    ...(revision.ends ? { ends: revision.ends } : {}),
    ...(revision.collection === "nodes" && revision.type
      ? {
          proposed: {
            type: revision.type,
            ...(revision.name ? { name: revision.name } : {}),
          },
        }
      : {}),
  };
}

/** Approvals that were the first half of a publication, folded into it.
 *
 * Publishing a relation from /admin/krawedzie approves its pending revision and
 * publishes it in one call, and both rows name the revision; publishing a page
 * approves its newest revision a commit before the publication, whose row does
 * not name it - so that pair is matched by page, person and a few seconds
 * instead. Either way it was one click, and it reads as a publication. The
 * revision moves onto the publication, so whether it was the publisher's own
 * proposal is still worked out - an administrator publishing what they wrote
 * themselves is exactly what the monitoring exists to show.
 *
 * Approvals nothing was published with stay approvals.
 */
export function foldAuditRows(rows: readonly FeedAuditRow[]): FeedAuditRow[] {
  const ordered = [...rows].sort((a, b) => a.ms - b.ms);
  const publications = new Map<string, FeedAuditRow[]>();
  for (const row of ordered) {
    if (row.action !== "publish") continue;
    const key = auditTargetKey(row);
    const rows = publications.get(key) ?? [];
    rows.push(row);
    publications.set(key, rows);
  }

  const folded = new Set<FeedAuditRow>();
  const carried = new Map<FeedAuditRow, string>();
  for (const approval of ordered) {
    if (approval.action !== "approve") continue;
    const candidates = publications.get(auditTargetKey(approval)) ?? [];
    const publication =
      candidates.find(
        (row) =>
          approval.revisionId !== undefined &&
          row.revisionId === approval.revisionId,
      ) ??
      (approval.collection === "nodes"
        ? candidates.find(
            (row) =>
              row.revisionId === undefined &&
              row.ms >= approval.ms &&
              row.ms - approval.ms <= PUBLISH_PAIRING_MS,
          )
        : undefined);
    if (!publication) continue;

    folded.add(approval);
    if (publication.revisionId === undefined && approval.revisionId) {
      carried.set(publication, approval.revisionId);
    }
  }

  return ordered
    .filter((row) => !folded.has(row))
    .map((row) => {
      const revisionId = carried.get(row);
      return revisionId ? { ...row, revisionId } : row;
    });
}

function auditTargetKey(row: FeedAuditRow): string {
  return `${row.uid}\u0000${row.collection}/${row.targetId}`;
}

/** What each folded audit row did.
 *
 * An approval of a revision that deletes its page or relation is a removal:
 * there is no delete endpoint for pages, so taking one down is approving a
 * removal proposal, and that must not read as the most routine action there
 * is. So is a publication of one. "Zatwierdź i opublikuj" on a removal filed a
 * publish row naming it, and the approval folded into that row before any
 * revision was read - read as a publication, the line would say a page went
 * live that was just taken down, and lose the reason it was. A split without a
 * `merge` field only flagged the page as two people.
 * A merge is shown on the page that survived it, counted by the duplicates
 * that went into it.
 *
 * `selfApproved` marks an approval or publication of the actor's own proposal.
 * Not of what the ingest filed under their uid - the owner's pipeline runs as
 * the owner, and every one of those would be flagged otherwise.
 */
export function auditFeedEvents(
  rows: readonly FeedAuditRow[],
  revisions: ReadonlyMap<string, FeedRevision>,
): PendingFeedEvent[] {
  return rows.flatMap((row): PendingFeedEvent[] => {
    const revision = row.revisionId ? revisions.get(row.revisionId) : undefined;
    const target: FeedTargetRef =
      revision?.targetId === row.targetId
        ? revisionTarget(revision, row.targetId)
        : { collection: row.collection, id: row.targetId };
    const unit = `${row.collection}/${row.targetId}`;
    const base = { uid: row.uid, at: row.at };
    const revisionId = row.revisionId ? { revisionId: row.revisionId } : {};
    const reason = row.reason ? { reason: row.reason } : {};
    const selfApproved =
      revision !== undefined && revision.uid === row.uid && !revision.automatic
        ? { selfApproved: true }
        : {};

    switch (row.action) {
      case "approve": {
        if (revision?.deleted) {
          return [
            removalEvent(row, revision, { ...revisionId, ...selfApproved }),
          ];
        }
        return [
          {
            ...base,
            kind: "approve",
            unit: row.revisionId ?? row.targetId,
            target,
            ...revisionId,
            ...selfApproved,
          },
        ];
      }
      case "reject":
        return [
          {
            ...base,
            kind: "reject",
            unit: row.revisionId ?? row.targetId,
            target,
            ...revisionId,
            ...reason,
          },
        ];
      case "publish":
        if (revision?.deleted) {
          return [
            removalEvent(row, revision, { ...revisionId, ...selfApproved }),
          ];
        }
        return [
          {
            ...base,
            kind: "publish",
            unit,
            target,
            ...revisionId,
            ...selfApproved,
          },
        ];
      case "unpublish":
        return [{ ...base, kind: "unpublish", unit, target }];
      case "delete":
        return [
          { ...base, kind: "delete", unit, target, ...revisionId, ...reason },
        ];
      case "merge": {
        const into = row.merge?.into;
        return [
          {
            ...base,
            kind: "merge",
            unit: row.targetId,
            target: into
              ? { collection: "nodes", id: into, exact: true }
              : { collection: "nodes", id: row.targetId },
            ...reason,
          },
        ];
      }
      case "split":
        return [
          {
            ...base,
            kind: row.merge ? "split" : "splitMark",
            unit,
            target,
            ...reason,
          },
        ];
    }
  });
}

/** An approval or a publication of a revision that deletes its page or
 * relation, as the removal it carried out: on what the revision removed, with
 * the reason it gave. */
function removalEvent(
  row: FeedAuditRow,
  revision: FeedRevision,
  flags: Pick<PendingFeedEvent, "revisionId" | "selfApproved">,
): PendingFeedEvent {
  const removed = revisionTarget(revision, revision.targetId ?? row.targetId);
  return {
    uid: row.uid,
    at: row.at,
    kind: "delete",
    unit: `${removed.collection}/${removed.id}`,
    target: removed,
    ...flags,
    ...(revision.deleteReason ? { reason: revision.deleteReason } : {}),
  };
}

/** What an administrator on trial uploaded through the ingest. */
export function importFeedEvent(
  revision: FeedRevision,
  window: FeedWindow,
): PendingFeedEvent | null {
  const uid = person(revision.uid);
  const at = feedInstant(revision.at, window);
  if (!revision.automatic || !uid || !at || !revision.targetId) return null;
  return {
    uid,
    kind: "import",
    at,
    unit: revision.id,
    target: revisionTarget(revision, revision.targetId),
    revisionId: revision.id,
  };
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

type TargetEntry = {
  target: ResolvedFeedTarget | UnreadFeedTarget;
  /** Position of the newest event on this target, for newest-first order. */
  seq: number;
  revisionId?: string;
  selfApproved?: boolean;
  reason?: string;
};

type ReadEntry = TargetEntry & { target: ResolvedFeedTarget };

/** Events as one line per person, per kind, per sitting (`feedSittings`).
 *
 * It lists each target once, newest first, carrying what its events said of
 * it. A publication or hiding of pages counts the relations that went with
 * them apart and does not list them: they are the same decision as the page,
 * which is how the stats count a publication too. Only relations published on
 * their own are the object - and one the publisher had proposed themselves,
 * which is listed with its flag and its revision rather than folded away with
 * them: that is the one thing about it the monitoring is for.
 *
 * A target left unread (`UnreadFeedTarget`) is counted and never listed.
 */
export function batchFeedEvents(
  events: readonly FeedEvent[],
  gapMs: number = FEED_BATCH_GAP_MS,
): RawFeedBatch[] {
  return summariseSittings(feedSittings(events, gapMs));
}

/** Events grouped into sittings: per person and kind, oldest first, a sitting
 * staying open while each next event follows the last within `gapMs`, however
 * many other kinds come between - voting on people between two publications
 * does not make the publications two lines.
 *
 * The one grouping both `buildActivityFeed`, which decides what to read by
 * sitting before reading anything, and `batchFeedEvents` use, so the lines it
 * read for and the lines it prints cannot come apart. */
export function feedSittings<
  E extends Pick<PendingFeedEvent, "uid" | "kind" | "at" | "unit">,
>(events: readonly E[], gapMs: number = FEED_BATCH_GAP_MS): E[][] {
  // `at` is always `toISOString()` output, so string order is time order.
  const ordered = [...events].sort(
    (a, b) =>
      compare(a.at, b.at) ||
      compare(a.uid, b.uid) ||
      compare(a.kind, b.kind) ||
      compare(a.unit, b.unit),
  );

  const open = new Map<string, { events: E[]; lastMs: number }>();
  const sittings: E[][] = [];
  for (const event of ordered) {
    const ms = Date.parse(event.at);
    const key = `${event.uid}\u0000${event.kind}`;
    const current = open.get(key);
    if (current && ms - current.lastMs <= gapMs) {
      current.events.push(event);
      current.lastMs = ms;
      continue;
    }
    const next = { events: [event], lastMs: ms };
    open.set(key, next);
    sittings.push(next.events);
  }
  return sittings;
}

/** One line per sitting that still has an event in it, newest first. */
function summariseSittings(sittings: readonly FeedEvent[][]): RawFeedBatch[] {
  return sittings
    .filter((events) => events.length > 0)
    .map(summarise)
    .sort(
      (a, b) =>
        compare(b.lastAt, a.lastAt) ||
        compare(a.uid, b.uid) ||
        compare(a.kind, b.kind),
    );
}

function summarise(events: FeedEvent[]): RawFeedBatch {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const kind = first.kind;

  const entries = new Map<string, TargetEntry>();
  const units = new Set<string>();
  events.forEach((event, seq) => {
    units.add(event.unit);
    const key = targetKey(event.target);
    const entry = entries.get(key) ?? { target: event.target, seq };
    // Two references can name one page once merges are followed; what was
    // read of it is not traded for what was not.
    if (isRead(event.target) || !isRead(entry.target)) {
      entry.target = event.target;
    }
    entry.seq = seq;
    if (event.revisionId) entry.revisionId = event.revisionId;
    if (event.selfApproved) entry.selfApproved = true;
    if (event.reason) entry.reason = event.reason;
    entries.set(key, entry);
  });

  const all = [...entries.values()].sort((a, b) => b.seq - a.seq);
  const withPages =
    (kind === "publish" || kind === "unpublish") &&
    all.some((entry) => entry.target.type !== "edge");
  const listable = withPages
    ? all.filter((entry) => entry.target.type !== "edge" || entry.selfApproved)
    : all;

  // An unread target counts under the type its reference states, when it
  // states one; only the kinds that leave targets unread do not word the
  // sentence by type.
  const objects: Partial<Record<FeedTargetType, number>> = {};
  for (const { target } of listable) {
    if (target.type) objects[target.type] = (objects[target.type] ?? 0) + 1;
  }

  const listed = listable
    .filter((entry): entry is ReadEntry => isRead(entry.target))
    .slice(0, listedTargets(kind))
    .map(rawTarget);
  return {
    uid: first.uid,
    kind,
    firstAt: first.at,
    lastAt: last.at,
    count: countedFeedKinds.has(kind) ? units.size : listable.length,
    objects,
    alongEdges: all.length - listable.length,
    targets: listed,
    moreTargets: listable.length - listed.length,
  };
}

function isRead(
  target: ResolvedFeedTarget | UnreadFeedTarget,
): target is ResolvedFeedTarget {
  return !("unread" in target);
}

function rawTarget(entry: ReadEntry): RawFeedTarget {
  const { target } = entry;
  return {
    id: target.id,
    type: target.type,
    name: target.name,
    href: target.href,
    ...(target.deleted ? { deleted: true } : {}),
    ...(entry.revisionId ? { revisionId: entry.revisionId } : {}),
    ...(entry.selfApproved ? { selfApproved: true } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
