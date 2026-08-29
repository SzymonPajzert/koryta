import { computed } from "vue";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { authRequest, useAuthState } from "./auth";
import { captureFeedbackContext, submitFeedback } from "./feedback";
import { normalizeUpdateTime } from "~~/shared/revisions";
import { isFeedbackSettled, type QaAdminResolution } from "~~/shared/model";
import {
  QA_ITEMS,
  qaCheckId,
  qaFeedbackKind,
  qaFeedbackMessage,
  qaItemState,
  qaReportedByOthers,
  qaStateCounts,
  qaVerdictIsReportable,
  type QaCheck,
  type QaCheckStatus,
  type QaItemState,
} from "~~/shared/qa";

/** Verdicts on the QA changelog, shared by the page and the toolbar badge.
 *
 * Everybody's verdicts are read, but only this reader's decides what an entry
 * counts as - see `qaItemState`. The rest are what the page shows under "Co
 * napisali inni", so a second checker knows what to look for.
 *
 * Read once per session with `getDocs` rather than a live listener: the badge
 * hangs off the toolbar, so a listener here would be one open subscription per
 * logged in user on every page of the site, for data that changes when somebody
 * clicks a button on /qa. `saveCheck` patches the local copy, so the page the
 * click happened on updates without a re-read; `load(true)` is the way to see
 * what other people wrote since.
 */
export function useQaChecks() {
  const { user } = useAuthState();
  const route = useRoute();
  // Named explicitly - `useFirestore()` would hand back `(default)`, a
  // database this project does not use. See composables/auth.ts.
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  // Shared across every caller in the page, so the toolbar and the page below
  // it read the same list and only one of them pays for it.
  const checks = useState<QaCheck[]>("qa-checks", () => []);
  const loadedFor = useState<string | null>("qa-checks-loaded-for", () => null);
  const pending = useState<boolean>("qa-checks-pending", () => false);

  // What admins did with this reader's own reports, keyed by entry id. Kept
  // beside the verdicts and cached the same way, but loaded separately - see
  // `loadAdminResolutions`.
  const resolutions = useState<Record<string, QaAdminResolution>>(
    "qa-admin-resolutions",
    () => ({}),
  );
  const resolutionsFor = useState<string | null>(
    "qa-admin-resolutions-for",
    () => null,
  );
  const resolutionsPending = useState<boolean>(
    "qa-admin-resolutions-pending",
    () => false,
  );

  /** Fetches the verdicts unless this user's are already in hand. */
  async function load(force = false) {
    // Client only. The firestore handle the server renders with is not signed
    // in and does not point at the emulator, so a read there can only fail -
    // and fail unobserved, since callers do not await this.
    if (import.meta.server) return;

    const uid = user.value?.uid;
    if (!uid) {
      // Signing out has to drop the previous user's verdicts, or the badge
      // keeps counting against somebody who is no longer here.
      checks.value = [];
      loadedFor.value = null;
      return;
    }
    if (!force && loadedFor.value === uid) return;
    if (pending.value) return;

    pending.value = true;
    try {
      const snapshot = await getDocs(collection(db, "qaChecks"));
      checks.value = snapshot.docs.map((entry) => {
        const data = entry.data() as QaCheck;
        return {
          ...data,
          createdAt: normalizeUpdateTime(data.createdAt) ?? undefined,
          updatedAt: normalizeUpdateTime(data.updatedAt) ?? undefined,
        };
      });
      loadedFor.value = uid;
    } catch (error) {
      // Nothing awaits this - it runs from a watcher and from onMounted - so a
      // rejection here would go unhandled. Leaving `loadedFor` unset keeps the
      // page on its loading state and lets a later call try again, which is
      // the honest outcome: rendering every entry as unchecked would be a
      // claim about this reader that the data does not support.
      console.error("Nie udało się wczytać ocen QA", error);
    } finally {
      pending.value = false;
    }
  }

  /** Whether the verdicts in hand are this user's. Until they are, every entry
   * would read as unchecked, which is the one thing the page must not claim
   * wrongly - callers render the list only once this is true. */
  const loaded = computed(
    () => !!user.value && loadedFor.value === user.value.uid,
  );

  /** Fetches what admins did with this reader's own reports.
   *
   * Not folded into `load()`, which is the cheap one every page may call: this
   * goes over the network to nitro, which runs a Firestore query behind it,
   * and only /qa has anything to do with the answer. Cached per uid exactly
   * like the verdicts, so coming back to the page does not re-ask.
   *
   * Failures are swallowed with a log on purpose. What this adds is a banner;
   * the verdicts, the filters and the counts all work without it, and the most
   * likely failure - a missing composite index on prod - must cost the banner
   * and not the page.
   */
  async function loadAdminResolutions(force = false) {
    // Client only, for the same reason `load` is: the server render carries no
    // credentials, so the request could only come back 401 - unobserved, since
    // callers do not await this.
    if (import.meta.server) return;

    const uid = user.value?.uid;
    if (!uid) {
      resolutions.value = {};
      resolutionsFor.value = null;
      return;
    }
    if (!force && resolutionsFor.value === uid) return;
    if (resolutionsPending.value) return;

    resolutionsPending.value = true;
    try {
      const data = await authRequest<{
        resolutions: Record<string, QaAdminResolution>;
      }>("/api/feedback/qa", { method: "GET" });
      resolutions.value = data.resolutions;
      resolutionsFor.value = uid;
    } catch (error) {
      console.error("Nie udało się wczytać odpowiedzi na zgłoszenia QA", error);
    } finally {
      resolutionsPending.value = false;
    }
  }

  /** What the team did with this reader's newest report on an entry. */
  const adminResolution = (itemId: string): QaAdminResolution | null =>
    resolutions.value[itemId] ?? null;

  /** Whether this entry is waiting on the reader to say something about a
   * closure: they reported a problem, an admin settled it, and they have
   * neither accepted that nor reported it again. */
  const awaitingAcceptance = (itemId: string): boolean => {
    const mine = myCheck(itemId);
    if (!mine || mine.status !== "issue" || mine.acceptedResolutionAt) {
      return false;
    }
    return isFeedbackSettled(adminResolution(itemId)?.status);
  };

  /** Take the team's word for it: the entry stops counting as this reader's
   * problem and goes back to needing a look.
   *
   * `itemId` and `userUid` ride along even though the document already has
   * them, because the firestore rule reads both off `request.resource.data`,
   * which on a merge write is the resulting document - and a write that
   * carried only the new field would arrive with neither. `updatedAt` is
   * deliberately not touched: accepting is not a verdict, and re-stamping it
   * would push the entry to the top of "Co napisali inni" as if the reader had
   * written something new.
   */
  async function acceptResolution(itemId: string): Promise<void> {
    const uid = user.value?.uid;
    if (!uid) throw new Error("Trzeba być zalogowanym");

    await setDoc(
      doc(db, "qaChecks", qaCheckId(itemId, uid)),
      {
        itemId,
        userUid: uid,
        acceptedResolutionAt: serverTimestamp() as unknown as string,
      },
      { merge: true },
    );

    // Same trick as `saveCheck`: the sentinel is meaningless until firestore
    // resolves it, and the page needs the entry to move now.
    const stamped = new Date().toISOString();
    checks.value = checks.value.map((check) =>
      check.itemId === itemId && check.userUid === uid
        ? { ...check, acceptedResolutionAt: stamped }
        : check,
    );
  }

  /** This reader's own verdict on an entry - somebody else having been through
   * it leaves it unchecked here, on purpose. */
  const stateOf = (itemId: string): QaItemState =>
    qaItemState(itemId, checks.value, user.value?.uid);

  const counts = computed(() =>
    qaStateCounts(QA_ITEMS, checks.value, user.value?.uid),
  );

  /** Whether somebody else has already reported a problem with an entry. */
  const reportedByOthers = (itemId: string): boolean =>
    qaReportedByOthers(itemId, checks.value, user.value?.uid);

  /** Every verdict on one entry, newest first. */
  const checksFor = (itemId: string): QaCheck[] =>
    checks.value
      .filter((check) => check.itemId === itemId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const myCheck = (itemId: string): QaCheck | null =>
    checks.value.find(
      (check) => check.itemId === itemId && check.userUid === user.value?.uid,
    ) ?? null;

  /** Record a verdict, and tell the team about it if there is anything to
   * tell.
   *
   * Two writes on purpose, in this order. The `qaChecks` document is this
   * reader's own record - it is what /qa and the toolbar badge read back, and
   * it is theirs whether or not anybody else ever sees it. The report is the
   * copy that leaves the site, and it goes through exactly the intake the
   * "Zgłoś" button uses, so a problem found while checking a changelog entry
   * reaches Slack and `/admin/opinie` like any other. Saving first means a
   * Slack outage costs the report, never the verdict; the caller is told which
   * of the two happened.
   */
  async function saveCheck(
    itemId: string,
    status: QaCheckStatus,
    feedback?: string,
  ): Promise<{ reported: boolean; forwarded: boolean }> {
    const uid = user.value?.uid;
    if (!uid) throw new Error("Trzeba być zalogowanym");

    const existing = myCheck(itemId);
    const text = feedback?.trim() ?? "";
    // Read before the write below replaces it: what counts as news is what
    // changed against the verdict that was already there. The closure is part
    // of that - repeating "nadal nie działa" word for word is the reader
    // arguing with a decision, and has to reach the team.
    const reported = qaVerdictIsReportable(
      status,
      text,
      existing,
      isFeedbackSettled(adminResolution(itemId)?.status),
    );
    const stored: QaCheck = {
      itemId,
      userUid: uid,
      status,
      feedback: text,
      // Written on every verdict, not just when there is something to clear:
      // the write is a merge, so an acceptance left over from a previous round
      // would otherwise survive and keep a freshly reported problem out of
      // "Problemy".
      acceptedResolutionAt: null,
      // Stamped by firestore, like notes: a wrong clock on one machine should
      // not reorder everybody else's feedback.
      updatedAt: serverTimestamp() as unknown as string,
    };
    if (!existing) {
      stored.createdAt = serverTimestamp() as unknown as string;
    }
    await setDoc(doc(db, "qaChecks", qaCheckId(itemId, uid)), stored, {
      merge: true,
    });

    // The stored value is a sentinel until firestore resolves it, so the local
    // copy carries this machine's clock instead - it is only used for ordering
    // and display, and is replaced by the server's value on the next load.
    const local: QaCheck = {
      ...stored,
      feedback: text,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    checks.value = [
      ...checks.value.filter(
        (check) => !(check.itemId === itemId && check.userUid === uid),
      ),
      local,
    ];

    if (!reported) return { reported: false, forwarded: false };

    const item = QA_ITEMS.find((entry) => entry.id === itemId);
    try {
      await submitFeedback(
        {
          kind: qaFeedbackKind(status),
          message: qaFeedbackMessage(text),
          context: {
            ...captureFeedbackContext(route),
            qa: {
              itemId,
              // Copied so the card keeps reading right after the entry is
              // edited. An id with no entry left in the changelog should not
              // stop the report going out, so the id stands in for the title.
              title: item?.title ?? itemId,
              status,
            },
          },
        },
        // Always attributed: /qa is behind the auth middleware, and a verdict
        // is worth more when the team can go back to whoever left it.
        { attribute: true },
      );
      // The report just filed is now the newest one about this entry, and it
      // is untriaged - which is what the route would answer on the next load.
      // Patched here so the banner clears on the click rather than on a reload
      // the reader has no reason to do.
      resolutions.value = {
        ...resolutions.value,
        [itemId]: {
          itemId,
          status: "new",
          reportedAt: new Date().toISOString(),
        },
      };
      return { reported: true, forwarded: true };
    } catch (error) {
      // The verdict is already saved, so this is not a failure of the click -
      // it is the report not getting out, which is what the caller says.
      console.error("Nie udało się wysłać zgłoszenia z QA", error);
      return { reported: true, forwarded: false };
    }
  }

  return {
    items: QA_ITEMS,
    checks,
    pending,
    loaded,
    load,
    stateOf,
    counts,
    reportedByOthers,
    checksFor,
    myCheck,
    saveCheck,
    loadAdminResolutions,
    adminResolution,
    awaitingAcceptance,
    acceptResolution,
  };
}
