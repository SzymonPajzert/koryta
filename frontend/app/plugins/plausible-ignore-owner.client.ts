/** Keeps the site owner's own visits out of Plausible.
 *
 * The tracker sends nothing, pageview or goal, while the browser's
 * `localStorage.plausible_ignore` is the string "true": `track()` checks it
 * before every event (@plausible-analytics/tracker 0.4.5, plausible.js; its
 * README documents it under "Opt out and exclude yourself"). Nothing set it,
 * so Szymon's admin rounds and QA were counted as readers, and his clicks as
 * conversions.
 *
 * Set once his token shows the `owner` claim, the one `useAuthState().isOwner`
 * reads, and never cleared, sign-out included: the QA he does signed out, to
 * see what a reader sees, is still his visit. It lasts until that browser's
 * site data is cleared, and only on the origin it was set on, so each browser
 * he checks koryta.pl from needs one sign-in there. The page load that first
 * sets it has already sent its pageview; nothing after that is sent.
 *
 * The claim is read off vuefire's user, as login-tracking.client.ts does,
 * rather than through `useAuthState()`, which also builds a reference to the
 * user's config document and listens to it. A plugin runs in every unit test
 * file's app boot, and calling it there failed three files' boot and 14 of
 * their tests: one mocks `~/composables/auth` without `useAuthState`, two mock
 * Firestore in a way that cannot build that reference.
 */

import type { User } from "firebase/auth";
import { useCurrentUser } from "vuefire";

async function ignoreIfOwner(user: User): Promise<void> {
  try {
    const { claims } = await user.getIdTokenResult();
    if (claims.owner) localStorage.setItem("plausible_ignore", "true");
  } catch {
    // The token could not be read (a refresh while offline), or the browser
    // refuses this site storage (site data blocked, a full quota). This visit
    // is then counted, as every visit was before, and the next page load tries
    // again.
  }
}

export default defineNuxtPlugin(() => {
  const user = useCurrentUser();

  // `immediate`, unlike login-tracking, which counts sign-ins and so wants
  // only the change: here a session restored on load is the usual case, and it
  // has to be caught however late this plugin runs against Firebase restoring
  // it.
  watch(
    user,
    (current: User | null | undefined) => {
      if (current) void ignoreIfOwner(current);
    },
    { immediate: true },
  );
});
