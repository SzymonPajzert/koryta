/** Which changes on the QA changelog say they fix which reports, and what the
 * people who checked those changes found.
 *
 * The claim lives in code, on the entry (`QaItem.fixes`), because it is made
 * in the commit that makes the fix and is reviewed with it. What people found
 * lives in `qaChecks`, and a problem somebody wrote down there also arrived
 * as a report of its own - a follow-up, carrying `context.qa`. This joins the
 * three for /admin/opinie; nothing here writes anything, so a report is closed
 * only when an admin closes it.
 */
import { isSettled } from "./feedbackQueue";
import type { Feedback } from "./model";
import type { QaCheck, QaItem } from "./qa";

/** Firestore's auto-ids, which is what `feedback/create` gets from `add()`.
 * Anything else in `fixes` is a typo, and would silently match nothing. */
export const FEEDBACK_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

/** Report id to the entries claiming to fix it, newest entry first (the order
 * of `QA_ITEMS`). */
export function fixIndex(items: readonly QaItem[]): Map<string, QaItem[]> {
  const index = new Map<string, QaItem[]>();
  for (const item of items) {
    for (const id of new Set(item.fixes ?? [])) {
      if (!FEEDBACK_ID_PATTERN.test(id)) continue;
      const entries = index.get(id);
      if (entries) entries.push(item);
      else index.set(id, [item]);
    }
  }
  return index;
}

/** Where a fix stands, going by everybody's verdict on the entry that claims
 * it. One person's "coś nie działa" is enough to call it broken: that is the
 * thing to look at before anything else. */
export type FixState = "awaiting" | "works" | "broken";

export function fixState(
  entry: QaItem,
  checks: readonly Pick<QaCheck, "itemId" | "status">[],
): FixState {
  const verdicts = checks.filter((check) => check.itemId === entry.id);
  if (verdicts.some((check) => check.status === "issue")) return "broken";
  if (verdicts.some((check) => check.status === "ok")) return "works";
  return "awaiting";
}

/** Reports written about the entries that claim to fix `report` - somebody
 * checking the fix and saying something about it. Newest first. */
export function followUpsOf(
  report: Feedback,
  entries: readonly QaItem[],
  all: readonly Feedback[],
): Feedback[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return all
    .filter(
      (other) =>
        other.id !== report.id &&
        !!other.context.qa &&
        ids.has(other.context.qa.itemId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The other way round: for a follow-up, the reports whose fix it is about. */
export function fixTargetsOf(
  report: Feedback,
  index: ReadonlyMap<string, readonly QaItem[]>,
  all: readonly Feedback[],
): Feedback[] {
  const itemId = report.context.qa?.itemId;
  if (!itemId) return [];
  return all.filter(
    (other) =>
      other.id !== report.id &&
      (index.get(other.id!) ?? []).some((entry) => entry.id === itemId),
  );
}

/** A problem somebody reported while checking a fix, that nobody has closed
 * yet. Until it is, the fix is not done, whatever the verdicts say now. */
export const blocksClosing = (followUp: Feedback): boolean =>
  !isSettled(followUp) && followUp.context.qa?.status === "issue";

/** Whether to offer closing the report: the fix was checked and works, and no
 * problem reported against it is still open. Only a suggestion - an admin
 * clicks it. */
export function suggestClose(
  report: Feedback,
  state: FixState,
  followUps: readonly Feedback[],
): boolean {
  return (
    !isSettled(report) && state === "works" && !followUps.some(blocksClosing)
  );
}
