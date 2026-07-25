import type { User } from "firebase/auth";

export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const idTokenResult = await user.getIdTokenResult();
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
