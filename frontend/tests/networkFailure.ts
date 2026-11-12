import { FirebaseError } from "firebase/app";

/** What a token refresh rejects with when Firebase cannot be reached: the
 * error Sentry had as KORYTA-PL-KW, K8, H1 and M7. */
export function networkRequestFailed() {
  return new FirebaseError(
    "auth/network-request-failed",
    "Firebase: Error (auth/network-request-failed).",
  );
}

/** Any other way a token read can fail, which has to reach Sentry as before. */
export function internalError() {
  return new FirebaseError(
    "auth/internal-error",
    "Firebase: Error (auth/internal-error).",
  );
}

let online = true;

/** Has the browser say it is offline, as a laptop just woken from sleep does
 * before its network is back. Shadows the prototype's `onLine` getter;
 * `restoreOnline` takes the shadow away again. */
export function goOffline() {
  online = false;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

/** Has the browser say it is online again, and tell the page so. */
export function backOnline() {
  online = true;
  window.dispatchEvent(new Event("online"));
}

/** Hands `onLine` back to the browser, for an `afterEach`. */
export function restoreOnline() {
  online = true;
  Reflect.deleteProperty(window.navigator, "onLine");
}
