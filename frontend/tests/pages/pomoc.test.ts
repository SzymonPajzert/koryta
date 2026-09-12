import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import PomocPage from "../../app/pages/pomoc.vue";
import { HELP_PATHS, HELP_TASKS } from "../../shared/analytics";

/** Mocked at the composable rather than at the tracker: the question is which
 * goal the page decided to fire, not whether the plausible plugin booted. */
const trackGoal = vi.fn();
const setGlobalProp = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: (...args: unknown[]) => setGlobalProp(...args),
}));

beforeEach(() => trackGoal.mockClear());

// Vuetify's tooltips observe their activator, and happy-dom ships no
// ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

registerEndpoint("/api/stats/progress", () => ({
  total: 100,
  approved: 40,
  reviewed: 30,
  toCheck: 30,
}));

const mount = async () => {
  const wrapper = await mountSuspended(PomocPage);
  // `useStats()` does not await its `useAsyncData`; see the same note in
  // tests/components/card/CallToAction.test.ts.
  await flushPromises();
  return wrapper;
};

/** The page the owner wants to be able to point at when somebody asks how they
 * can help. What it is worth depends on two things a screenshot cannot check:
 * that every door it lists actually opens, and that it says which of them cost
 * an account - the page it replaces promised „nie potrzebujesz konta ani
 * doświadczenia” directly above two links that both carry the auth
 * middleware. */
describe("PomocPage", () => {
  it("offers one tile per declared path, and each scrolls to a real section", async () => {
    const wrapper = await mount();

    const anchors = wrapper
      .findAll("a[href^='#']")
      .map((a) => a.attributes("href")!.slice(1));
    expect(anchors).toEqual([...HELP_PATHS]);

    for (const path of HELP_PATHS) {
      expect(wrapper.find(`section#${path}`).exists()).toBe(true);
    }
  });

  it("gives every card somewhere to go, or something to open", async () => {
    const wrapper = await mount();

    const cards = wrapper.findAllComponents({ name: "CardAction" });
    expect(cards.length).toBeGreaterThan(10);

    for (const card of cards) {
      const goesSomewhere = Boolean(card.props("to") || card.props("href"));
      // A card with no destination is a button, and the only reason to be one
      // is to open a dialog - so somebody has to be listening for `activate`.
      const opensSomething = Boolean(card.vm.$.vnode.props?.onActivate);
      expect(
        goesSomewhere || opensSomething,
        `„${card.props("title")}” leads nowhere`,
      ).toBe(true);
    }
  });

  it("says which of the checking tasks need an account", async () => {
    const wrapper = await mount();

    const section = wrapper.get("section#sprawdzanie");
    const chips = section.findAll(".v-chip").map((chip) => chip.text());

    expect(chips).toHaveLength(4);
    for (const chip of chips) expect(chip).toBe("po zalogowaniu");
  });

  it("has dropped the promise that contradicted them", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).not.toContain("Nie potrzebujesz konta");
  });

  it("drops the expired Discord invite and adds the live fundraiser", async () => {
    const wrapper = await mount();

    // discord.com/invite/QvU5syTZ answers `{"code": 50270, "message": "Invite
    // is expired."}` - the card was a dead end on the page whose whole job is
    // that none of them are.
    expect(wrapper.html()).not.toContain("discord.com");
    expect(wrapper.html()).toContain("zrzutka.pl/rd7ssx/pay");
    expect(wrapper.html()).toContain("patronite.pl/romb.me");
  });

  // The bug this replaces: the old page guarded its handler on `action.href &&`,
  // so the two internal quick actions - the two the project most wants taken -
  // fired nothing at all, and the dashboard could not tell a page nobody used
  // from a page whose clicks were never counted.
  it("counts a click on a card that stays on the site", async () => {
    const wrapper = await mount();

    await wrapper
      .get("section#minuta")
      .findAllComponents({ name: "CardAction" })[1]!
      .trigger("click");

    expect(trackGoal).toHaveBeenCalledWith("cta:task", {
      task: "tabela",
      from: "pomoc",
    });
  });

  it("fires a declared task name for every card that reports one", async () => {
    const wrapper = await mount();

    for (const card of wrapper.findAllComponents({ name: "CardAction" })) {
      await card.trigger("click");
    }

    const tasks = trackGoal.mock.calls
      .filter(([goal]) => goal === "cta:task")
      .map(([, props]) => (props as { task: string }).task);

    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(HELP_TASKS).toContain(task);
  });

  it("names the report button, which is the cheapest way in and was never listed", async () => {
    const wrapper = await mount();

    expect(wrapper.get("section#minuta").text()).toContain(
      "Napisz, co jest nie tak",
    );
  });
});
