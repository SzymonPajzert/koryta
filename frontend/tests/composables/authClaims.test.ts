import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { Timestamp } from "firebase/firestore";
import { useAuthState } from "~/composables/auth";

/** The role flags, and what happens to them when the claims script changes
 * somebody's role while they have the site open.
 *
 * The script writes the claims to Auth and then stamps
 * `users/{uid}.claimsChangedAt`. That document is already live in every tab
 * (`userConfig`), so the stamp is what tells a browser its token is out of date
 * - nothing else would until the token's hourly refresh. */

const { tokenListeners } = vi.hoisted(() => ({
  tokenListeners: [] as Array<() => void>,
}));

// Created here rather than hoisted: the mocks below only hand these out once
// `useAuthState` asks, by which time the module body has run.
const currentUser = ref<ReturnType<typeof account>["user"] | null>(null);
const configData = ref<Record<string, unknown> | null | undefined>(undefined);
const auth = { name: "auth" };

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  onIdTokenChanged: vi.fn((_auth: unknown, listener: () => void) => {
    tokenListeners.push(listener);
    return () => {};
  }),
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
}));

vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useFirebaseApp: () => ({ name: "[DEFAULT]" }),
  useFirebaseAuth: () => auth,
  useCurrentUser: () => currentUser,
  useIsCurrentUserLoaded: () => ref(true),
  useDocument: () => ({ data: configData }),
}));

// The same composables reach `useAuthState` through Nuxt's auto-imports too;
// see app/composables/auth.test.ts for why both are mocked.
mockNuxtImport("useCurrentUser", () => () => currentUser);
mockNuxtImport("useFirebaseAuth", () => () => auth);
mockNuxtImport("useFirebaseApp", () => () => ({ name: "[DEFAULT]" }));
mockNuxtImport("useDocument", () => () => ({ data: configData }));

/** A signed-in account whose token was issued at `issuedAt` with `claims`.
 *
 * `granted` is what the account holds in Auth after the script ran: a forced
 * refresh (`getIdToken(true)`) swaps it in and stamps the token with the time
 * of the refresh, as Firebase would. */
function account(
  uid: string,
  claims: Record<string, unknown>,
  issuedAt = TOKEN_ISSUED,
) {
  const token = {
    claims,
    issuedAt,
    granted: undefined as Record<string, unknown> | undefined,
    refreshedAt: REFRESHED,
  };
  const user = {
    uid,
    getIdTokenResult: vi.fn(async () => ({
      claims: { ...token.claims },
      issuedAtTime: token.issuedAt.toUTCString(),
      token: "token",
    })),
    getIdToken: vi.fn(async (force?: boolean) => {
      if (force) {
        if (token.granted) token.claims = token.granted;
        token.issuedAt = token.refreshedAt;
      }
      return "token";
    }),
  };
  return { user, token };
}

const TOKEN_ISSUED = new Date("2026-10-05T10:00:00Z");
const SCRIPT_RAN = new Date("2026-10-05T10:20:00Z");
const REFRESHED = new Date("2026-10-05T10:20:01Z");

/** Firestore hands the client a fresh `Timestamp` object with every snapshot,
 * equal values included. */
const stamp = (at: Date | number) => Timestamp.fromMillis(+at);

function signIn(acc: ReturnType<typeof account>) {
  currentUser.value = acc.user;
  configData.value = null;
}

async function settle() {
  // The watcher, the token read, the forced refresh and the flags' own
  // re-read are each a promise; two rounds drain them all.
  await flushPromises();
  await flushPromises();
}

describe("useAuthState role flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.value = null;
    configData.value = undefined;
    // Shared by every caller in a tab, so a test leaves them set for the next.
    const state = useAuthState();
    state.claimsRefreshed.value = false;
    state.claimsSignedOut.value = false;
  });

  it("tells an established administrator from one on trial", async () => {
    signIn(account("established", { admin: true, datascience: true }));
    const established = useAuthState();
    await settle();

    expect(established.isAdmin.value).toBe(true);
    expect(established.isEstablishedAdmin.value).toBe(true);
    expect(established.isNewAdmin.value).toBe(false);
    expect(established.isDatascience.value).toBe(true);
    expect(established.isOwner.value).toBe(false);

    signIn(account("trial", { admin: true, newAdmin: true }));
    const trial = useAuthState();
    await settle();

    expect(trial.isAdmin.value).toBe(true);
    expect(trial.isEstablishedAdmin.value).toBe(false);
    expect(trial.isNewAdmin.value).toBe(true);
  });

  it("does not count a stray newAdmin without admin as anything", async () => {
    // As on the server (`isNewAdmin` in server/utils/contributors.ts): ending a
    // trial by demoting can leave the flag behind, and it means nothing alone.
    signIn(account("demoted", { newAdmin: true }));
    const state = useAuthState();
    await settle();

    expect(state.isAdmin.value).toBe(false);
    expect(state.isNewAdmin.value).toBe(false);
    expect(state.isEstablishedAdmin.value).toBe(false);
  });

  it("leaves every flag undecided while nobody is signed in", async () => {
    const state = useAuthState();
    await settle();

    expect(state.isAdmin.value).toBeUndefined();
    expect(state.isEstablishedAdmin.value).toBeUndefined();
    expect(state.claimsRefreshed.value).toBe(false);
  });

  it("refreshes the token when the script changed the claims after it was issued", async () => {
    const promoted = account("promoted", {});
    signIn(promoted);
    const state = useAuthState();
    await settle();
    expect(state.isAdmin.value).toBe(false);

    promoted.token.granted = { admin: true, datascience: true, trusted: true };
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();

    expect(promoted.user.getIdToken).toHaveBeenCalledWith(true);
    // The same `User` object as before - only the flags reading the counter
    // the refresh bumped can notice.
    expect(state.isAdmin.value).toBe(true);
    expect(state.isEstablishedAdmin.value).toBe(true);
    expect(state.claimsRefreshed.value).toBe(true);
  });

  it("updates the flags of every caller, not only the one that refreshed", async () => {
    const promoted = account("promoted-everywhere", {});
    signIn(promoted);
    const layout = useAuthState();
    const page = useAuthState();
    await settle();

    promoted.token.granted = { admin: true };
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();

    // Both watched the same document; one refresh served both.
    expect(
      promoted.user.getIdToken.mock.calls.filter(([force]) => force),
    ).toHaveLength(1);
    expect(layout.isAdmin.value).toBe(true);
    expect(page.isAdmin.value).toBe(true);
  });

  it("leaves a token issued after the change alone", async () => {
    // Somebody who signed in after the script ran already has the new claims.
    const fresh = account("fresh", {}, REFRESHED);
    signIn(fresh);
    const state = useAuthState();
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();

    expect(fresh.user.getIdToken).not.toHaveBeenCalledWith(true);
    expect(state.claimsRefreshed.value).toBe(false);
  });

  it("leaves a token issued in the same second alone", async () => {
    // A token's issue time is whole seconds, so one minted 300 ms after the
    // stamp reads as if it came first. Refreshing it would bring back a token
    // issued in that same second, and every reload would refresh again.
    const sameSecond = account("same-second", {}, TOKEN_ISSUED);
    signIn(sameSecond);
    const state = useAuthState();
    configData.value = { claimsChangedAt: stamp(+TOKEN_ISSUED + 700) };
    await settle();

    expect(sameSecond.user.getIdToken).not.toHaveBeenCalledWith(true);
    expect(state.claimsRefreshed.value).toBe(false);
  });

  it("refreshes at most once for one change, even if the token stays old", async () => {
    const stuck = account("stuck", {});
    // Whatever the refresh returns still predates the stamp - a skewed clock,
    // say. Without a guard every snapshot would refresh again.
    stuck.token.refreshedAt = TOKEN_ISSUED;
    signIn(stuck);
    useAuthState();
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();

    // The document changes for another reason; the stamp is equal, but a new
    // object, as every snapshot's is.
    configData.value = {
      claimsChangedAt: stamp(SCRIPT_RAN),
      displayName: "Anna",
    };
    await settle();
    useAuthState();
    await settle();

    expect(
      stuck.user.getIdToken.mock.calls.filter(([force]) => force),
    ).toHaveLength(1);
  });

  it("refreshes again when the script changes the claims again", async () => {
    const twice = account("twice", {});
    signIn(twice);
    const state = useAuthState();
    twice.token.granted = { admin: true, newAdmin: true };
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();
    expect(state.isNewAdmin.value).toBe(true);

    // The trial ends an hour later.
    twice.token.granted = { admin: true };
    twice.token.refreshedAt = new Date("2026-10-05T11:20:01Z");
    configData.value = {
      claimsChangedAt: stamp(new Date("2026-10-05T11:20:00Z")),
    };
    await settle();

    expect(
      twice.user.getIdToken.mock.calls.filter(([force]) => force),
    ).toHaveLength(2);
    expect(state.isNewAdmin.value).toBe(false);
    expect(state.isEstablishedAdmin.value).toBe(true);
  });

  // A demotion also revokes the refresh tokens, so this is how a forced
  // refresh ends for someone who lost a claim - and for an account the owner
  // disabled. Firebase signs them out on the spot, mid-page; without a word
  // the menus would just vanish.
  it.each(["auth/user-token-expired", "auth/user-disabled"])(
    "says why when the refresh ends the session (%s), and does not retry it",
    async (code) => {
      const revoked = account(`revoked-${code}`, { admin: true });
      revoked.user.getIdToken.mockRejectedValue(
        Object.assign(new Error("signed out"), { code }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});
      signIn(revoked);
      const state = useAuthState();
      configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
      await settle();
      configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
      await settle();

      expect(revoked.user.getIdToken).toHaveBeenCalledTimes(1);
      expect(state.claimsSignedOut.value).toBe(true);
      expect(state.claimsRefreshed.value).toBe(false);
    },
  );

  it("says nothing when the refresh fails otherwise, and does not retry it", async () => {
    // Offline, say: the session is intact and the token catches up at its
    // hourly refresh, as every token did before the stamp existed.
    const offline = account("offline", { admin: true });
    offline.user.getIdToken.mockRejectedValue(
      Object.assign(new Error("offline"), {
        code: "auth/network-request-failed",
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signIn(offline);
    const state = useAuthState();
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();
    configData.value = { claimsChangedAt: stamp(SCRIPT_RAN) };
    await settle();

    expect(offline.user.getIdToken).toHaveBeenCalledTimes(1);
    expect(state.claimsSignedOut.value).toBe(false);
    expect(state.claimsRefreshed.value).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("ignores a stamp that is not a timestamp", async () => {
    // The document is the user's own to write; whatever they put there can
    // at most cost them a token refresh, never an error.
    const odd = account("odd", {});
    signIn(odd);
    const state = useAuthState();
    configData.value = { claimsChangedAt: "jutro" };
    await settle();

    expect(odd.user.getIdToken).not.toHaveBeenCalledWith(true);
    expect(state.claimsRefreshed.value).toBe(false);
  });

  it("re-reads the flags whenever the token changes, wherever it changed", async () => {
    // The hourly refresh, or another tab's forced one, which Firebase copies
    // into this tab - neither goes through the watcher above.
    const elsewhere = account("elsewhere", {});
    signIn(elsewhere);
    const state = useAuthState();
    await settle();
    expect(state.isDatascience.value).toBe(false);
    expect(tokenListeners.length).toBeGreaterThan(0);

    elsewhere.token.claims = { datascience: true, trusted: true };
    for (const listener of tokenListeners) listener();
    await settle();

    expect(state.isDatascience.value).toBe(true);
    // Nothing was forced here, so there is nothing to announce.
    expect(state.claimsRefreshed.value).toBe(false);
  });
});
