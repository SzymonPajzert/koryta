import type { User } from "firebase/auth";

export default defineNuxtRouteMiddleware(async (to) => {
  const user: User = await getCurrentUser();
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
