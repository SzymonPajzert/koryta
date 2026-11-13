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

/** How long a request with no timeout of its own waits for the browser to be
 * back online before it fails the way it did before it waited at all. A
 * laptop woken from sleep is back on its network within seconds; past this
 * the reader is better served by the page saying the request failed than by
 * a spinner. */
export const NETWORK_WAIT_MS = 10_000;

/** Resolves `true` once the browser says it is online: at once if it already
 * does, and on the server, which has no `onLine` to ask. With `waitAtMost`,
 * resolves `false` if the browser still says offline after that many
 * milliseconds. */
function whenOnline(waitAtMost?: number): Promise<boolean> {
  if (typeof window === "undefined" || window.navigator.onLine !== false) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer =
      waitAtMost === undefined
        ? undefined
        : setTimeout(() => {
            window.removeEventListener("online", online);
            resolve(false);
          }, waitAtMost);
    function online() {
      clearTimeout(timer);
      resolve(true);
    }
    window.addEventListener("online", online, { once: true });
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
 * With `waitAtMost`, the wait ends there: a browser still offline after that
 * many milliseconds gets the first failure, as it did before there was a
 * wait. Every other error, and a second failure, reach the caller as
 * before. */
export async function retryOnceOnline<T>(
  read: () => Promise<T>,
  waitAtMost?: number,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isNetworkRequestFailed(error)) throw error;
    if (!(await whenOnline(waitAtMost))) throw error;
    return await read();
  }
}

/** The reader's ID token for a request. Offline, the request could not have
 * gone out either; it goes once the browser is back online, if that is
 * within `waitAtMost` - the request's own timeout, where it has one. If it is
 * not, the token read fails as it did before there was a wait, and whoever
 * shows the request's failure still does. */
export function idTokenWhenOnline(
  user: User,
  waitAtMost: number = NETWORK_WAIT_MS,
): Promise<string> {
  return retryOnceOnline(() => user.getIdToken(), waitAtMost);
}

/** The reader's token and its claims, or `null` when Firebase could not be
 * reached to refresh the token, even on the second try.
 *
 * For the places that read a claim only to decide what to show or whom to
 * let in, and have nothing to do with the failure but pass it on:
 * `computedAsync` hands an error to `reportError`, an error in a route guard
 * fails the navigation, and Sentry hears of both. Claims that could not be
 * read count as none, the same as before they were read.
 *
 * Unlike a request's token, it waits for the network with no limit: there is
 * no failure here to show in time, only claims to read once they can be. */
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

/** The status of the error page for a page that could not be opened for want
 * of a network: 408, a request that got no answer in time. Not a 5xx:
 * Sentry records every one the app shows, and a reader offline is nothing to
 * fix. app/error.vue says what it means. */
export const NO_CONNECTION_STATUS = 408;

/** What a guard returns when `idTokenResultIfReachable` could not read the
 * reader's claims: the navigation stops without an error, and the reader
 * stays where they are, as after a link that went nowhere. A guard that
 * failed the navigation instead is how KORYTA-PL-M7 reached Sentry.
 *
 * On the page's first load there is nowhere to stay. The /admin pages are
 * not rendered on the server (`routeRules`), and Nuxt's router answers a
 * guard that stops their first navigation with a 404, "Page Not Found", which
 * would tell an administrator that their page does not exist. There the
 * error page says there is no connection instead: Nuxt shows the first error
 * it is given, and the 404 comes second. */
export function abortWithoutNetwork() {
  if (useNuxtApp().isHydrating) {
    // In `message`, not `statusMessage`: h3 warns of a status line with
    // letters outside ASCII, and app/error.vue words the page itself.
    showError({
      statusCode: NO_CONNECTION_STATUS,
      message:
        "Brak połączenia z siecią: nie udało się odświeżyć tokenu logowania (auth/network-request-failed).",
    });
  }
  return abortNavigation();
}

/** The `.catch` for a token promise nothing awaits: lets a network failure
 * go, where it would have been reported as an unhandled rejection, and
 * throws anything else on, so that it still is. */
export function ignoreNetworkFailure(error: unknown): void {
  if (!isNetworkRequestFailed(error)) throw error;
}
