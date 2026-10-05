import type { User } from "firebase/auth";

/** Pages for an administrator who is not on trial - /admin/uzytkownicy, where
 * the accounts are listed and nominated. Narrower than `admin`, which lets a
 * trial administrator through: the users page shows every account's address
 * and activity, the trial administrators' own included, and the point of a
 * trial is that the established administrators watch it, not the other way
 * round.
 *
 * Off the token, like every page middleware, so it is a courtesy: it spares a
 * trial administrator a page whose every request would fail. The decision is
 * the server's, which reads the account itself (`requireEstablishedAdmin`),
 * since a token can carry claims an hour out of date. Pages list it after
 * `admin` - that name in the list is what lights the Admin menu - but it
 * refuses a non-administrator by itself as well, so it is never the weaker
 * gate if it ends up standing alone. */
export default defineNuxtRouteMiddleware(async () => {
  const user: User | null = await getCurrentUser();
  if (!user) return navigateTo("/login", { replace: true });
  const { claims } = await user.getIdTokenResult();
  if (!claims.admin || claims.newAdmin) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: "Brak uprawnień",
        message:
          "Ta strona jest dostępna tylko dla administratorów po okresie próbnym.",
      }),
    );
  }
});
