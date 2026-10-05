import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import AdminPage from "../../../app/pages/admin/index.vue";

const { mockAuthRequest, claims } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  claims: { current: {} as Record<string, unknown> },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: {
      value: {
        uid: "me",
        getIdTokenResult: async () => ({ claims: claims.current }),
      },
    },
    isAdmin: { value: true },
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** The link, as a v-btn: under mountSuspended one with `to` renders no href,
 * so it is found by its label and read by its props. */
const newAdminsLink = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) =>
  wrapper
    .findAllComponents({ name: "VBtn" })
    .find((node) => node.text() === "Nowi administratorzy");

describe("/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Neither panel matters here, and a failed one is the page's own concern.
    mockAuthRequest.mockRejectedValue(new Error("not under test"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("links an established administrator to the trial administrators", async () => {
    claims.current = { admin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    expect(newAdminsLink(wrapper)?.props("to")).toBe(
      "/aktywnosc?kto=nowi-admini",
    );
  });

  it("does not link an administrator on trial to a filter they are refused", async () => {
    // The middleware lets them in on `admin` alone; /aktywnosc then ignored
    // the filter for them and said nothing, so the link was a dead end.
    claims.current = { admin: true, newAdmin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    expect(newAdminsLink(wrapper)).toBeUndefined();
  });
});
