import type { User } from "firebase/auth";
import {
  abortWithoutNetwork,
  idTokenResultIfReachable,
} from "~/utils/tokenRefresh";

/** Pages for the site's owner alone - his task list. Narrower than `admin`:
 * the other administrators get the same refusal as anybody signed in. */
export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const idTokenResult = await idTokenResultIfReachable(user);
  // No network to refresh the token with, even after waiting for one.
  if (!idTokenResult) return abortWithoutNetwork();
  if (!idTokenResult.claims.owner) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: "Brak uprawnień",
        message: "Ta strona jest dostępna tylko dla właściciela serwisu.",
      }),
    );
  }
});
