import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import { useCurrentUser } from "vuefire";
import RozszerzeniePage from "../../app/pages/rozszerzenie.vue";
import { authRequest, useAuthState } from "~/composables/auth";
import type { OwnAccessRequest } from "~~/shared/userAdmin";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
}));

/** The browser's user, holding a token with `claims` - and, once forced to
 * refresh, one with `refreshed`, as a promotion the script made after the
 * first token was issued would. */
function signedInWith(
  claims: Record<string, unknown>,
  refreshed: Record<string, unknown> = claims,
) {
  const getIdTokenResult = vi.fn(async (force?: boolean) => ({
    claims: force ? refreshed : claims,
    token: "token",
    expirationTime: "2026-10-05T13:00:00.000Z",
  }));
  const user = ref({
    uid: "user-1",
    email: "jan@example.com",
    emailVerified: true,
    getIdTokenResult,
  });
  vi.mocked(useCurrentUser).mockReturnValue(user as never);
  vi.mocked(useAuthState).mockReturnValue({ user } as never);
  return getIdTokenResult;
}

let own: OwnAccessRequest;

const mount = async () => {
  const wrapper = await mountSuspended(RozszerzeniePage);
  await flushPromises();
  await flushPromises();
  return wrapper;
};

describe("/rozszerzenie without the team's claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    own = {
      request: null,
      canRequest: true,
      retryAfter: null,
      hasAccess: false,
    };
    vi.mocked(authRequest).mockImplementation((async () => own) as never);
  });

  it("offers the request where it says the permission is missing", async () => {
    signedInWith({});

    const wrapper = await mount();

    const warning = wrapper.get(".v-alert");
    expect(warning.text()).toContain("nie ma jeszcze uprawnień");
    expect(warning.text()).not.toContain("Napisz do nas");
    expect(warning.get("button").text()).toContain("Poproś o dostęp");
  });

  it("asks nothing of somebody who holds the claim", async () => {
    signedInWith({ datascience: true });

    const wrapper = await mount();

    expect(wrapper.text()).toContain("Połącz rozszerzenie");
    expect(wrapper.text()).not.toContain("Poproś o dostęp");
    expect(authRequest).not.toHaveBeenCalled();
  });

  it("fetches a token with the claim when the account already has it", async () => {
    // Granted after this browser's token was issued: the account says yes,
    // the token still says no.
    const getIdTokenResult = signedInWith({}, { datascience: true });
    own = { ...own, canRequest: false, hasAccess: true };

    const wrapper = await mount();

    expect(getIdTokenResult).toHaveBeenCalledWith(true);
    expect(wrapper.text()).not.toContain("nie ma jeszcze uprawnień");
    expect(wrapper.text()).toContain("Połącz rozszerzenie");
  });
});
