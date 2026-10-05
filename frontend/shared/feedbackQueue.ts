/** The team's work queue over user feedback, as /admin/opinie orders it.
 *
 * A report is in one of three places: the queue, where its `queueRank` says
 * what gets worked on next; outside it, where it waits until somebody decides
 * where it goes; or closed. What decides the first two is only whether a rank
 * has been given - status is left meaning what it already meant, so a report
 * somebody is working on ("w trakcie") can sit anywhere in the queue.
 *
 * Kept out of `model.ts`, which the Cloud Functions compile through a symlink:
 * nothing here is theirs to know.
 */
import type { Feedback, FeedbackStatus } from "./model";

/** The gap between neighbours when a report goes to either end of the queue.
 * A move into the middle halves a gap, so a run of drops into one slot has
 * about 50 halvings before two ranks meet. Two reports can also share a rank
 * outright - a closed report keeps its rank, and one reopened later can find a
 * newer report sitting on it. Either way `slotHasRoom` says so, and the page
 * renumbers the queue before placing the report. */
export const QUEUE_STEP = 1024;

/** How many open reports the list returns. More than this and something other
 * than the team is writing them. */
export const OPEN_CAP = 500;

/** Settled means nobody has to read it again: it was dealt with, or a decision
 * was made not to. "W trakcie" is still work in the queue. Spelled out per
 * status so that a new one does not compile until it is put on a side - the
 * list endpoint reads the two sides separately, and a status on neither would
 * vanish from the page. */
const STATUS_SIDE = {
  new: "open",
  in_progress: "open",
  resolved: "settled",
  wont_fix: "settled",
} as const satisfies Record<FeedbackStatus, "open" | "settled">;

const STATUSES = Object.keys(STATUS_SIDE) as FeedbackStatus[];

export const OPEN_STATUSES: readonly FeedbackStatus[] = STATUSES.filter(
  (status) => STATUS_SIDE[status] === "open",
);

export const SETTLED_STATUSES: readonly FeedbackStatus[] = STATUSES.filter(
  (status) => STATUS_SIDE[status] === "settled",
);

export const isSettled = (report: Pick<Feedback, "adminStatus">): boolean =>
  SETTLED_STATUSES.includes(report.adminStatus);

export const isQueued = (report: Pick<Feedback, "queueRank">): boolean =>
  typeof report.queueRank === "number";

export type FeedbackSection = "queue" | "inbox" | "closed";

/** Which list a report is shown in. Settledness is what it was when the page
 * loaded, not what it is now: a report closed from its card stays where it was
 * until the next load, dimmed, rather than jumping away from the cursor. */
export function feedbackSection(
  report: Pick<Feedback, "queueRank">,
  settledAtLoad: boolean,
): FeedbackSection {
  if (settledAtLoad) return "closed";
  return isQueued(report) ? "queue" : "inbox";
}

const byId = (a: Pick<Feedback, "id">, b: Pick<Feedback, "id">) =>
  (a.id ?? "").localeCompare(b.id ?? "");

/** Queue order: rank, then the older report first, then id - so two ranks that
 * met still come out the same way on every load. */
export function compareQueue(a: Feedback, b: Feedback): number {
  const rank = (a.queueRank ?? Infinity) - (b.queueRank ?? Infinity);
  if (rank !== 0 && !Number.isNaN(rank)) return rank;
  return a.createdAt.localeCompare(b.createdAt) || byId(a, b);
}

/** Newest first - the order everything outside the queue is read in. */
export function compareNewest(a: Feedback, b: Feedback): number {
  return b.createdAt.localeCompare(a.createdAt) || byId(a, b);
}

/** A rank that sorts between two neighbours; either may be missing, for the
 * ends of the queue. */
export function rankBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - QUEUE_STEP;
  if (after === undefined) return before + QUEUE_STEP;
  return (before + after) / 2;
}

const clampSlot = (queue: readonly Feedback[], index: number) =>
  Math.max(0, Math.min(index, queue.length));

/** The rank that puts a report at `index` of `queue`.
 *
 * `queue` is in queue order and must not contain the report being moved:
 * the slot is counted among the others, which is what "put it third" means
 * whether it came from further up, further down or from outside the queue. */
export function rankForSlot(queue: readonly Feedback[], index: number): number {
  const slot = clampSlot(queue, index);
  return rankBetween(queue[slot - 1]?.queueRank, queue[slot]?.queueRank);
}

/** Whether `rankForSlot` can put a report at `index` at all: false when the
 * neighbours share a rank, or sit so close that halving the gap lands on one
 * of them. The report would then sort beside the slot rather than in it. */
export function slotHasRoom(
  queue: readonly Feedback[],
  index: number,
): boolean {
  const slot = clampSlot(queue, index);
  const before = queue[slot - 1]?.queueRank ?? -Infinity;
  const after = queue[slot]?.queueRank ?? Infinity;
  const rank = rankForSlot(queue, slot);
  return before < rank && rank < after;
}

/** Fresh ranks for a queue whose gaps have run out: the same order, a full
 * step apart. Only the reports whose rank changes are returned, since each is
 * a write. */
export function renumberQueue(
  queue: readonly Feedback[],
): { item: Feedback; rank: number }[] {
  return queue
    .map((item, index) => ({ item, rank: (index + 1) * QUEUE_STEP }))
    .filter(({ item, rank }) => item.queueRank !== rank);
}
