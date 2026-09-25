import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import LoginPage from "../../app/pages/login.vue";

const { fakeAuth, authListeners, sendVerificationEmail } = vi.hoisted(() => ({
  fakeAuth: { name: "login-page-test" },
  authListeners: [] as ((user: unknown) => void)[],
  sendVerificationEmail: vi.fn(),
}));

mockNuxtImport("useFirebaseAuth", () => () => fakeAuth);

// Only the page's own listener is captured: vuefire subscribes too, on its
// own auth instance, and is left to the real implementation.
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>();
  return {
    ...actual,
    onAuthStateChanged: (
      auth: unknown,
      listener: (user: unknown) => void,
      ...rest: unknown[]
    ) => {
      if (auth !== fakeAuth) {
        return (actual.onAuthStateChanged as (...args: unknown[]) => unknown)(
          auth,
          listener,
          ...rest,
        );
      }
      authListeners.push(listener);
      return () => {};
    },
  };
});

vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({
    logout: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    resetPassword: vi.fn(),
  }),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}));

const vuetify = createVuetify({ components, directives });

const FINDING = "/eksploruj/umowy?powiazanie=ukryte_13";

function loginUrl(query: Record<string, string>) {
  return `/login?${new URLSearchParams(query).toString()}`;
}

async function mount(route: string) {
  const wrapper = await mountSuspended(LoginPage, {
    route,
    global: { plugins: [vuetify] },
  });
  // Spied only now: mounting navigates to `route` with `replace` itself.
  const replace = vi.spyOn(useRouter(), "replace").mockResolvedValue(undefined);
  return { wrapper, replace };
}

/** Firebase's answer: first whoever was restored, then any change. */
async function authState(user: unknown) {
  for (const listener of authListeners) listener(user);
  await flushPromises();
}

const USER = {
  uid: "u1",
  email: "czytelnik@example.com",
  displayName: null,
  emailVerified: false,
};

beforeEach(() => {
  authListeners.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/login", () => {
  it("sends somebody who signs in here straight on, without leaving /login behind", async () => {
    const { wrapper, replace } = await mount(
      loginUrl({ konto: "nowe", powod: "powiazania", redirect: FINDING }),
    );

    await authState(null);
    await authState(USER);

    // `replace`, so Back from the finding does not land on /login again.
    expect(replace).toHaveBeenCalledWith(FINDING);
    // None of the interstitial meant for somebody who came already signed in.
    expect(wrapper.text()).not.toContain("Cześć");
    expect(wrapper.text()).not.toContain("Wyloguj się teraz");
    wrapper.unmount();
  });

  it("goes home when the link names nowhere, or somewhere off the site", async () => {
    const { wrapper, replace } = await mount(
      loginUrl({ redirect: "//evil.example" }),
    );

    await authState(null);
    await authState(USER);

    expect(replace).toHaveBeenCalledWith("/");
    wrapper.unmount();
  });

  it("greets somebody who opens /login already signed in, and waits", async () => {
    const { wrapper, replace } = await mount(loginUrl({ redirect: FINDING }));

    await authState(USER);

    expect(wrapper.text()).toContain("Cześć czytelnik@example.com!");
    expect(wrapper.text()).toContain("Wróć do przeglądania");
    expect(replace).not.toHaveBeenCalled();

    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("Wróć do przeglądania"))!
      .trigger("click");
    expect(replace).toHaveBeenCalledWith(FINDING);
    wrapper.unmount();
  });

  it("resends the verification link without a blocking dialog", async () => {
    sendVerificationEmail.mockResolvedValue(undefined);
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const { wrapper } = await mount(loginUrl({ redirect: FINDING }));
    await authState(USER);

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Wyślij link ponownie")!
      .trigger("click");
    await flushPromises();

    expect(sendVerificationEmail).toHaveBeenCalledWith(USER, FINDING);
    expect(alert).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Wysłaliśmy link.");
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  describe("the reason the reader came", () => {
    it("says what an account gets, in register mode", async () => {
      const { wrapper } = await mount(
        loginUrl({
          konto: "nowe",
          powod: "powiazania",
          redirect: "/eksploruj/umowy",
        }),
      );

      const alert = wrapper.find('[data-testid="login-powod-powiazania"]');
      expect(alert.text()).toMatch(/^Po założeniu konta zobaczysz wszystkie/);
      // „Rejestracja" stays on screen, once: the e2e spec finds it by text.
      expect(wrapper.text().split("Rejestracja")).toHaveLength(2);
    });

    it("and in sign-in mode", async () => {
      const { wrapper } = await mount(
        loginUrl({ powod: "powiazania", redirect: "/eksploruj/umowy" }),
      );

      expect(
        wrapper.find('[data-testid="login-powod-powiazania"]').text(),
      ).toMatch(/^Po zalogowaniu zobaczysz/);
    });

    it("follows the mode when the reader switches it", async () => {
      const { wrapper } = await mount(
        loginUrl({ konto: "nowe", powod: "powiazania" }),
      );

      await wrapper
        .findAll("a")
        .find((a) => a.text() === "Masz już konto? Zaloguj się")!
        .trigger("click");

      expect(
        wrapper.find('[data-testid="login-powod-powiazania"]').text(),
      ).toMatch(/^Po zalogowaniu/);
    });

    it("speaks of the one finding when the link names one", async () => {
      const { wrapper } = await mount(
        loginUrl({ konto: "nowe", powod: "powiazania", redirect: FINDING }),
      );

      const text = wrapper
        .find('[data-testid="login-powod-powiazania"]')
        .text();
      expect(text).toContain("kogo dotyczy wybrane powiązanie");
      // A teaser's rank: the reader has seen the finding exist.
      expect(text).not.toContain("o ile");
    });

    it("hedges for a finding named by NIP, which may be gone", async () => {
      // What the locked permalink sends, and that card cannot say whether the
      // finding is gated or missing - so neither may the promise here.
      const { wrapper } = await mount(
        loginUrl({
          konto: "nowe",
          powod: "powiazania",
          redirect: "/eksploruj/umowy?powiazanie=cru_9990000099",
        }),
      );

      const text = wrapper
        .find('[data-testid="login-powod-powiazania"]')
        .text();
      expect(text).toContain("o ile nadal jest na liście");
      expect(text).not.toContain("kogo dotyczy");
    });

    it("speaks of the people behind a public card's lock", async () => {
      const { wrapper } = await mount(
        loginUrl({
          konto: "nowe",
          powod: "powiazania-osoby",
          redirect: "/eksploruj/umowy?powiazanie=cru_9990000011",
        }),
      );

      expect(
        wrapper.find('[data-testid="login-powod-powiazania"]').exists(),
      ).toBe(false);
      const text = wrapper
        .find('[data-testid="login-powod-powiazania-osoby"]')
        .text();
      expect(text).toMatch(/^Po założeniu konta zobaczysz także osoby/);
      // The card already showed the name, the firm and the contracts.
      expect(text).not.toContain("wybrane powiązanie");
    });

    it("has its own words for the people behind the locked chip", async () => {
      const { wrapper } = await mount(
        loginUrl({
          konto: "nowe",
          powod: "ludzie",
          redirect: "/eksploruj/umowy?tryb=ludzie",
        }),
      );

      expect(
        wrapper.find('[data-testid="login-powod-powiazania"]').exists(),
      ).toBe(false);
      expect(wrapper.find('[data-testid="login-powod-ludzie"]').text()).toBe(
        "Po założeniu konta zobaczysz osoby we władzach instytucji z rejestru umów.",
      );
    });

    it("says nothing for a reason it does not know", async () => {
      const { wrapper } = await mount(loginUrl({ powod: "cokolwiek" }));

      expect(wrapper.find('[data-testid^="login-powod-"]').exists()).toBe(
        false,
      );
    });
  });
});
