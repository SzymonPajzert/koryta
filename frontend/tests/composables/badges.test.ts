import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useBadgeVotes } from "../../app/composables/badges";
import { badgeKey } from "../../shared/badges";

/** The live vote document `useVoteDocument` reads, as a ref the tests can move.
 *
 * Declared before the `vi.mock` calls read it only inside an arrow, which is
 * what keeps the hoisted factories from touching it before it exists - the same
 * shape tests/components/extraction/WrongPersonButton.test.ts uses. */
const voteDocument = ref<
  { categoryVotes: Record<string, number> } | undefined
>();
const user = ref<{ uid: string } | null>({ uid: "reader-1" });
const setDoc = vi.fn().mockResolvedValue(undefined);
const trackGoal = vi.fn();

vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useFirebaseApp: () => ({}),
  useCurrentUser: () => user,
  useDocument: () => voteDocument,
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  getFirestore: () => ({}),
  // The path is the assertion target for „one document per (person, reader)”,
  // so the stub keeps it rather than returning an opaque handle.
  doc: (_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }),
  setDoc: (...args: unknown[]) => setDoc(...args),
}));

vi.mock("../../app/composables/auth", () => ({
  useAuthState: () => ({ user }),
}));

vi.mock("../../app/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
}));

/** The payload of the last `setDoc`, as the document would have been merged. */
function lastWrite(): {
  nodeId?: string;
  userUid?: string;
  categoryVotes?: Record<string, number>;
  updatedAt?: string;
} {
  const call = setDoc.mock.calls.at(-1);
  return (call?.[1] ?? {}) as Record<string, never>;
}

beforeEach(() => {
  setDoc.mockClear();
  trackGoal.mockClear();
  user.value = { uid: "reader-1" };
  voteDocument.value = undefined;
});

describe("useBadgeVotes", () => {
  it("reads the sign of the stored value, not the value", () => {
    // 5 is a legal value in this map - the five `VoteCategory` axes are voted
    // on -5..5 and the rules allow the whole range under any key - so a badge
    // key can carry one. The control has two positions, and `computeBadgeStats`
    // signs it the same way when it counts the tally.
    voteDocument.value = {
      categoryVotes: {
        [badgeKey("omnibus")]: 5,
        [badgeKey("spolecznik")]: -3,
        [badgeKey("zmiana-barw")]: 0,
      },
    };

    const { myVote } = useBadgeVotes("person-1");

    expect(myVote("omnibus")).toBe(1);
    expect(myVote("spolecznik")).toBe(-1);
    // A stored 0 is a withdrawn vote, not a missing one, and reads the same as
    // never having voted.
    expect(myVote("zmiana-barw")).toBe(0);
    expect(myVote("kot-na-cztery-nogi")).toBe(0);
  });

  it("reads a value that is not a number as no vote", () => {
    // The document is client-written, so nothing guarantees a number under a
    // `badge:` key. NaN would render as neither arrow *and* never compare equal
    // to the clicked direction, so the toggle could never undo it.
    voteDocument.value = {
      categoryVotes: {
        [badgeKey("omnibus")]: "tak" as unknown as number,
      },
    };

    expect(useBadgeVotes("person-1").myVote("omnibus")).toBe(0);
  });

  it("carries the whole identifying set on every write, not only the patch", async () => {
    const { vote } = useBadgeVotes("person-1");

    await vote("omnibus", 1);

    const [reference, payload, options] = setDoc.mock.calls[0] ?? [];
    expect((reference as { path: string }).path).toBe(
      "votes/person-1_reader-1",
    );
    // `computeVoteStats` reads `categoryVotes` with no guard, and
    // `onVoteWritten` hands it every vote on the node - a document created
    // without the field would stop the aggregate for the whole person.
    expect(payload).toEqual({
      nodeId: "person-1",
      userUid: "reader-1",
      categoryVotes: { [badgeKey("omnibus")]: 1 },
      updatedAt: expect.any(String),
    });
    // merge:true or the badge would wipe the reader's five category votes.
    expect(options).toEqual({ merge: true });
  });

  it("withdraws when the same arrow is clicked twice", async () => {
    voteDocument.value = { categoryVotes: { [badgeKey("spolecznik")]: 1 } };

    const { vote } = useBadgeVotes("person-1");
    await vote("spolecznik", 1);

    // An explicit 0, never a field deletion: `computeBadgeStats` signs the
    // value, so 0 counts in neither column, and the write stays a plain
    // Record<string, number>.
    expect(lastWrite().categoryVotes).toEqual({ [badgeKey("spolecznik")]: 0 });
  });

  it("flips rather than withdraws when the other arrow is clicked", async () => {
    voteDocument.value = { categoryVotes: { [badgeKey("spolecznik")]: 1 } };

    const { vote } = useBadgeVotes("person-1");
    await vote("spolecznik", -1);

    expect(lastWrite().categoryVotes).toEqual({ [badgeKey("spolecznik")]: -1 });
  });

  it("touches no other key in the map", async () => {
    voteDocument.value = {
      categoryVotes: { interesting: 3, [badgeKey("omnibus")]: 1 },
    };

    const { vote } = useBadgeVotes("person-1");
    await vote("spolecznik", 1);

    // The patch is the one badge. Everything else survives because of
    // merge:true, not because it was resent - resending would let a stale
    // snapshot overwrite a newer verdict.
    expect(lastWrite().categoryVotes).toEqual({ [badgeKey("spolecznik")]: 1 });
  });

  it("refuses an id the catalogue does not know", async () => {
    const { vote } = useBadgeVotes("person-1");

    expect(await vote("wlasna-odznaka", 1)).toBe(false);
    // Not a counter on a public person document, and not an analytics goal
    // whose `badge` property is somebody's free text.
    expect(setDoc).not.toHaveBeenCalled();
    expect(trackGoal).not.toHaveBeenCalled();
  });

  it("refuses a bare id that is only the map key", async () => {
    // The stored key is `badge:omnibus`; the API takes the id. Passing the key
    // would write `badge:badge:omnibus`, so the catalogue has to reject it.
    const { vote } = useBadgeVotes("person-1");

    expect(await vote(badgeKey("omnibus"), 1)).toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("reports the direction as a goal, after the write", async () => {
    const { vote } = useBadgeVotes("person-1");

    await vote("omnibus", 1);

    // Ordering, not just occurrence: the goal fires from inside the `try`,
    // after `write` resolved. A goal recorded before the write would survive a
    // rules rejection and make the dashboard the only place the badge ever
    // existed - so the write has to have happened by the time it is sent.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(trackGoal).toHaveBeenCalledWith("osoba:badge-proposed", {
      badge: "omnibus",
    });
  });

  it("reports opposition and withdrawal as their own goals", async () => {
    // Three goals rather than one with a `direction` property, because the
    // three want different denominators (see `badgeGoal`,
    // app/composables/badges.ts): a proposal is measured against the readers
    // who saw the section, opposition against the proposals it answers, and a
    // withdrawal is the only one of the three that is not a first-time act.
    voteDocument.value = { categoryVotes: { [badgeKey("omnibus")]: 1 } };

    const { vote } = useBadgeVotes("person-1");

    await vote("omnibus", -1);
    expect(trackGoal).toHaveBeenLastCalledWith("osoba:badge-opposed", {
      badge: "omnibus",
    });

    // The listener has not moved, so `myVote` still reads 1 and clicking up
    // withdraws - the value written is 0 and the goal has to follow the value,
    // not the arrow.
    await vote("omnibus", 1);
    expect(lastWrite().categoryVotes).toEqual({ [badgeKey("omnibus")]: 0 });
    expect(trackGoal).toHaveBeenLastCalledWith("osoba:badge-withdrawn", {
      badge: "omnibus",
    });
  });

  it("holds the flag only while the write is in flight", async () => {
    let settle: () => void = () => {};
    setDoc.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );

    const { vote, loading } = useBadgeVotes("person-1");
    expect(loading.value).toBe(false);

    const pending = vote("omnibus", 1);
    expect(loading.value).toBe(true);
    // A second click while the first is in flight would re-send the same value:
    // the listener has not seen the write yet, so `myVote` still reads the old
    // one and the toggle would not toggle.
    expect(await vote("omnibus", 1)).toBe(false);

    settle();
    await pending;
    expect(loading.value).toBe(false);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});
