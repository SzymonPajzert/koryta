import type { AuthErrorCodes, IdTokenResult, User } from "firebase/auth";

/** Firebase's code for a request to its servers that got no answer at all:
 * the device is offline, or the request ran out of time.
 *
 * Written out rather than read off `AuthErrorCodes` when the code runs: the
 * tests that mock `firebase/auth` hand back a module without it. The type
 * still fails the build if Firebase ever spells it differently. */
const NETWORK_REQUEST_FAILED: (typeof AuthErrorCodes)["NETWORK_REQUEST_FAILED"] =
  "auth/network-request-failed";

/** Whether `error` is Firebase failing to reach its servers, as opposed to an
 * answer it got and did not like. */
export function isNetworkRequestFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === NETWORK_REQUEST_FAILED
  );
}

/** Resolves once the browser says it is online: at once if it already does,
 * and on the server, which has no `onLine` to ask. */
function whenOnline(): Promise<void> {
  if (typeof window === "undefined" || window.navigator.onLine !== false) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.addEventListener("online", () => resolve(), { once: true });
  });
}

/** Runs `read` - anything that may have to refresh the reader's ID token -
 * and, when the refresh could not reach Firebase, runs it once more as soon
 * as the browser is back online.
 *
 * The token lasts an hour, so a laptop opened after a night holds a stale
 * one, and whatever reads it first asks Firebase for another while the
 * network is still coming back. That failed with
 * `auth/network-request-failed`, and every reader that passed it on put it in
 * Sentry: KORYTA-PL-KW (23 events in 20 seconds on /aktywnosc), K8 (/profil),
 * H1 and M7. Waiting for the browser to be online again makes it a delay
 * instead. A browser that says it is online already gets its second try at
 * once.
 *
 * Every other error, and a second failure, reach the caller as before. */
export async function retryOnceOnline<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isNetworkRequestFailed(error)) throw error;
    await whenOnline();
    return await read();
  }
}

/** The reader's ID token for a request. Offline, the request could not have
 * gone out either; it goes once the browser is back online. */
export function idTokenWhenOnline(user: User): Promise<string> {
  return retryOnceOnline(() => user.getIdToken());
}

/** The reader's token and its claims, or `null` when Firebase could not be
 * reached to refresh the token, even on the second try.
 *
 * For the places that read a claim only to decide what to show or whom to
 * let in, and have nothing to do with the failure but pass it on:
 * `computedAsync` hands an error to `reportError`, an error in a route guard
 * fails the navigation, and Sentry hears of both. Claims that could not be
 * read count as none, the same as before they were read. */
export async function idTokenResultIfReachable(
  user: User,
): Promise<IdTokenResult | null> {
  try {
    return await retryOnceOnline(() => user.getIdTokenResult());
  } catch (error) {
    if (isNetworkRequestFailed(error)) return null;
    throw error;
  }
}

/** The `.catch` for a token promise nothing awaits: lets a network failure
 * go, where it would have been reported as an unhandled rejection, and
 * throws anything else on, so that it still is. */
export function ignoreNetworkFailure(error: unknown): void {
  if (!isNetworkRequestFailed(error)) throw error;
}
