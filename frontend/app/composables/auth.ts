import {
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onIdTokenChanged,
  type Auth,
  type ParsedToken,
  type User,
} from "firebase/auth";
import { computedAsync } from "@vueuse/core";
import {
  useCurrentUser,
  useFirebaseApp,
  useFirebaseAuth,
  useIsCurrentUserLoaded,
} from "vuefire";
import {
  collection,
  doc,
  getFirestore,
  type Timestamp,
} from "firebase/firestore";
import type { NotificationPreferences } from "~~/shared/notifications";

export type NewsletterPreferences = {
  /** Notify about recently found people. */
  recentPeople?: boolean;
  /** Notify about calls to action. */
  callsToAction?: boolean;
};

export type UserConfig = {
  photoURL?: string;
  displayName?: string;
  newsletter?: NewsletterPreferences;
  /** Mail about what happened to this user's own contributions. Separate from
   * `newsletter`, which is broadcast to whoever asked for it: these default to
   * on and are read by the server before it queues anything. */
  notifications?: NotificationPreferences;
  /** Whether this person's name may be shown next to their work on
   * /eksploruj/statystyki. Absent means no - see `shared/profile.ts`, and note
   * that `/api/stats/activity` reads this same field with the admin SDK. */
  publicProfile?: boolean;
  /** When the claims script (data/pipelines/src/set_auth_claims.py) last
   * changed this account's role. Written by the script after it has set the
   * claims, so a token issued before this moment carries the old ones - see
   * `refreshIfClaimsChanged`.
   *
   * Only ever a hint. The document is its owner's to write (firestore.rules),
   * so whatever is here can at most make their own browser fetch a fresh
   * token, and a fresh token carries what the account really holds. */
  claimsChangedAt?: Timestamp;
};

/** Bumped whenever this tab's ID token may carry different claims.
 *
 * The role flags in `useAuthState` are read off `User.getIdTokenResult()`, and
 * the `User` vuefire hands out is one object for the whole session: a new token
 * changes what is inside it, not the object, so a computed over it never ran
 * again. A promoted administrator kept a toolbar without "Admin" until
 * something remounted it, or until they signed out and in, which is what
 * everybody given a role used to be told to do. The flags read this counter as
 * well, and everything that changes the token bumps it: a forced refresh below,
 * and Firebase's own token listener, which also covers the hourly refresh and a
 * refresh made in another tab (Firebase copies the token across).
 *
 * Module-level because the token is: one per tab, however many components ask
 * about it.
 */
const claimsVersion = ref(0);

/** Set when a claims change has just been fetched into this tab, so the layout
 * can say why the menus moved. Cleared by whoever shows it. */
const claimsRefreshed = ref(false);

/** Set when fetching a claims change ended this tab's session instead, so the
 * layout can say why the user was signed out mid-page. Cleared by whoever
 * shows it. See `refreshIfClaimsChanged`. */
const claimsSignedOut = ref(false);

/** The errors with which Firebase refuses a refresh for good, and signs the
 * user out as it does (`_logoutIfInvalidated` in @firebase/auth): the
 * account's refresh tokens were revoked, or the account was disabled. */
const SESSION_ENDED_CODES: ReadonlySet<unknown> = new Set([
  "auth/user-token-expired",
  "auth/user-disabled",
]);

/** The `claimsChangedAt` values this tab has acted on, as `<uid>@<millis>`.
 *
 * At most one refresh per change, whatever happens next. The document is live
 * in every component that calls `useAuthState`, every snapshot of it hands over
 * a new Timestamp object, and a refresh that fails - or returns a token that
 * still reads as older than the stamp - would otherwise be retried on each of
 * them for as long as the tab is open. */
const handledClaimChanges = new Set<string>();

/** The Auth instance whose token changes `claimsVersion` already counts. */
let countedAuth: Auth | undefined;

function countTokenChanges(auth: Auth | null | undefined) {
  if (!auth || countedAuth === auth) return;
  countedAuth = auth;
  onIdTokenChanged(auth, () => {
    claimsVersion.value++;
  });
}

/** Fetches a new ID token if the claims script changed the account's claims
 * after the current token was issued, and lets the flags know.
 *
 * The comparison is in whole seconds, because that is all a token's issue time
 * has. A token minted a moment after the stamp, within the same second, would
 * read as older than it on every page load and be refreshed - and announced -
 * each time, for the hour until it expired. Counting only a later second as
 * newer means the one case that slips through is a token issued in the same
 * second as the claims changed but before them; that one catches up at its
 * hourly refresh, as every token did before this existed.
 *
 * A failure is logged and never retried. The one to expect is a session the
 * change ended: the script revokes the refresh tokens of anybody who loses a
 * privilege (`roleLosesClaims` in shared/roles.ts - a demotion, not the end
 * of a trial), and the owner may have revoked them or disabled the account by
 * other means. Then the forced refresh is refused and Firebase signs the user
 * out on the spot, which is what the revocation is for - but it happens
 * mid-page, seconds after the stamp, and on its own it looks like the site
 * dropping the session for no reason. So that one also raises
 * `claimsSignedOut`, for the layout to say why and that signing in again
 * brings what the account holds now. Anything else - a network failure, say -
 * leaves the session as it was, and the token catches up at its hourly
 * refresh.
 */
async function refreshIfClaimsChanged(
  user: User,
  changedAt: unknown,
): Promise<void> {
  const changedMs = timestampMillis(changedAt);
  if (changedMs === null) return;

  const key = `${user.uid}@${changedMs}`;
  if (handledClaimChanges.has(key)) return;
  // Before the first await: every caller's watcher fires for the same
  // snapshot, one after another, and only the first may get past here.
  handledClaimChanges.add(key);

  try {
    const { issuedAtTime } = await user.getIdTokenResult();
    const issuedSecond = Math.floor(Date.parse(issuedAtTime) / 1000);
    if (!(Math.floor(changedMs / 1000) > issuedSecond)) return;

    await user.getIdToken(true);
    claimsVersion.value++;
    claimsRefreshed.value = true;
  } catch (error) {
    console.warn("Could not refresh the token after a role change", error);
    if (SESSION_ENDED_CODES.has((error as { code?: unknown } | null)?.code)) {
      claimsSignedOut.value = true;
    }
  }
}

/** A Firestore Timestamp as the client SDK hands it over, in milliseconds;
 * null for anything else somebody may have written into their own document. */
function timestampMillis(value: unknown): number | null {
  const toMillis = (value as Partial<Timestamp> | null | undefined)?.toMillis;
  if (typeof toMillis !== "function") return null;
  const millis = toMillis.call(value);
  return Number.isFinite(millis) ? millis : null;
}

export function useAuthState() {
  const router = useRouter();
  // Named explicitly, like every other client call site (votes.ts, notes.ts,
  // useMyContributions.ts). `useFirestore()` is `getFirestore(app)` with no
  // database id, i.e. `(default)` - a database this project does not use, whose
  // rules are not deployed, and which the emulator plugin never connects. The
  // server reads this same document to decide whether to email somebody
  // (server/utils/notifications.ts), so a config written to the wrong database
  // is an opt-out that silently does nothing.
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  const user = useCurrentUser();
  /** The claims of the current token; undefined until it has been read, and
   * while nobody is signed in. Read once for every flag below rather than once
   * per flag. */
  const claims = computedAsync<ParsedToken | undefined>(async () => {
    // Both before the first await: only what is read synchronously is
    // tracked, and the counter is what makes a refreshed token count.
    void claimsVersion.value;
    const current = user.value;
    return current ? (await current.getIdTokenResult()).claims : undefined;
  });
  /** A flag off `claims`, undefined until they are known - some callers wait
   * for a definite answer (`isAdmin.value === undefined` in
   * pages/admin/rewizje). */
  const claimFlag = (read: (claims: ParsedToken) => boolean) =>
    computed(() => (claims.value ? read(claims.value) : undefined));

  const isAdmin = claimFlag((c) => !!c.admin);
  /** The site's owner, whose task list (/admin/zadania) no other admin sees. */
  const isOwner = claimFlag((c) => !!c.owner);
  const isDatascience = claimFlag((c) => !!c.datascience);
  /** An administrator on trial: `newAdmin` counts only together with `admin`,
   * as on the server (`isNewAdmin`, server/utils/contributors.ts). Every
   * administrator is exactly one of this and `isEstablishedAdmin`. */
  const isNewAdmin = claimFlag((c) => !!c.admin && !!c.newAdmin);
  /** An administrator not on trial - who the users page and the "Nowi
   * administratorzy" view are for. Off the token, so it decides what is shown;
   * the routes behind it ask the account itself (`requireEstablishedAdmin`),
   * because a token can be up to an hour behind it. */
  const isEstablishedAdmin = claimFlag((c) => !!c.admin && !c.newAdmin);
  const idToken = computed(() => user.value?.getIdToken());
  const auth = useFirebaseAuth()!;

  const userConfigRef = computed(() =>
    user.value ? doc(collection(db, "users"), user.value.uid) : null,
  );
  const userConfig = useDocument<UserConfig>(userConfigRef);

  // The claims script stamps the account after changing its claims, and the
  // document is already live here, so this is how an open tab learns about it
  // within seconds instead of at the next hourly refresh. Every caller watches;
  // `refreshIfClaimsChanged` lets one of them act per change. Client only: the
  // server renders with no token to refresh.
  if (import.meta.client) {
    countTokenChanges(auth);
    watch(
      () => [user.value, userConfig?.data?.value?.claimsChangedAt] as const,
      ([current, changedAt]) => {
        if (current && changedAt) {
          void refreshIfClaimsChanged(current, changedAt);
        }
      },
      { immediate: true },
    );
  }

  const logout = async () => {
    try {
      await signOut(auth);
      console.debug("User logged out successfully!");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const login = async (email: string, pass: string) => {
    return await signInWithEmailAndPassword(auth, email, pass);
  };

  const register = async (email: string, pass: string) => {
    return await createUserWithEmailAndPassword(auth, email, pass);
  };

  /** Sends the "set a new password" link to `email`.
   *
   * Firebase's email enumeration protection makes this succeed even for an
   * address with no account, so the caller must not report back whether the
   * address is known.
   */
  const resetPassword = async (email: string) => {
    return await sendPasswordResetEmail(auth, email);
  };

  return {
    user,
    isAdmin,
    isOwner,
    isDatascience,
    isNewAdmin,
    isEstablishedAdmin,
    claimsRefreshed,
    claimsSignedOut,
    idToken,
    userConfig,
    logout,
    login,
    register,
    resetPassword,
  };
}

/** Resolves once firebase has restored (or ruled out) the signed in user. */
async function waitForAuthReady() {
  const isAuthReady = useIsCurrentUserLoaded();
  if (isAuthReady.value) return;

  await new Promise<void>((resolve) => {
    const unwatch = watch(
      isAuthReady,
      (ready) => {
        if (ready) {
          unwatch();
          resolve(); // Release the pause!
        }
      },
      { immediate: true },
    );
  });
}

/** One off authenticated request, for event handlers such as form submits.
 *
 * Use this instead of `authFetch` for anything that is not setup time data
 * loading: `authFetch` wraps `useFetch`, which registers async data keyed by
 * the url. A second call for the same key aborts the first one, and the
 * caller of the aborted request is left awaiting a promise that never
 * settles, so a submit button would spin forever even though the request
 * itself went through.
 */
export async function authRequest<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    query?: unknown;
    /** `blob` for a route that answers with a file rather than JSON. */
    responseType?: "json" | "blob";
  } = {},
): Promise<T> {
  await waitForAuthReady();

  const user = useCurrentUser();
  const headers = new Headers();
  if (user.value) {
    headers.set("Authorization", `Bearer ${await user.value.getIdToken()}`);
  }

  return await $fetch<T>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
    headers,
    ...(options.responseType ? { responseType: options.responseType } : {}),
  });
}

/** The counterpart to `authRequest`: a request sent deliberately without
 * credentials, even when somebody is signed in.
 *
 * The only caller is the feedback form, when the reporter has cleared their
 * address to send anonymously. Going through here rather than reaching for
 * `$fetch` at the call site is what makes that promise checkable in one place:
 * there is no token to attach, so the server cannot attribute the report even
 * if it wanted to.
 */
export async function anonymousRequest<T>(
  url: string,
  options: { method?: string; body?: unknown; query?: unknown } = {},
): Promise<T> {
  return await $fetch<T>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
  });
}

export const authFetch = createUseFetch({
  onRequest: async function ({ options }) {
    if (import.meta.server) {
      return;
    }

    const user = useCurrentUser();
    await waitForAuthReady();

    if (user.value) {
      // TODO don't auto add latest here
      options.query = { ...options.query, latest: true };

      // Every method, GET included. It used to be writes only, which left a
      // reading route with no way to tell a signed-in caller from a crawler
      // except the `latest` flag above - and a flag is the caller's to set, so
      // it can say "I am signed in" without being. `/api/extractions` is the
      // route that needs the difference: unreviewed machine claims about named
      // people are served to a reader and withheld from everyone else, and
      // with no token to verify it withheld them from everybody.
      //
      // Safe to widen because of who reads it. The handlers that ask for the
      // caller at all - `getOptionalUser`, `getUser` - are every one of them
      // uncached `defineEventHandler`s, so a signed-in answer cannot be filled
      // into a shared cache entry; `authCachedEventHandler` caches but never
      // looks at the header (`eventIsAuthenticated` is stubbed to false); and
      // `readerAwareCachedEventHandler` exists precisely to resolve the reader
      // before the cache is consulted. No route rule caches /api either.
      const token = await user.value.getIdToken();
      const headers = new Headers(unref(options.headers) || {});
      headers.set("Authorization", `Bearer ${token}`);
      options.headers = headers;
    }
  },
});
