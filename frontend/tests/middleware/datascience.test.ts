import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import datascience from "../../app/middleware/datascience";

const { getCurrentUser, abortNavigation, navigateTo } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  // Handed back rather than thrown, so a test can read what was refused.
  abortNavigation: vi.fn((error: unknown) => error),
  navigateTo: vi.fn((to: unknown) => ({ to })),
}));
mockNuxtImport("getCurrentUser", () => getCurrentUser);
mockNuxtImport("abortNavigation", () => abortNavigation);
mockNuxtImport("navigateTo", () => navigateTo);

const signedIn = (claims: Record<string, unknown>) => ({
  getIdTokenResult: async () => ({ claims }),
});

const run = () => (datascience as unknown as () => Promise<unknown>)();

/** /admin/procesy's gate. It has to agree with `requireDatascience`, which
 * `/api/ops/jobs` answers through: the page used to keep `admin` and `owner`
 * after the route had moved to the claim, so the group was refused at the
 * door of a page whose data it could read. */
describe("datascience middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["alone", { datascience: true }],
    ["as an administrator", { datascience: true, admin: true }],
  ])("lets somebody in the group in, %s", async (_, claims) => {
    getCurrentUser.mockResolvedValue(signedIn(claims));
    expect(await run()).toBeUndefined();
    expect(abortNavigation).not.toHaveBeenCalled();
  });

  it("refuses an administrator outside the group, owner or not", async () => {
    getCurrentUser.mockResolvedValue(signedIn({ admin: true, owner: true }));
    expect(await run()).toMatchObject({ statusCode: 403 });
  });

  it("sends a signed-out reader to log in", async () => {
    getCurrentUser.mockResolvedValue(null);
    await run();
    expect(navigateTo).toHaveBeenCalledWith("/login", { replace: true });
    expect(abortNavigation).not.toHaveBeenCalled();
  });
});
