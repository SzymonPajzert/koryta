import type { User } from "firebase/auth";

/** Pages for the datascience group - the jobs' progress, /admin/procesy.
 * Neither wider nor narrower than `admin`, but beside it: the group takes in
 * people who are not administrators, and an administrator without the claim
 * would get a page whose route (`/api/ops/jobs`) answers 403. */
export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const idTokenResult = await user.getIdTokenResult();
  if (!idTokenResult.claims.datascience) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: "Brak uprawnień",
        message: "Ta strona jest dostępna tylko dla zespołu danych.",
      }),
    );
  }
});
