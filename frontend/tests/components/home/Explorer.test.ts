import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import Explorer from "../../../app/components/home/Explorer.vue";
import { HOME_DEFAULT_EXPERIMENT } from "../../../shared/experiments";

/** Mocked at the composable rather than at the tracker, so the assertions are
 * about which goal the explorer decided to fire. Whether the plausible plugin
 * booted in the test environment is a different question, and not one this
 * component can answer. */
const trackGoal = vi.fn();
const trackExperimentGoal = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  trackExperimentGoal: (...args: unknown[]) => trackExperimentGoal(...args),
}));

registerEndpoint("/api/stats/progress", () => ({
  total: 100,
  approved: 40,
  reviewed: 30,
  toCheck: 30,
}));

const mount = () =>
  mountSuspended(Explorer, {
    global: {
      stubs: {
        // The map is an svg of 380 powiaty, the treemap needs apexcharts and
        // the list needs firestore. None of them is what is under test here.
        //
        // Both names for the treemap: the template asks for the `Lazy` variant,
        // and stubbing only that one leaves apexcharts to render into a
        // detached happy-dom node and reject with "Element not found" - after
        // the assertions have passed, so the suite stays green and the run
        // exits 1.
        ChartPolandMap: true,
        ChartTreemapParty: true,
        LazyChartTreemapParty: true,
        CardPeopleList: true,
      },
    },
  });

/** Both breakpoints render a tab strip bound to the same value, so "the Partie
 * tab" is two elements. Clicking either has to do the same thing - and firing
 * twice for one reader is exactly the bug the controlled model-value guards
 * against. */
const tabs = (wrapper: Awaited<ReturnType<typeof mount>>, label: string) =>
  wrapper.findAll(".v-tab").filter((tab) => tab.text() === label);

beforeEach(() => {
  trackGoal.mockClear();
  trackExperimentGoal.mockClear();
  sessionStorage.clear();
});

describe("HomeExplorer", () => {
  it("opens on the map while the experiment is dormant", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Mapa koryciarstwa");
    expect(wrapper.text()).not.toContain("Podział na partie");
  });

  it("records the arm once, not once per tab strip", async () => {
    await mount();

    expect(trackExperimentGoal).toHaveBeenCalledTimes(1);
    expect(trackExperimentGoal.mock.calls[0]![0]).toBe(
      `exp:${HOME_DEFAULT_EXPERIMENT.id}:map`,
    );
  });

  it("counts a switch to the party treemap, and back", async () => {
    const wrapper = await mount();

    await tabs(wrapper, "Partie")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:tab-parties");
    expect(wrapper.text()).toContain("Podział na partie");

    trackGoal.mockClear();
    await tabs(wrapper, "Mapa")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:tab-map");
  });

  it("does not count a click on the tab already open", async () => {
    const wrapper = await mount();

    await tabs(wrapper, "Mapa")[0]!.trigger("click");

    expect(trackGoal).not.toHaveBeenCalled();
  });

  it("counts a powiat picked on the map", async () => {
    const wrapper = await mount();
    const map = wrapper.findComponent({ name: "ChartPolandMap" });

    map.vm.$emit("click", { teryt: "1261", d: "", name: "Kraków" });
    await wrapper.vm.$nextTick();

    expect(trackGoal).toHaveBeenCalledWith("home-map:region", {
      region: "1261",
    });
  });
});
