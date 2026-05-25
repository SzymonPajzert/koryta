import type { User } from "firebase/auth";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  let user: User | null = await getCurrentUser();

  if (!user) {
    const auth = useFirebaseAuth();
    if (auth?.currentUser) {
      user = auth.currentUser;
    } else {
      // Double fallback to NuxtApp $auth if available
      const { $auth } = useNuxtApp();
      const nuxtAuth = $auth as { currentUser?: User } | undefined;
      if (nuxtAuth?.currentUser) {
        user = nuxtAuth.currentUser;
      }
    }
  }

  if (!user) {
    return navigateTo({
      path: "/login",
      query: {
        redirect: to.fullPath,
        reason: "unauthorized",
      },
    });
  }
});
