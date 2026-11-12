import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import admin from "../../app/middleware/admin";
import owner from "../../app/middleware/owner";
import datascience from "../../app/middleware/datascience";
import {
  backOnline,
  goOffline,
  internalError,
  networkRequestFailed,
  restoreOnline,
} from "../networkFailure";

const { getCurrentUser, abortNavigation, navigateTo } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  // As Nuxt's own: `false` for a navigation stopped without an error, the
  // error handed back (rather than thrown) for one refused.
  abortNavigation: vi.fn((error?: unknown) => error ?? false),
  navigateTo: vi.fn((to: unknown) => ({ to })),
}));
mockNuxtImport("getCurrentUser", () => getCurrentUser);
mockNuxtImport("abortNavigation", () => abortNavigation);
mockNuxtImport("navigateTo", () => navigateTo);

/** Somebody signed in whose token reads go as `results` say, in turn. */
const signedIn = (...results: Array<() => Promise<unknown>>) => {
  const getIdTokenResult = vi.fn();
  for (const result of results) getIdTokenResult.mockImplementationOnce(result);
  return { getIdTokenResult };
};

/** Every claim the three guards look for. */
const ALL_CLAIMS = { claims: { admin: true, owner: true, datascience: true } };

/** The three guards that read a claim off the token. A click on a link to
 * one of their pages, made while the token needed a refresh and there was
 * no network for it, failed the navigation into Sentry (KORYTA-PL-M7). */
describe.each([
  ["admin", admin],
  ["owner", owner],
  ["datascience", datascience],
])("%s middleware without a network", (_, middleware) => {
  const run = () => (middleware as unknown as () => Promise<unknown>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(restoreOnline);

  it("waits for the browser to be back online, then lets the reader in", async () => {
    goOffline();
    getCurrentUser.mockResolvedValue(
      signedIn(
        () => Promise.reject(networkRequestFailed()),
        async () => ALL_CLAIMS,
      ),
    );

    let outcome: unknown = "pending";
    const navigation = run().then((result) => (outcome = result));
    await flushPromises();
    expect(outcome).toBe("pending");

    backOnline();
    await navigation;
    expect(outcome).toBeUndefined();
    expect(abortNavigation).not.toHaveBeenCalled();
  });

  it("stops the navigation without an error when Firebase still cannot be reached", async () => {
    getCurrentUser.mockResolvedValue(
      signedIn(
        () => Promise.reject(networkRequestFailed()),
        () => Promise.reject(networkRequestFailed()),
      ),
    );

    await expect(run()).resolves.toBe(false);
    expect(abortNavigation).toHaveBeenCalledExactlyOnceWith();
  });

  it("still fails the navigation on any other error", async () => {
    getCurrentUser.mockResolvedValue(
      signedIn(() => Promise.reject(internalError())),
    );

    await expect(run()).rejects.toMatchObject({ code: "auth/internal-error" });
  });
});
