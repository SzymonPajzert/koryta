import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import type { RouteLocationNormalized } from "vue-router";
import establishedAdmin from "~/middleware/established-admin";

/** The gate on /admin/uzytkownicy: an administrator who is not on trial.
 *
 * Read off the token, as every page middleware is, so it is the courtesy that
 * saves somebody a page of 403s; the routes behind the page ask the account
 * itself (`requireEstablishedAdmin`). */

const { signedIn } = vi.hoisted(() => ({
  signedIn: { claims: null as Record<string, unknown> | null },
}));

mockNuxtImport(
  "getCurrentUser",
  () => async () =>
    signedIn.claims === null
      ? null
      : { getIdTokenResult: async () => ({ claims: signedIn.claims }) },
);
mockNuxtImport("navigateTo", () => (to: string, options: unknown) => ({
  redirectedTo: to,
  options,
}));
mockNuxtImport("abortNavigation", () => (error: unknown) => ({
  aborted: error,
}));

const route = {} as RouteLocationNormalized;
const run = () => establishedAdmin(route, route);

describe("established-admin middleware", () => {
  beforeEach(() => {
    signedIn.claims = null;
  });

  it("sends somebody signed out to the login page", async () => {
    expect(await run()).toEqual({
      redirectedTo: "/login",
      options: { replace: true },
    });
  });

  it("lets an established administrator in", async () => {
    signedIn.claims = { admin: true, datascience: true, trusted: true };

    expect(await run()).toBeUndefined();
  });

  it("refuses an administrator on trial", async () => {
    signedIn.claims = { admin: true, newAdmin: true };

    expect(await run()).toEqual({
      aborted: expect.objectContaining({
        statusCode: 403,
        message:
          "Ta strona jest dostępna tylko dla administratorów po okresie próbnym.",
      }),
    });
  });

  it.each([
    ["a reader", {}],
    ["the team", { datascience: true, trusted: true }],
    ["a stray trial flag", { newAdmin: true }],
  ])(
    "refuses %s on its own, without the admin gate before it",
    async (_, claims) => {
      // Pages list ["admin", "established-admin"], but this one must not let
      // anybody through if it ever stands alone.
      signedIn.claims = claims;

      expect(await run()).toEqual({
        aborted: expect.objectContaining({ statusCode: 403 }),
      });
    },
  );
});
