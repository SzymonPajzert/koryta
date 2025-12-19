import type { User } from "firebase/auth";

export default defineNuxtRouteMiddleware(async (to) => {
  console.log('Auth Middleware running for:', to.path);
  let user: User | null = await getCurrentUser();
  console.log('CurrentUser in Middleware (async):', user ? user.uid : 'null');

  if (!user && import.meta.client) {
      const auth = useFirebaseAuth();
      if (auth?.currentUser) {
          user = auth.currentUser;
      } else {
          // Double fallback to NuxtApp $auth if available
          const { $auth } = useNuxtApp();
          const nuxtAuth = $auth as any;
          if (nuxtAuth?.currentUser) {
              user = nuxtAuth.currentUser;
          }
      }
  }

  if (!user) {
    console.log('Redirecting to login from middleware');
    return navigateTo({
      path: "/login",
      query: {
        redirect: to.fullPath,
        reason: "unauthorized",
      },
    });
  }
});
