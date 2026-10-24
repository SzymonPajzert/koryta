import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import PersonTeaser from "../../../app/components/card/PersonTeaser.vue";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
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
  post: {
    id: "job",
    name: "Prezes Zarządu",
    start_date: "2023-02-01",
    company: {
      id: "c1",
      name: "ENERGA SPÓŁKA AKCYJNA",
      visibility: true,
      isPublic: true,
    },
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

/** One of the banner's two buttons, by its test id. Read off the props:
 * Vuetify's link resolves no href in this environment. */
const button = (wrapper: Awaited<ReturnType<typeof mount>>, testid: string) =>
  wrapper
    .findAllComponents({ name: "VBtn" })
    .find((btn) => btn.attributes("data-testid") === testid);

describe("CardPersonTeaser", () => {
  beforeEach(() => {
    auth.user = null;
    vi.mocked(trackGoal).mockClear();
  });

  it("shows the latest post as the first row of the history card", async () => {
    // The full page's own card, not a copy of it: the same row, chips and
    // dates a reader sees once signed in.
    const wrapper = await mount();

    // The name is the page's h1, as the full page heads a person.
    expect(wrapper.get("h1").text()).toBe("Jan Kowalski");
    const history = wrapper.findComponent(EmploymentHistory);
    expect(history.exists()).toBe(true);
    expect(history.props("unlinkDrafts")).toBe(true);
    // In the page's ledger form, so the teaser reads as the page it is a
    // piece of.
    expect(history.props("ledger")).toBe(true);
    expect(history.props("edges")).toEqual([
      expect.objectContaining({
        id: "job",
        type: "employed",
        label: "Prezes Zarządu",
        source: "p1",
        target: "c1",
        start_date: "2023-02-01",
        richNode: expect.objectContaining({
          id: "c1",
          type: "place",
          name: "ENERGA SPÓŁKA AKCYJNA",
          visibility: true,
        }),
      }),
    ]);
    expect(history.text()).toContain("Historia powiązań");
    expect(history.text()).toContain("ENERGA SPÓŁKA AKCYJNA");
    expect(history.text()).toContain("Prezes Zarządu");
    // The ledger's own column: the post is held, from its first day.
    expect(
      history
        .get("[data-testid='edge-period-job'] .history-period__full")
        .text(),
    ).toBe("od 01.02.2023");
    // One post is the whole list, so no group heads it.
    expect(history.find("h3").exists()).toBe(false);
    // A public company is what the page is about, so as on the full page no
    // chip says so: only a company that is not public is marked.
    expect(history.text()).not.toContain("Instytucja publiczna");
  });

  it("marks the post's company where it is not a public one", async () => {
    const wrapper = await mount({
      ...TEASER,
      post: {
        ...TEASER.post!,
        company: {
          ...TEASER.post!.company,
          isPublic: false,
          isPublicSource: "manual",
        },
      },
    });

    expect(wrapper.findComponent(EmploymentHistory).text()).toContain(
      "Podmiot prywatny",
    );
  });

  it("labels a post the register named no role for as the history does", async () => {
    const wrapper = await mount({
      ...TEASER,
      post: { ...TEASER.post!, name: undefined },
    });

    expect(
      wrapper.findComponent(EmploymentHistory).props("edges")[0].label,
    ).toBe("Zatrudniony/a w");
  });

  it("puts the notice under the profile, with both ways in", async () => {
    const wrapper = await mount();

    const html = wrapper.html();
    expect(html.indexOf("Historia powiązań")).toBeLessThan(
      html.indexOf("W trakcie weryfikacji"),
    );
    expect(button(wrapper, "login-banner-login")?.props("to")).toEqual({
      path: "/login",
      query: { redirect: expect.any(String), powod: "profil-osoby" },
    });
    expect(button(wrapper, "login-banner-signup")?.props("to")).toEqual({
      path: "/login",
      query: {
        redirect: expect.any(String),
        powod: "profil-osoby",
        konto: "nowe",
      },
    });
  });

  it("counts which of the two buttons was clicked", async () => {
    const wrapper = await mount();

    await wrapper.get('[data-testid="login-banner-signup"]').trigger("click");
    await wrapper.get('[data-testid="login-banner-login"]').trigger("click");

    expect(trackGoal).toHaveBeenCalledWith("teaser:click", {
      surface: "osoba",
      kind: "profil",
      mode: "signup",
    });
    expect(trackGoal).toHaveBeenCalledWith("teaser:click", {
      surface: "osoba",
      kind: "profil",
      mode: "login",
    });
  });

  it("promises the posts the full page lists", async () => {
    const wrapper = await mount();

    expect(wrapper.get('[data-testid="person-teaser-more"]').text()).toContain(
      "wszystkie 3 stanowiska",
    );
  });

  it("shows no history where there is no post on record", async () => {
    const wrapper = await mount({
      id: "p1",
      name: "Jan Kowalski",
      employmentCount: 0,
    });

    expect(
      wrapper.find('[data-testid="person-teaser-employment"]').exists(),
    ).toBe(false);
    expect(wrapper.get('[data-testid="person-teaser-more"]').text()).toBe(
      "Zaloguj się, by zobaczyć wszystkie źródła i graf powiązań tej osoby.",
    );
  });

  it("draws no picture where nobody has one", async () => {
    // The person icon read as a profile picture that is never set.
    const wrapper = await mount();
    expect(wrapper.find(".v-card-item__prepend").exists()).toBe(false);
    expect(wrapper.find(".v-avatar").exists()).toBe(false);
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
