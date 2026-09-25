import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import LoginForm from "../../../app/components/form/LoginForm.vue";

const {
  trackGoal,
  sendVerificationEmail,
  authRegister,
  authLogin,
  signInWithPopup,
  getAdditionalUserInfo,
} = vi.hoisted(() => ({
  trackGoal: vi.fn(),
  sendVerificationEmail: vi.fn(),
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  signInWithPopup: vi.fn(),
  getAdditionalUserInfo: vi.fn(),
}));

/** Mocked at the composable rather than at the tracker: the question is which
 * goal the form decided to fire, not whether the plausible plugin booted. */
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: vi.fn(),
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: () => ({
    login: authLogin,
    register: authRegister,
    resetPassword: vi.fn(),
  }),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  signInWithPopup: (...args: unknown[]) => signInWithPopup(...args),
  getAdditionalUserInfo: (...args: unknown[]) => getAdditionalUserInfo(...args),
}));

/** Where a teaser's lock sends a reader: register mode, the reason, and the
 * finding to come back to inside the redirect. */
const FROM_TEASER =
  "/login?konto=nowe&powod=powiazania&redirect=" +
  encodeURIComponent("/eksploruj/umowy?powiazanie=ukryte_13");

const vuetify = createVuetify({ components, directives });

async function mount(isLogin: boolean, route = FROM_TEASER) {
  return mountSuspended(LoginForm, {
    props: { isLogin },
    route,
    global: { plugins: [vuetify] },
  });
}

async function submit(
  wrapper: Awaited<ReturnType<typeof mount>>,
  email: string,
  password: string,
) {
  await wrapper.find("input#email").setValue(email);
  await wrapper.find("input#password").setValue(password);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  sendVerificationEmail.mockResolvedValue(undefined);
});

describe("LoginForm", () => {
  it.each([true, false])(
    "offers Google first, whichever mode it opens in (login: %s)",
    async (isLogin) => {
      const wrapper = await mount(isLogin);

      const google = wrapper.find('[data-testid="login-google"]');
      expect(google.exists()).toBe(true);
      // Neutral: the same tap signs in an old account and makes a new one.
      expect(google.text()).toBe("Kontynuuj z Google");
      const html = wrapper.html();
      expect(html.indexOf('data-testid="login-google"')).toBeLessThan(
        html.indexOf('id="email"'),
      );
    },
  );

  it("counts an account Google has just made, with the reason the reader came", async () => {
    signInWithPopup.mockResolvedValue({ user: { uid: "g-new" } });
    getAdditionalUserInfo.mockReturnValue({ isNewUser: true });
    const wrapper = await mount(false);

    await wrapper.find('[data-testid="login-google"]').trigger("click");
    await flushPromises();

    expect(trackGoal).toHaveBeenCalledWith("konto:utworzone", {
      from: "powiazania",
    });
    expect(wrapper.emitted("success")).toHaveLength(1);
  });

  it("does not count a returning Google user as a sign-up", async () => {
    signInWithPopup.mockResolvedValue({ user: { uid: "g-old" } });
    getAdditionalUserInfo.mockReturnValue({ isNewUser: false });
    const wrapper = await mount(true);

    await wrapper.find('[data-testid="login-google"]').trigger("click");
    await flushPromises();

    expect(trackGoal).not.toHaveBeenCalled();
    expect(wrapper.emitted("success")).toHaveLength(1);
  });

  it("files a sign-up with no reason under „inne”", async () => {
    signInWithPopup.mockResolvedValue({ user: { uid: "g-new" } });
    getAdditionalUserInfo.mockReturnValue({ isNewUser: true });
    const wrapper = await mount(true, "/login");

    await wrapper.find('[data-testid="login-google"]').trigger("click");
    await flushPromises();

    expect(trackGoal).toHaveBeenCalledWith("konto:utworzone", {
      from: "inne",
    });
  });

  it("lets a new account through without a blocking dialog, and mails the link back to the finding", async () => {
    const user = { uid: "new" };
    authRegister.mockResolvedValue({ user });
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const wrapper = await mount(false);

    await submit(wrapper, "nowy@example.com", "haslo123");

    expect(authRegister).toHaveBeenCalledWith("nowy@example.com", "haslo123");
    expect(trackGoal).toHaveBeenCalledWith("konto:utworzone", {
      from: "powiazania",
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      user,
      "/eksploruj/umowy?powiazanie=ukryte_13",
    );
    expect(alert).not.toHaveBeenCalled();
    expect(wrapper.emitted("success")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("does not fail a sign-up whose verification mail did not go", async () => {
    authRegister.mockResolvedValue({ user: { uid: "new" } });
    sendVerificationEmail.mockRejectedValue({ code: "auth/too-many-requests" });
    const wrapper = await mount(false);

    await submit(wrapper, "nowy@example.com", "haslo123");

    expect(wrapper.emitted("success")).toHaveLength(1);
    expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(false);
  });

  it("states the password rule before the reader submits, in register mode only", async () => {
    const register = await mount(false);
    expect(register.text()).toContain("Co najmniej 6 znaków");

    const login = await mount(true);
    expect(login.text()).not.toContain("Co najmniej 6 znaków");
  });

  it("offers to sign in when the address already has an account, keeping what was typed", async () => {
    authRegister.mockRejectedValue({ code: "auth/email-already-in-use" });
    const wrapper = await mount(false);

    await submit(wrapper, "zajety@example.com", "haslo123");

    expect(wrapper.text()).toContain("Na ten adres jest już konto.");
    await wrapper
      .find('[data-testid="login-zaloguj-tym-adresem"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:isLogin")).toEqual([[true]]);
    // Bound one-way here, as the dialog does: the form still switches itself.
    expect(wrapper.find('button[type="submit"]').text()).toBe("Zaloguj się");
    expect(
      (wrapper.find("input#email").element as HTMLInputElement).value,
    ).toBe("zajety@example.com");
    expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(false);
    expect(authLogin).not.toHaveBeenCalled();
  });

  it("keeps a single submit button, which the e2e login helper clicks", async () => {
    authRegister.mockRejectedValue({ code: "auth/email-already-in-use" });
    const wrapper = await mount(false);
    await submit(wrapper, "zajety@example.com", "haslo123");

    expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
  });
});
