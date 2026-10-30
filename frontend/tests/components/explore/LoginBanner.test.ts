import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import LoginBanner from "../../../app/components/explore/LoginBanner.vue";
import {
  AA_LARGE_TEXT,
  AA_TEXT,
  contrastRatio,
  ink,
  surface,
} from "../../../shared/colors";

/** Vuetify's tonal variant lays the alert's own colour under it at
 * `--v-activated-opacity`, 0.12 in the light theme, and paints the text in
 * that same colour. So the pair a reader actually sees is the colour on
 * itself-over-white, which is what this composites. */
const TONAL_UNDERLAY_OPACITY = 0.12;

const overWhite = (colour: string, alpha: number) => {
  const channels = [1, 3, 5].map(
    (start) =>
      parseInt(colour.slice(start, start + 2), 16) * alpha + 255 * (1 - alpha),
  );
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
};

/** The blue Vuetify paints for `type="info"` when no `color` is given. */
const VUETIFY_INFO = "#2196f3";

describe("ExploreLoginBanner", () => {
  it("paints the alert in the palette's info ink, not Vuetify's own blue", async () => {
    const wrapper = await mountSuspended(LoginBanner, {
      props: { hiddenCount: 3 },
    });

    const alert = wrapper.find(".v-alert");
    expect(alert.exists()).toBe(true);
    expect(alert.classes()).toContain("text-ink-info");
    // `type="info"` is still there: it is what puts the alert in the info
    // register for a screen reader, and only the colour was ever the problem.
    expect(alert.classes()).toContain("v-alert--variant-tonal");
  });

  /** The measurement the swap answers. The body text, the bold count inside it
   * and the icon are all painted in the alert's colour, so one ratio covers
   * all three - and the icon's bar is the 3:1 of a meaningful graphic. */
  it("clears AA on the wash the tonal variant lays under it", async () => {
    const background = overWhite(ink.info, TONAL_UNDERLAY_OPACITY);

    expect(contrastRatio(ink.info, background)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(ink.info, background)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT,
    );

    // What it was: Vuetify's info blue on its own wash, which is the 2.74:1
    // the review measured. Pinned so a `color`-less `type="info"` cannot come
    // back looking like an improvement.
    expect(
      contrastRatio(
        VUETIFY_INFO,
        overWhite(VUETIFY_INFO, TONAL_UNDERLAY_OPACITY),
      ),
    ).toBeLessThan(AA_LARGE_TEXT);
  });

  it("still counts the hidden people in Polish", async () => {
    const wrapper = await mountSuspended(LoginBanner, {
      props: { hiddenCount: 3 },
    });

    expect(wrapper.text()).toContain("3 dodatkowe osoby");
    expect(wrapper.text()).toContain("Zaloguj się");
  });

  it("says nothing about extra people when there are none", async () => {
    const wrapper = await mountSuspended(LoginBanner);

    expect(wrapper.text()).not.toContain("W tym widoku");
  });

  /** The surface the banner sits on is the page, so this is the pair that
   * matters if anybody ever drops the tonal variant. */
  it("keeps the ink readable on plain white too", () => {
    expect(contrastRatio(ink.info, surface.white)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});

describe("ExploreLoginBanner's buttons", () => {
  const byTestId = (
    wrapper: Awaited<ReturnType<typeof mountSuspended>>,
    testid: string,
  ) =>
    wrapper
      .findAllComponents({ name: "VBtn" })
      .find((btn) => btn.attributes("data-testid") === testid);

  it("offers one way in, to a bare /login, unless told otherwise", async () => {
    // What every banner over a list has always had.
    const wrapper = await mountSuspended(LoginBanner);

    expect(byTestId(wrapper, "login-banner-login")?.props("to")).toBe("/login");
    expect(byTestId(wrapper, "login-banner-signup")).toBeUndefined();
  });

  it("adds „Rejestracja” where a caller gives it somewhere to go", async () => {
    const wrapper = await mountSuspended(LoginBanner, {
      props: {
        to: { path: "/login", query: { redirect: "/osoba/x-1" } },
        signupTo: { path: "/login", query: { konto: "nowe" } },
      },
    });

    expect(byTestId(wrapper, "login-banner-login")?.props("to")).toEqual({
      path: "/login",
      query: { redirect: "/osoba/x-1" },
    });
    const signup = byTestId(wrapper, "login-banner-signup");
    expect(signup?.props("to")).toEqual({
      path: "/login",
      query: { konto: "nowe" },
    });
    expect(signup?.text()).toBe("Rejestracja");

    await wrapper.get('[data-testid="login-banner-signup"]').trigger("click");
    await wrapper.get('[data-testid="login-banner-login"]').trigger("click");
    expect(wrapper.emitted("signup")).toHaveLength(1);
    expect(wrapper.emitted("login")).toHaveLength(1);
  });

  // /oswiadczenia signs the reader in in a dialog of its own: leaving the
  // page would take with it what the reader typed on it.
  it("draws both as buttons that lead nowhere and only say they were clicked, for a page that signs the reader in itself", async () => {
    const wrapper = await mountSuspended(LoginBanner, {
      props: { inPlace: true },
    });

    for (const testid of ["login-banner-login", "login-banner-signup"]) {
      expect(byTestId(wrapper, testid)?.props("to")).toBeUndefined();
      expect(
        wrapper.get(`[data-testid="${testid}"]`).element.tagName,
        testid,
      ).toBe("BUTTON");
    }
    expect(byTestId(wrapper, "login-banner-signup")?.text()).toBe(
      "Rejestracja",
    );
    // Side by side, as the pair always is.
    expect(wrapper.find(".login-banner__pair").exists()).toBe(true);

    await wrapper.get('[data-testid="login-banner-signup"]').trigger("click");
    await wrapper.get('[data-testid="login-banner-login"]').trigger("click");
    expect(wrapper.emitted("signup")).toHaveLength(1);
    expect(wrapper.emitted("login")).toHaveLength(1);
  });

  it("says what the caller puts in it instead of the default", async () => {
    const wrapper = await mountSuspended(LoginBanner, {
      props: { hiddenCount: 3 },
      slots: { default: () => "Widzisz tylko fragment tego profilu" },
    });

    expect(wrapper.text()).toContain("Widzisz tylko fragment tego profilu");
    expect(wrapper.text()).not.toContain("nieopublikowanych");
  });
});
