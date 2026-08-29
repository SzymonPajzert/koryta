import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { getFirestore, getDocs, setDoc } from "firebase/firestore";
import { useQaChecks } from "../../app/composables/qa";
import { authRequest } from "../../app/composables/auth";
import { submitFeedback } from "../../app/composables/feedback";
import type { QaCheck } from "../../shared/qa";
import type { FeedbackStatus, QaAdminResolution } from "../../shared/model";

const user = ref<{ uid: string } | null>({ uid: "me" });

// A verdict goes out through the same intake as the "Zgłoś" button; what these
// tests care about is which verdicts get that far, and what they say.
vi.mock("../../app/composables/feedback", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/feedback")>();
  return {
    ...actual,
    submitFeedback: vi.fn(async () => ({ id: "fb-1" })),
  };
});

// Partial, because `useAuthState` has to stay real - it is where the composable
// gets its user from, and the vuefire mock below is what stands in for firebase.
// Only the trip to nitro is faked.
vi.mock("../../app/composables/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/auth")>();
  return {
    ...actual,
    authRequest: vi.fn(async () => ({ resolutions: {} })),
  };
});

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    getFirestore: vi.fn(() => ({ type: "firestore" })),
    collection: vi.fn((_db, name: string) => ({ type: "collection", name })),
    doc: vi.fn((_db, name: string, id: string) => ({ type: "doc", name, id })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    setDoc: vi.fn(async () => undefined),
    serverTimestamp: vi.fn(() => ({ type: "serverTimestamp" })),
  };
});

vi.mock("vuefire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuefire")>();
  return {
    ...actual,
    useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
    useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
    useCurrentUser: vi.fn(() => user),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
    useDocument: vi.fn(() => ({ data: ref(undefined) })),
  };
});

const snapshotOf = (checks: QaCheck[]) => ({
  docs: checks.map((check) => ({ data: () => check })),
});

beforeEach(async () => {
  vi.clearAllMocks();
  // The composable shares its state through useState, and loading is skipped
  // for a user whose verdicts are already in hand - so each test starts by
  // signing out, which is what drops both.
  user.value = null;
  await useQaChecks().load();
  // The admin's answers are cached the same way and need the same reset.
  await useQaChecks().loadAdminResolutions();
  user.value = { uid: "me" };
  vi.mocked(authRequest).mockResolvedValue({ resolutions: {} } as never);
  vi.clearAllMocks();
});

/** What `/api/feedback/qa` answers for one entry. */
const resolvedAs = (
  status: FeedbackStatus,
  itemId = "qa-changelog",
): { resolutions: Record<string, QaAdminResolution> } => ({
  resolutions: {
    [itemId]: { itemId, status, reportedAt: "2026-08-20T10:00:00.000Z" },
  },
});

/** This reader has reported a problem with `qa-changelog` and it is in hand. */
const withMyReport = async (extra: Partial<QaCheck> = {}) => {
  vi.mocked(getDocs).mockResolvedValue(
    snapshotOf([
      {
        itemId: "qa-changelog",
        userUid: "me",
        status: "issue",
        feedback: "filtr nie filtruje",
        ...extra,
      },
    ]) as never,
  );
  const qa = useQaChecks();
  await qa.load();
  return qa;
};

describe("useQaChecks", () => {
  it("reads the database the rest of the app writes to", () => {
    useQaChecks();
    expect(getFirestore).toHaveBeenCalledWith(expect.anything(), "koryta-pl");
  });

  it("reports nothing as loaded until this user's verdicts are read", async () => {
    vi.mocked(getDocs).mockResolvedValue(snapshotOf([]) as never);

    const qa = useQaChecks();
    expect(qa.loaded.value).toBe(false);

    await qa.load();
    expect(qa.loaded.value).toBe(true);

    user.value = { uid: "someone-else" };
    expect(qa.loaded.value).toBe(false);
  });

  it("loads the verdicts once per user", async () => {
    vi.mocked(getDocs).mockResolvedValue(
      snapshotOf([{ itemId: "a", userUid: "me", status: "ok" }]) as never,
    );

    const qa = useQaChecks();
    await qa.load();
    await qa.load();

    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(qa.stateOf("a")).toBe("ok");
  });

  it("leaves an entry unchecked when only somebody else has been through it", async () => {
    vi.mocked(getDocs).mockResolvedValue(
      snapshotOf([
        { itemId: "a", userUid: "other", status: "ok" },
        { itemId: "b", userUid: "other", status: "issue" },
      ]) as never,
    );

    const qa = useQaChecks();
    await qa.load();

    expect(qa.stateOf("a")).toBe("unchecked");
    expect(qa.stateOf("b")).toBe("unchecked");
    // ...but their report is worth knowing about before starting.
    expect(qa.reportedByOthers("b")).toBe(true);
    expect(qa.reportedByOthers("a")).toBe(false);
  });

  it("re-reads for a different user and forgets the previous one", async () => {
    vi.mocked(getDocs).mockResolvedValue(
      snapshotOf([{ itemId: "a", userUid: "other", status: "ok" }]) as never,
    );

    const qa = useQaChecks();
    await qa.load();

    user.value = null;
    await qa.load();
    expect(qa.checks.value).toEqual([]);

    user.value = { uid: "someone-else" };
    await qa.load();
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it("normalises firestore timestamps into ISO strings", async () => {
    const stamped = new Date("2026-08-20T10:00:00.000Z");
    vi.mocked(getDocs).mockResolvedValue(
      snapshotOf([
        {
          itemId: "a",
          userUid: "other",
          status: "ok",
          updatedAt: { toDate: () => stamped } as unknown as string,
        },
      ]) as never,
    );

    const qa = useQaChecks();
    await qa.load();

    expect(qa.checksFor("a")[0]?.updatedAt).toBe(stamped.toISOString());
  });

  it("writes one document per item and user", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "  nie działa  ");

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [reference, data] = vi.mocked(setDoc).mock.calls[0]!;
    expect(reference).toMatchObject({
      name: "qaChecks",
      id: "qa-changelog_me",
    });
    expect(data).toMatchObject({
      itemId: "qa-changelog",
      userUid: "me",
      status: "issue",
      feedback: "nie działa",
    });
  });

  it("shows the saved verdict without re-reading firestore", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "ok", "wygląda dobrze");

    expect(getDocs).not.toHaveBeenCalled();
    expect(qa.stateOf("qa-changelog")).toBe("ok");
    expect(qa.myCheck("qa-changelog")).toMatchObject({
      status: "ok",
      feedback: "wygląda dobrze",
    });
    expect(qa.counts.value.ok).toBe(1);
  });

  it("replaces this user's earlier verdict rather than adding a second", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "źle");
    await qa.saveCheck("qa-changelog", "ok", "już dobrze");

    expect(qa.checksFor("qa-changelog")).toHaveLength(1);
    expect(qa.stateOf("qa-changelog")).toBe("ok");
  });

  it("keeps the date the first verdict was written", async () => {
    vi.mocked(getDocs).mockResolvedValue(
      snapshotOf([
        {
          itemId: "a",
          userUid: "me",
          status: "ok",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]) as never,
    );
    const qa = useQaChecks();
    await qa.load();

    await qa.saveCheck("a", "issue", "jednak nie");

    expect(qa.myCheck("a")?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // Only `updatedAt` is re-stamped on the server.
    const [, data] = vi.mocked(setDoc).mock.calls[0]!;
    expect(data).not.toHaveProperty("createdAt");
  });

  it("sends a reported problem where every other report goes", async () => {
    const qa = useQaChecks();
    const result = await qa.saveCheck(
      "qa-changelog",
      "issue",
      "  filtr nie filtruje  ",
    );

    expect(result).toEqual({ reported: true, forwarded: true });
    const [draft, options] = vi.mocked(submitFeedback).mock.calls[0]!;
    expect(options).toEqual({ attribute: true });
    expect(draft.kind).toBe("bug");
    expect(draft.message).toBe("filtr nie filtruje");
    expect(draft.context.qa).toEqual({
      itemId: "qa-changelog",
      // Copied off the entry, so the Slack card reads right later.
      title: "Lista zmian do sprawdzenia",
      status: "issue",
    });
  });

  it("sends an approval that came with something to say", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "ok", "działa, ale wolno");

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(submitFeedback).mock.calls[0]![0].kind).toBe("idea");
  });

  it("keeps a bare tick to itself", async () => {
    const qa = useQaChecks();
    const result = await qa.saveCheck("qa-changelog", "ok");

    expect(result).toEqual({ reported: false, forwarded: false });
    expect(submitFeedback).not.toHaveBeenCalled();
    // The verdict is still this reader's own, and still recorded.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(qa.stateOf("qa-changelog")).toBe("ok");
  });

  it("does not report the same verdict twice", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "filtr nie filtruje");
    await qa.saveCheck("qa-changelog", "issue", "filtr nie filtruje");

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    // Saving again is still a save - only the report is held back.
    expect(setDoc).toHaveBeenCalledTimes(2);

    await qa.saveCheck("qa-changelog", "ok", "już działa");
    expect(submitFeedback).toHaveBeenCalledTimes(2);
  });

  it("keeps the verdict when the report cannot get out", async () => {
    vi.mocked(submitFeedback).mockRejectedValueOnce(new Error("offline"));
    const qa = useQaChecks();

    const result = await qa.saveCheck("qa-changelog", "issue", "nie działa");

    // Saved first on purpose: a Slack outage costs the report, never the tick.
    expect(result).toEqual({ reported: true, forwarded: false });
    expect(qa.stateOf("qa-changelog")).toBe("issue");
  });

  it("refuses to save when nobody is logged in", async () => {
    user.value = null;
    const qa = useQaChecks();
    await expect(qa.saveCheck("a", "ok")).rejects.toThrow();
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe("useQaChecks - what admins did with the reports", () => {
  it("asks nitro, once per reader", async () => {
    const qa = useQaChecks();
    await qa.loadAdminResolutions();
    await qa.loadAdminResolutions();

    expect(authRequest).toHaveBeenCalledTimes(1);
    expect(authRequest).toHaveBeenCalledWith("/api/feedback/qa", {
      method: "GET",
    });

    user.value = { uid: "someone-else" };
    await qa.loadAdminResolutions();
    expect(authRequest).toHaveBeenCalledTimes(2);
  });

  it("forgets them when the reader signs out", async () => {
    vi.mocked(authRequest).mockResolvedValue(resolvedAs("resolved") as never);
    const qa = useQaChecks();
    await qa.loadAdminResolutions();
    expect(qa.adminResolution("qa-changelog")?.status).toBe("resolved");

    user.value = null;
    await qa.loadAdminResolutions();
    expect(qa.adminResolution("qa-changelog")).toBeNull();
  });

  it("costs the banner and not the page when the query fails", async () => {
    vi.mocked(authRequest).mockRejectedValueOnce(new Error("no index"));
    const qa = await withMyReport();

    // The likeliest failure on prod is a missing composite index, and it must
    // not take the verdicts down with it.
    await expect(qa.loadAdminResolutions()).resolves.toBeUndefined();
    expect(qa.awaitingAcceptance("qa-changelog")).toBe(false);
    expect(qa.stateOf("qa-changelog")).toBe("issue");

    // Nothing was cached, so the next visit tries again.
    vi.mocked(authRequest).mockResolvedValue(resolvedAs("resolved") as never);
    await qa.loadAdminResolutions();
    expect(qa.awaitingAcceptance("qa-changelog")).toBe(true);
  });

  // Settled is "dealt with" or "decided against"; a report still in the queue
  // is not something to accept.
  const closures: [FeedbackStatus, boolean][] = [
    ["resolved", true],
    ["wont_fix", true],
    ["in_progress", false],
    ["new", false],
  ];

  it.each(closures)("asks about a %s report: %s", async (status, expected) => {
    vi.mocked(authRequest).mockResolvedValue(resolvedAs(status) as never);
    const qa = await withMyReport();
    await qa.loadAdminResolutions();

    expect(qa.awaitingAcceptance("qa-changelog")).toBe(expected);
  });

  it("says nothing about an entry this reader never reported", async () => {
    vi.mocked(authRequest).mockResolvedValue(resolvedAs("resolved") as never);
    // Spelled out because `mockClear` between tests keeps implementations: a
    // neighbouring test's report would otherwise still be in hand here.
    vi.mocked(getDocs).mockResolvedValue(snapshotOf([]) as never);
    const qa = useQaChecks();
    await qa.load();
    await qa.loadAdminResolutions();

    // A closed report with no verdict of this reader's behind it is somebody
    // else's business - and their own "działa" is not something to accept.
    expect(qa.awaitingAcceptance("qa-changelog")).toBe(false);
    await qa.saveCheck("qa-changelog", "ok", "działa");
    expect(qa.awaitingAcceptance("qa-changelog")).toBe(false);
  });

  it("stops asking once the reader has accepted", async () => {
    vi.mocked(authRequest).mockResolvedValue(resolvedAs("resolved") as never);
    const qa = await withMyReport();
    await qa.loadAdminResolutions();

    await qa.acceptResolution("qa-changelog");

    expect(qa.awaitingAcceptance("qa-changelog")).toBe(false);
    // Back to needing a look, without a re-read and without claiming the
    // reader verified anything.
    expect(qa.stateOf("qa-changelog")).toBe("unchecked");
    expect(qa.counts.value.issue).toBe(0);
  });

  it("writes the acceptance beside the verdict, not over it", async () => {
    const qa = await withMyReport();
    await qa.acceptResolution("qa-changelog");

    const [reference, data, options] = vi.mocked(setDoc).mock.calls[0]!;
    expect(reference).toMatchObject({
      name: "qaChecks",
      id: "qa-changelog_me",
    });
    // itemId and userUid ride along because the firestore rule reads them off
    // the resulting document, which on a merge is what the write produces.
    expect(data).toMatchObject({ itemId: "qa-changelog", userUid: "me" });
    expect(data).toHaveProperty("acceptedResolutionAt");
    // Accepting is not a verdict: it must not reorder "Co napisali inni".
    expect(data).not.toHaveProperty("updatedAt");
    expect(data).not.toHaveProperty("status");
    expect(options).toEqual({ merge: true });
    // The verdict itself is untouched - the reader still found a problem.
    expect(qa.myCheck("qa-changelog")?.status).toBe("issue");
  });

  it("refuses to accept when nobody is logged in", async () => {
    user.value = null;
    const qa = useQaChecks();
    await expect(qa.acceptResolution("qa-changelog")).rejects.toThrow();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("clears an earlier acceptance on the next verdict", async () => {
    const qa = await withMyReport({
      acceptedResolutionAt: "2026-08-20T10:00:00.000Z",
    });
    await qa.saveCheck("qa-changelog", "issue", "nadal nie działa");

    // The write is a merge, so a leftover acceptance would keep a freshly
    // reported problem out of "Problemy".
    const [, data] = vi.mocked(setDoc).mock.calls[0]!;
    expect(data).toMatchObject({ acceptedResolutionAt: null });
    expect(qa.stateOf("qa-changelog")).toBe("issue");
  });

  it("lets the reader say it is still broken, in the same words", async () => {
    vi.mocked(authRequest).mockResolvedValue(resolvedAs("resolved") as never);
    const qa = await withMyReport();
    await qa.loadAdminResolutions();

    const result = await qa.saveCheck(
      "qa-changelog",
      "issue",
      "filtr nie filtruje",
    );

    // Identical to what is already stored, and normally held back as noise -
    // but after a closure it is the reader disagreeing, which is news.
    expect(result).toEqual({ reported: true, forwarded: true });
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    // And the banner goes away on the click: the report just filed is the
    // newest one about this entry, and nobody has triaged it.
    expect(qa.adminResolution("qa-changelog")?.status).toBe("new");
    expect(qa.awaitingAcceptance("qa-changelog")).toBe(false);
  });
});
