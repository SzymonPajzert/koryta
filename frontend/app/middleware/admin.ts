import type { User } from "firebase/auth";
import { idTokenResultIfReachable } from "~/utils/tokenRefresh";

export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const idTokenResult = await idTokenResultIfReachable(user);
  // No network to refresh the token with, even after waiting for one: the
  // reader stays where they are, as after a link that went nowhere. A guard
  // that failed the navigation instead is how KORYTA-PL-M7 reached Sentry.
  if (!idTokenResult) return abortNavigation();
  if (!idTokenResult.claims.admin) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: "Brak uprawnień",
        message: "Ta strona jest dostępna tylko dla administratorów.",
      }),
    );
  }
});
