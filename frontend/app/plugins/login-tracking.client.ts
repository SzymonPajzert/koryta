/** Counts a sign-in as it happens, wherever it happens: /login's form, its
 * Google button, the sign-in dialog some pages open in place.
 *
 * Off the auth state rather than off any of those forms, so none of them has
 * to remember to report, and a rewrite of /login cannot quietly stop the
 * count. vuefire's current user is `undefined` until Firebase has restored or
 * ruled out a session, then `null` or the user; so a user appearing where
 * there was `null` is somebody signing in, and one appearing where there was
 * `undefined` is a session restored on page load, which is not.
 */

import type { User } from "firebase/auth";
import { useCurrentUser } from "vuefire";
import { trackGoal } from "~/composables/analytics";
import { loginReason } from "~~/shared/analytics";
import { signInMode } from "~/utils/signInMode";

export default defineNuxtPlugin(() => {
  const router = useRouter();
  const user = useCurrentUser();

  watch(user, (current: User | null | undefined, previous) => {
    if (!current || previous !== null) return;
    const route = router.currentRoute.value;
    trackGoal("login:success", {
      mode: signInMode(current.metadata),
      // The reason the link to /login gave. A dialog opened on a page gives
      // none.
      from: route.path.startsWith("/login")
        ? loginReason(route.query.powod)
        : "inne",
    });
  });
});
