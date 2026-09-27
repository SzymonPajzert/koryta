import { computed, ref } from "vue";
import { authRequest } from "~/composables/auth";
import { useQaChecks } from "~/composables/qa";
import {
  compareNewest,
  compareQueue,
  feedbackSection,
  isSettled,
  rankForSlot,
  renumberQueue,
  slotHasRoom,
} from "~~/shared/feedbackQueue";
import {
  fixIndex,
  fixTargetsOf,
  judgeFix,
  type FixJudgement,
} from "~~/shared/feedbackFixes";
import { QA_ITEMS, type QaCheck, type QaItem } from "~~/shared/qa";
import { REPORT_FIXES, type ReportFix } from "~~/shared/reportFixes";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

/** Which reports the QA list says it fixes, and which the changes without an
 * entry do. Built once: both lists are code. */
const fixes = fixIndex(QA_ITEMS);
const changeFixes = fixIndex(REPORT_FIXES);

/** What the code says about a report it claims to fix: the QA entries (newest
 * first) and the changes without one, the reports written while checking the
 * entries, where the fix stands, and whether to offer closing the report. */
export type FixInfo = FixJudgement & {
  entries: QaItem[];
  changes: ReportFix[];
  /** Everybody's verdicts on the newest entry; none when no entry claims it. */
  verdicts: QaCheck[];
};

/** Reports are written by anyone, including signed-out visitors, so the route
 * is never trusted as a link target. The API only accepts site-relative paths;
 * this refuses anything else outright rather than rendering it. */
export const feedbackPageLink = (item: Feedback) =>
  /^\/(?!\/)/.test(item.context.route) ? item.context.route : undefined;

export const formatFeedbackDate = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });

/** The admin's side of user feedback: the list, where each report sits (in
 * the queue, outside it, closed), what the code says about fixing it, and the
 * writes that triage it - status, note and place in the queue.
 *
 * /admin/opinie is built on it, and so is /qa, which shows an admin the
 * reports this build says it fixes and the ones that came from the QA list,
 * and lets them be dealt with there. Every call has its own list and its own
 * write queue: two pages are never open at once, and a list shared across
 * navigations would be one that nobody reloaded.
 *
 * The list endpoint is admin-only. Nothing here calls it until `load` is
 * called, so a page may set this up for a reader who is not an admin as long
 * as it never loads.
 */
export function useFeedbackAdmin() {
  /** Verdicts from /qa. Re-read with every load of the list: this page judges
   * other people's verdicts, and a copy from earlier in the session would
   * disagree with the follow-up reports the list has just brought in. */
  const {
    checks,
    checksFor,
    loaded: checksLoaded,
    load: loadChecks,
  } = useQaChecks();

  const items = ref<Feedback[]>([]);
  const pending = ref(true);
  const loadError = ref("");
  const openTruncated = ref(false);
  const saving = ref<Record<string, boolean>>({});
  const draftNotes = ref<Record<string, string>>({});
  /** Ids that were settled when the list was loaded - see `feedbackSection`. */
  const settledAtLoad = ref(new Set<string>());
  const snackbar = ref(false);
  const snackbarText = ref("");

  const sectionOf = (item: Feedback) =>
    feedbackSection(item, settledAtLoad.value.has(item.id!));

  /** What gets worked on next, in order. */
  const queue = computed(() =>
    items.value
      .filter((item) => sectionOf(item) === "queue")
      .sort(compareQueue),
  );
  /** Open, but nobody has decided where it goes yet. */
  const inbox = computed(() =>
    items.value
      .filter((item) => sectionOf(item) === "inbox")
      .sort(compareNewest),
  );
  const closed = computed(() =>
    items.value
      .filter((item) => sectionOf(item) === "closed")
      .sort(compareNewest),
  );

  /** Place in the queue, 1-based, for the "#1" on a row. Counted over the
   * whole queue, whatever a page chooses to show of it. */
  const positions = computed(
    () => new Map(queue.value.map((item, index) => [item.id!, index + 1])),
  );

  /** For each report the code claims to fix - see `FixInfo`. */
  const fixInfo = computed(() => {
    const info = new Map<string, FixInfo>();
    for (const item of items.value) {
      const entries = fixes.get(item.id!) ?? [];
      const changes = changeFixes.get(item.id!) ?? [];
      const judged = judgeFix(
        item,
        entries,
        changes,
        checksLoaded.value ? checks.value : null,
        items.value,
      );
      if (!judged) continue;
      info.set(item.id!, {
        ...judged,
        entries,
        changes,
        verdicts: entries[0] ? checksFor(entries[0].id) : [],
      });
    }
    return info;
  });

  /** For a report written while checking a fix: the reports it was a fix for. */
  const fixTargets = computed(() => {
    const targets = new Map<string, Feedback[]>();
    for (const item of items.value) {
      const found = fixTargetsOf(item, fixes, items.value);
      if (found.length > 0) targets.set(item.id!, found);
    }
    return targets;
  });

  /** Ranks as the server last confirmed them, for undoing a move it refused.
   * Filled lazily by `setRank`, emptied by every load. */
  const confirmedRanks = new Map<string, number | undefined>();
  /** How many moves of each report have been made, so a refused move knows
   * whether a later one has already replaced it on screen. */
  const rankMoves = new Map<string, number>();

  /** `include` names one report to bring along whatever its age: a link from
   * Slack can point at a report too old to be in the list. */
  const load = async (include?: string | null) => {
    pending.value = true;
    loadError.value = "";
    // Not awaited: the list is useful without the verdicts, and the chips say
    // nothing about a fix until they arrive.
    loadChecks(true);
    try {
      const data = await authRequest<{
        feedback: Feedback[];
        openTruncated?: boolean;
      }>("/api/feedback/list", {
        method: "GET",
        ...(include ? { query: { include } } : {}),
      });
      items.value = data.feedback;
      confirmedRanks.clear();
      openTruncated.value = !!data.openTruncated;
      settledAtLoad.value = new Set(
        data.feedback.filter(isSettled).map((item) => item.id!),
      );
    } catch (error) {
      console.error("Failed to load feedback", error);
      loadError.value = "Nie udało się wczytać zgłoszeń.";
    } finally {
      pending.value = false;
    }
  };

  /** Status and note saves still in flight, so a reload waits for them rather
   * than reading the report from before the save. */
  const saves = new Set<Promise<unknown>>();

  /** Resolves to whether the server took it, for a page that says what it
   * closed. */
  const updateAdmin = async (
    item: Feedback,
    patch: { adminStatus?: FeedbackStatus; adminNote?: string },
  ): Promise<boolean> => {
    const id = item.id;
    if (!id) return false;
    saving.value[id] = true;
    const request = authRequest("/api/feedback/admin", {
      method: "POST",
      body: { id, ...patch },
    });
    saves.add(request);
    try {
      await request;
      // Onto the report as it is now: a reload may have replaced `item`.
      Object.assign(
        items.value.find((entry) => entry.id === id) ?? item,
        patch,
      );
      return true;
    } catch (error) {
      console.error("Failed to update feedback", error);
      return false;
    } finally {
      saves.delete(request);
      saving.value[id] = false;
    }
  };

  /** Only when the text changed: tabbing through the page is not an edit. */
  function saveNote(item: Feedback) {
    const draft = draftNotes.value[item.id!];
    if (draft === undefined || draft === (item.adminNote ?? "")) return;
    updateAdmin(item, { adminNote: draft });
  }

  const showRank = (item: Feedback, rank: number | undefined) => {
    if (rank === undefined) delete item.queueRank;
    else item.queueRank = rank;
  };

  /** Rank writes go out one at a time, in the order they were made, so two
   * quick moves cannot land the other way round. Each is shown at once. One
   * the server refuses puts its reports back where the server has them -
   * except any report a later move has already moved again on screen, which
   * then stands or falls on its own write.
   *
   * `renumber` rides along in the same request when the queue had to be
   * spaced out first; the server writes it and the move in one batch. */
  let rankWrites: Promise<unknown> = Promise.resolve();

  function setRank(
    item: Feedback,
    rank: number | null,
    renumber: { item: Feedback; rank: number }[] = [],
  ) {
    const moves = [{ item, rank }, ...renumber].map(({ item: moved, rank }) => {
      const id = moved.id!;
      if (!confirmedRanks.has(id)) confirmedRanks.set(id, moved.queueRank);
      const move = (rankMoves.get(id) ?? 0) + 1;
      rankMoves.set(id, move);
      showRank(moved, rank ?? undefined);
      return { item: moved, id, rank, move };
    });

    rankWrites = rankWrites.then(() =>
      authRequest("/api/feedback/admin", {
        method: "POST",
        body: {
          id: item.id,
          queueRank: rank,
          ...(renumber.length > 0
            ? {
                renumber: renumber.map(({ item: other, rank }) => ({
                  id: other.id,
                  queueRank: rank,
                })),
              }
            : {}),
        },
      }).then(
        () => {
          for (const { id, rank } of moves) {
            confirmedRanks.set(id, rank ?? undefined);
          }
        },
        (error) => {
          console.error("Failed to move feedback", error);
          for (const { item: moved, id, move } of moves) {
            if (rankMoves.get(id) === move) {
              showRank(moved, confirmedRanks.get(id));
            }
          }
          snackbarText.value = "Nie udało się zapisać kolejności.";
          snackbar.value = true;
        },
      ),
    );
    return rankWrites;
  }

  /** Put a report at `index` of the queue, counted without it. When the
   * neighbours there have no gap left between them, the rest of the queue is
   * spaced out again first, in the same write. */
  function moveTo(item: Feedback, index: number) {
    const others = queue.value.filter((entry) => entry.id !== item.id);
    if (slotHasRoom(others, index)) {
      return setRank(item, rankForSlot(others, index));
    }
    const renumber = renumberQueue(others);
    const spaced = others.map((other) => ({
      ...other,
      queueRank:
        renumber.find((entry) => entry.item === other)?.rank ?? other.queueRank,
    }));
    return setRank(item, rankForSlot(spaced, index), renumber);
  }

  /** Settles once every write made so far - ranks, statuses, notes - has been
   * answered, for a reload that must not read from before them. None of them
   * rejects: a refusal is handled where it lands. */
  const writesSettled = () => Promise.allSettled([rankWrites, ...saves]);

  return {
    items,
    pending,
    loadError,
    openTruncated,
    load,
    sectionOf,
    queue,
    inbox,
    closed,
    positions,
    fixInfo,
    fixTargets,
    saving,
    draftNotes,
    updateAdmin,
    saveNote,
    setRank,
    moveTo,
    writesSettled,
    snackbar,
    snackbarText,
  };
}
