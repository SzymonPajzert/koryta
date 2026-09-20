import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import QueueTiers from "../../../app/components/pomoc/QueueTiers.vue";
import { queueTierCopy } from "../../../shared/queueTiers";

const trackGoal = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: vi.fn(),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const tiers = [
  {
    tier: 1,
    toCheck: 407,
    examples: [{ id: "abc123", name: "Jan Kowalski" }],
  },
  { tier: 2, toCheck: null, examples: [] },
  { tier: 3, toCheck: 1320, examples: [] },
];

registerEndpoint("/api/stats/queueTiers", () => ({ tiers }));

const mount = async () => {
  const wrapper = await mountSuspended(QueueTiers);
  // `useQueueTiers()` does not await its `useAsyncData`, the same way
  // `useStats()` does not - see tests/pages/pomoc.test.ts.
  await flushPromises();
  return wrapper;
};

beforeEach(() => trackGoal.mockClear());

/** The block that tells a volunteer which people they can actually finish.
 *
 * The queue orders 9,074 people by how worth looking at they are and says
 * nothing about what looking at one would cost; these three cards are the
 * other half of that question, so what they are worth is whether the count is
 * honest and whether the link lands on the people the card described.
 */
describe("PomocQueueTiers", () => {
  it("offers one card per tier, each linking into the queue filtered to it", async () => {
    const wrapper = await mount();

    // Asserted on the prop rather than on an `href`: a `v-card` with `to`
    // renders no anchor under `mountSuspended`, which has no router to resolve
    // it against.
    const cards = wrapper.findAllComponents({ name: "CardAction" });
    expect(cards.map((card) => card.props("to"))).toEqual([
      "/eksploruj/nowe?tier=1",
      "/eksploruj/nowe?tier=2",
      "/eksploruj/nowe?tier=3",
    ]);
    for (const tier of [1, 2, 3] as const) {
      expect(cards[tier - 1]!.text()).toContain(queueTierCopy[tier].title);
    }
  });

  it("prints how many are left, with the Polish plural", async () => {
    const wrapper = await mount();

    expect(wrapper.find('[data-testid="tier-count-1"]').text()).toContain(
      "407 osób",
    );
  });

  it("says nothing rather than zero where the count is unknown", async () => {
    // `toCheck` is null while the tier has no index or nothing has computed
    // it. „0 osób do sprawdzenia” is the one number that would talk a reader
    // out of the task the card exists to hand them.
    const wrapper = await mount();

    expect(wrapper.find('[data-testid="tier-count-2"]').exists()).toBe(false);
    expect(wrapper.findAll("[data-testid^='tier-count-']")).toHaveLength(2);
  });

  it("links a published example by name, to its own page", async () => {
    const wrapper = await mount();

    const link = wrapper.find('a[href="/osoba/jan-kowalski-abc123"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain("Jan Kowalski");
  });

  it("records which tier the reader picked", async () => {
    const wrapper = await mount();

    await wrapper
      .findAllComponents({ name: "CardAction" })[2]!
      .trigger("click");

    expect(trackGoal).toHaveBeenCalledWith("cta:task", {
      task: "kolejka",
      from: "pomoc-poziom-3",
    });
  });
});
