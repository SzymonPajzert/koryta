import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import AdminPage from "../../../app/pages/admin/index.vue";
import { networkRequestFailed } from "../../networkFailure";

const { mockAuthRequest, claims, getIdTokenResult } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  claims: { current: {} as Record<string, unknown> },
  getIdTokenResult: vi.fn(),
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: { value: { uid: "me", getIdTokenResult } },
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
    getIdTokenResult.mockImplementation(async () => ({
      claims: claims.current,
    }));
    // Neither panel matters here, and a failed one is the page's own concern.
    mockAuthRequest.mockRejectedValue(new Error("not under test"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  // Reading the claims refreshes an expired token first. Offline that failed
  // into `computedAsync`, which hands what it catches to `reportError`.
  it("leaves the link out, and reports nothing, when the token cannot be refreshed", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    getIdTokenResult.mockRejectedValue(networkRequestFailed());
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    expect(getIdTokenResult).toHaveBeenCalledTimes(2);
    expect(newAdminsLink(wrapper)).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("has a tile for the readings of the asset declarations", async () => {
    claims.current = { admin: true };
    const wrapper = await mountSuspended(AdminPage);
    await flushPromises();

    // A card with `to` renders no href under mountSuspended either: read its
    // props, by its title.
    const tile = wrapper
      .findAllComponents({ name: "VCard" })
      .find((card) => card.text().startsWith("Oświadczenia majątkowe"));
    expect(tile?.props("to")).toBe("/admin/oswiadczenia");
    expect(tile?.text()).toContain("Daty urodzenia odczytane z oświadczeń");
  });
});
