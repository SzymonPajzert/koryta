import { useCurrentUser } from "vuefire";
import { authRequest } from "~/composables/auth";

/** Tells the server, once a day, that the signed-in user has the site open -
 * which is how `userStats/{uid}` learns about active days and sign-ins
 * (server/api/users/seen.post.ts says what is kept, and why).
 *
 * Once a day and once per sign-in, decided here rather than on the server, so
 * that a reader clicking through forty pages costs one request and one write
 * instead of forty. The browser remembers the last thing it reported per
 * account, as `<UTC day>|<auth time>`: either half changing is something the
 * record has not heard yet - a new day, or a new sign-in on this browser.
 *
 * Nothing waits on this and nothing can fail because of it. It never touches
 * what is on the screen, so a request that fails is simply tried again the
 * next time the tab comes back into view.
 */

const storageKey = (uid: string) => `koryta:seen:${uid}`;

export default defineNuxtPlugin(() => {
  const user = useCurrentUser();

  /** What this page reported but could not store, for a browser that refuses
   * localStorage (a locked-down profile, some private modes): there, one
   * request per page load rather than one per tab switch. */
  const reportedHere = new Map<string, string>();
  /** The report in flight, so a tab coming into view while the first check of
   * the page is still out does not send the same thing twice. */
  let sending: string | null = null;

  const alreadyReported = (key: string, value: string) => {
    if (reportedHere.get(key) === value) return true;
    try {
      return localStorage.getItem(key) === value;
    } catch {
      return false;
    }
  };

  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      reportedHere.set(key, value);
    }
  };

  async function check() {
    try {
      const current = user.value;
      // Null when signed out, undefined while Firebase is still restoring the
      // session - there is nobody to report either way. A user here means the
      // restore is over.
      if (!current) return;

      const { authTime } = await current.getIdTokenResult();
      const key = storageKey(current.uid);
      const value = `${new Date().toISOString().slice(0, 10)}|${authTime}`;
      if (alreadyReported(key, value) || sending === `${key}=${value}`) return;

      sending = `${key}=${value}`;
      try {
        await authRequest("/api/users/seen", { method: "POST" });
        // Only after it went through: a day the server never heard about is
        // reported again on the next check rather than lost.
        remember(key, value);
      } finally {
        sending = null;
      }
    } catch (error) {
      // Offline, a token that would not refresh, a deploy in progress. None of
      // it is the reader's problem, and the next check will try again.
      console.debug("[signInStats] could not report the visit", error);
    }
  }

  // On sign-in, on a restored session and on switching accounts. The `User`
  // object is replaced on each of those and only on those - a token refresh
  // keeps it - so this does not fire per refresh.
  watch(user, () => void check(), { immediate: true });

  // A tab left open past midnight never signs in again and never reloads, so
  // without this the next day would only be counted once it did.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
});
