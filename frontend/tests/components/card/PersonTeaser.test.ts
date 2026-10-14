import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import PersonTeaser from "../../../app/components/card/PersonTeaser.vue";
import { trackGoal } from "~/composables/analytics";
import { noteSearchPick } from "~/composables/teaserJourney";
import type { PersonTeaser as Teaser } from "~~/shared/personTeaser";

const auth = vi.hoisted(() => ({ user: null as { uid: string } | null }));

vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  getCurrentUser: async () => auth.user,
}));
vi.mock("~/composables/analytics", () => ({ trackGoal: vi.fn() }));

const TEASER: Teaser = {
  id: "p1",
  name: "Jan Kowalski",
  employment: {
    role: "Prezes Zarządu",
    companyId: "c1",
    companyName: "ENERGA SPÓŁKA AKCYJNA",
    companyPublished: true,
    start: "2023-02-01",
  },
  employmentCount: 3,
};

const mount = async (teaser: Teaser = TEASER) => {
  const wrapper = await mountSuspended(PersonTeaser, {
    props: { teaser, nodeId: "p1" },
  });
  await flushPromises();
  return wrapper;
};

describe("CardPersonTeaser", () => {
  beforeEach(() => {
    auth.user = null;
    vi.mocked(trackGoal).mockClear();
  });

  it("names the person and the post they hold now", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Jan Kowalski");
    expect(wrapper.text()).toContain("Profil niezweryfikowany");
    const job = wrapper.get('[data-testid="person-teaser-employment"]');
    expect(job.text()).toContain("Obecne stanowisko");
    expect(job.text()).toContain("ENERGA SPÓŁKA AKCYJNA");
    expect(job.text()).toContain("Prezes Zarządu · od 2023-02-01");
    // A live company is a link a logged out reader can follow.
    expect(job.find("a").attributes("href")).toMatch(/^\/instytucja\//);
  });

  it("says a post that ended is the last one, with both dates", async () => {
    const wrapper = await mount({
      ...TEASER,
      employment: { ...TEASER.employment!, end: "2024-06-30" },
    });

    const job = wrapper.get('[data-testid="person-teaser-employment"]');
    expect(job.text()).toContain("Ostatnie stanowisko");
    expect(job.text()).toContain("2023-02-01 - 2024-06-30");
  });

  it("does not link a company nobody has published", async () => {
    // It would be the same wall again.
    const wrapper = await mount({
      ...TEASER,
      employment: { ...TEASER.employment!, companyPublished: false },
    });

    const job = wrapper.get('[data-testid="person-teaser-employment"]');
    expect(job.find("a").exists()).toBe(false);
    expect(job.text()).toContain("ENERGA SPÓŁKA AKCYJNA");
  });

  it("says nothing about a post where there is none", async () => {
    const wrapper = await mount({
      id: "p1",
      name: "Jan Kowalski",
      employmentCount: 0,
    });

    expect(
      wrapper.find('[data-testid="person-teaser-employment"]').exists(),
    ).toBe(false);
    expect(wrapper.get('[data-testid="person-teaser-more"]').text()).toBe(
      "Po zalogowaniu zobaczysz cały profil, ze źródłami i grafem powiązań, i możesz pomóc go sprawdzić.",
    );
  });

  it("promises the posts the full page lists", async () => {
    const wrapper = await mount();

    expect(wrapper.get('[data-testid="person-teaser-more"]').text()).toContain(
      "wszystkie 3 stanowiska",
    );
  });

  it("sends the reader to sign in and back, saying why", async () => {
    const wrapper = await mount();

    // Read off the prop: Vuetify's link resolves no href in this environment.
    const button = wrapper
      .findAllComponents({ name: "VBtn" })
      .find((btn) => btn.attributes("data-testid") === "person-teaser-login");
    expect(button?.props("to")).toEqual({
      path: "/login",
      query: { redirect: expect.any(String), powod: "profil-osoby" },
    });

    await wrapper.get('[data-testid="person-teaser-login"]').trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("teaser:click", {
      surface: "osoba",
      kind: "profil",
    });
  });

  it("counts being shown, and whether the search box sent the reader", async () => {
    noteSearchPick("p1");
    await mount();

    expect(trackGoal).toHaveBeenCalledWith("teaser:shown", {
      surface: "osoba",
      kind: "profil",
      from: "search",
    });
  });

  it("does not count a signed in reader, who is only passing through", async () => {
    // The server's render is anonymous, so they see this for a moment.
    auth.user = { uid: "reader" };
    await mount();

    expect(trackGoal).not.toHaveBeenCalledWith(
      "teaser:shown",
      expect.anything(),
    );
  });
});
