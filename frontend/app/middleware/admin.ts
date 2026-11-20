import type { User } from "firebase/auth";
import {
  abortWithoutNetwork,
  idTokenResultIfReachable,
} from "~/utils/tokenRefresh";

export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const idTokenResult = await idTokenResultIfReachable(user);
  // No network to refresh the token with, even after waiting for one.
  if (!idTokenResult) return abortWithoutNetwork();
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
