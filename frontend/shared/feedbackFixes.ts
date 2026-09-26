/** Which changes say they fix which reports, and what the people who checked
 * those changes found.
 *
 * The claim lives in code, because it is made in the commit that makes the fix
 * and is reviewed with it: on a QA changelog entry (`QaItem.fixes`), or, for a
 * fix with no entry of its own, in `REPORT_FIXES`. What people found about an
 * entry lives in `qaChecks`, and a problem somebody wrote down there also
 * arrived as a report of its own - a follow-up, carrying `context.qa`. This
 * joins them for /admin/opinie and /qa; nothing here writes anything, so a
 * report is closed only when an admin closes it.
 */
import { isSettled } from "./feedbackQueue";
import type { Feedback } from "./model";
import type { QaCheck, QaItem } from "./qa";
import type { ReportFix } from "./reportFixes";

/** Firestore's auto-ids, which is what `feedback/create` gets from `add()`.
 * Anything else in `fixes` is a typo, and would silently match nothing. */
export const FEEDBACK_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

/** Report id to the claims naming it - QA entries, or `REPORT_FIXES` - in the
 * order of the list they come from, which is newest first. */
export function fixIndex<Claim extends { fixes?: readonly string[] }>(
  claims: readonly Claim[],
): Map<string, Claim[]> {
  const index = new Map<string, Claim[]>();
  for (const claim of claims) {
    for (const id of new Set(claim.fixes ?? [])) {
      if (!FEEDBACK_ID_PATTERN.test(id)) continue;
      const found = index.get(id);
      if (found) found.push(claim);
      else index.set(id, [claim]);
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

/** What the claims on a report add up to - see `judgeFix`. */
export type FixJudgement = {
  /** Reports written while checking the claiming entries, newest first. */
  followUps: Feedback[];
  /** `null` until the verdicts that decide it have been read. */
  state: FixState | null;
  /** Offer "Zamknij jako załatwione". */
  close: boolean;
  /** The fix works, but a problem reported against it is still open - what
   * keeps `close` off. */
  blocked: boolean;
};

/** Where the fix for a report stands and whether to offer closing it, from
 * every claim on it, or nothing when nothing claims it.
 *
 * A QA entry is checked on /qa, so the verdicts on the newest one decide, as
 * `fixState` and `suggestClose` say. A change with no entry has nobody to
 * check it there: the admin reading the claim checks it, and is the one who
 * would click "Zamknij" - so it awaits them, and closing is offered for as
 * long as the report is open. `verdicts` is `null` while they are read, and an
 * entry's fix then has no state yet. */
export function judgeFix(
  report: Feedback,
  entries: readonly QaItem[],
  changes: readonly ReportFix[],
  verdicts: readonly Pick<QaCheck, "itemId" | "status">[] | null,
  all: readonly Feedback[],
): FixJudgement | undefined {
  const entry = entries[0];
  if (!entry) {
    if (changes.length === 0) return undefined;
    return {
      followUps: [],
      state: "awaiting",
      close: !isSettled(report),
      blocked: false,
    };
  }
  const followUps = followUpsOf(report, entries, all);
  const state = verdicts ? fixState(entry, verdicts) : null;
  return {
    followUps,
    state,
    close: !!state && suggestClose(report, state, followUps),
    blocked:
      !isSettled(report) && state === "works" && followUps.some(blocksClosing),
  };
}
