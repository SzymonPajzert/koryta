import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import LoginPage from "../../app/pages/login.vue";

/** `?konto=nowe` is what a „Rejestracja” link carries - the teaser of an
 * unpublished person has one beside „Zaloguj się” - and it should not land the
 * reader on a form for an account they do not have. */
describe("/login", () => {
  it("opens on registration for a link that asks for a new account", async () => {
    const wrapper = await mountSuspended(LoginPage, {
      route: "/login?konto=nowe&powod=profil-osoby",
    });

    expect(wrapper.text()).toContain("Rejestracja");
    expect(wrapper.text()).toContain("Masz już konto? Zaloguj się");
  });

  it("opens on signing in otherwise", async () => {
    const wrapper = await mountSuspended(LoginPage, { route: "/login" });

    expect(wrapper.text()).toContain("Nie masz konta? Zarejestruj się");
  });
});
