import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import PomocPage from "../../app/pages/pomoc.vue";
import { authRequest, useAuthState } from "~/composables/auth";
import type { OwnAccessRequest } from "~~/shared/userAdmin";

/** The „dla zespołu” door on /pomoc, which used to end in "O dostęp poproś
 * mailem albo na Slacku" - a request nobody could see had been made. The rest
 * of the page is tests/pages/pomoc.test.ts. */

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
}));

vi.mock("~/composables/analytics", () => ({
  trackGoal: vi.fn(),
  setGlobalProp: vi.fn(),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

global.visualViewport = {
  width: 1000,
  height: 1000,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as never;

registerEndpoint("/api/stats/queueTiers", () => ({ tiers: [] }));
registerEndpoint("/api/stats/progress", () => ({
  total: 100,
  approved: 40,
  reviewed: 30,
  toCheck: 30,
}));

let own: OwnAccessRequest;

const mount = async () => {
  const wrapper = await mountSuspended(PomocPage);
  await flushPromises();
  return wrapper;
};

const requestCard = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper
    .get("section#zespol")
    .findAllComponents({ name: "CardAction" })
    .find((card) => card.props("title") === "Poproś o dostęp do narzędzi");

describe("/pomoc: asking for the team's tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    own = {
      request: null,
      canRequest: true,
      retryAfter: null,
      hasAccess: false,
    };
    vi.mocked(useAuthState).mockReturnValue({ user: ref(null) } as never);
    vi.mocked(authRequest).mockImplementation((async () => own) as never);
  });

  it("no longer sends the reader to mail or Slack for it", async () => {
    const wrapper = await mount();

    expect(wrapper.get("section#zespol").text()).not.toContain(
      "poproś mailem albo na Slacku",
    );
  });

  it("puts the request in a card of its own, which says it needs an account", async () => {
    const wrapper = await mount();

    const card = requestCard(wrapper);
    expect(card).toBeDefined();
    // Not a link: the tools card next to it is one, and a button inside a
    // link would follow it too.
    expect(card!.props("to")).toBeUndefined();
    expect(card!.props("href")).toBeUndefined();
    expect(card!.find(".v-chip").text()).toBe("po zalogowaniu");
  });

  it("asks a signed-out reader to sign in first", async () => {
    const wrapper = await mount();

    await requestCard(wrapper)!.trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain(
      "Nie masz konta? Zarejestruj się",
    );
    expect(authRequest).not.toHaveBeenCalled();
  });

  it("says where a request stands, in place of the invitation", async () => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref({ uid: "user-1", emailVerified: true }),
    } as never);
    own = {
      request: {
        status: "open",
        createdAt: "2026-10-05T10:00:00.000Z",
        source: "pomoc",
      },
      canRequest: false,
      retryAfter: null,
      hasAccess: false,
    };

    const wrapper = await mount();

    expect(requestCard(wrapper)!.text()).toContain(
      "Prośba wysłana 5 października 2026",
    );
    expect(authRequest).toHaveBeenCalledWith("/api/users/access-request", {
      method: "GET",
    });
  });
});
