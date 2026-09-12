import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import Explorer from "../../../app/components/home/Explorer.vue";
import { brand, contrastRatio, themeColors } from "../../../shared/colors";
import { HOME_DEFAULT_EXPERIMENT } from "../../../shared/experiments";

/** Mocked at the composable rather than at the tracker, so the assertions are
 * about which goal the explorer decided to fire. Whether the plausible plugin
 * booted in the test environment is a different question, and not one this
 * component can answer. */
const trackGoal = vi.fn();
const setGlobalProp = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: (...args: unknown[]) => setGlobalProp(...args),
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
        // The map is an svg of 380 powiaty, the chart needs apexcharts and both
        // side cards need firestore. None of them is what is under test here.
        ChartPolandMap: true,
        CardPeopleList: true,
        HomeTimeline: true,
        HomeTimelineControls: true,
      },
    },
  });

/** Both breakpoints render a tab strip bound to the same value, so "the Wykres
 * tab" is two elements. Clicking either has to do the same thing - and firing
 * twice for one reader is exactly the bug the controlled model-value guards
 * against. */
const tabs = (wrapper: Awaited<ReturnType<typeof mount>>, label: string) =>
  wrapper.findAll(".v-tab").filter((tab) => tab.text() === label);

beforeEach(() => {
  trackGoal.mockClear();
  setGlobalProp.mockClear();
  sessionStorage.clear();
});

describe("HomeExplorer", () => {
  it("opens on the map while the experiment is dormant", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Mapa koryciarstwa");
    expect(wrapper.text()).not.toContain("Stanowiska w czasie");
  });

  it("paints the selected tab in something a reader can see", async () => {
    // The regression this guards: the strip was `color="primary"`, which is
    // #a8c79f - a pale sage meant as a fill, and 1.85:1 as text on the white
    // panel the explorer sits on. Being *lighter* than the rgba(0,0,0,.87) the
    // unselected tabs carry, it made a clicked tab look faded rather than
    // chosen, so the strip answered a click by looking less selected.
    //
    // Asserted as a property rather than as a hex: whichever token the strip
    // uses has to clear AA on white, so a future re-theme cannot quietly put a
    // fill back in a text slot.
    const wrapper = await mount();

    const selected = wrapper.find(".v-tab--selected");
    expect(selected.exists()).toBe(true);

    const token = selected
      .classes()
      .find((name) => name.startsWith("text-"))
      ?.replace(/^text-/, "");
    expect(token, "the selected tab carries no colour class").toBeDefined();

    // The brand fills are in the lookup on purpose. They are what the strip
    // used to ask for, and resolving them is what makes the regression fail on
    // the contrast line - the thing that is actually wrong - rather than on an
    // unrecognised token.
    const palette: Record<string, string> = { ...themeColors, ...brand };
    const hex = palette[token!];
    expect(hex, `${token} is not a colour this test knows`).toBeDefined();
    expect(contrastRatio(hex!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("has no Partie tab", async () => {
    // The treemap panel was removed; the tab strip is the only thing that could
    // still offer it.
    const wrapper = await mount();

    expect(tabs(wrapper, "Partie")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Podział na partie");
  });

  it("records the arm once, not once per tab strip", async () => {
    await mount();

    const assigned = trackGoal.mock.calls.filter(
      (call) => call[0] === "experiment:assigned",
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0]![1]).toEqual({
      experiment: HOME_DEFAULT_EXPERIMENT.id,
      arm: "map",
    });
  });

  it("puts the arm on every later event", async () => {
    // The whole point of moving off a goal-per-arm: with the arm as a property
    // the dashboard can be filtered to one arm and any metric compared, not
    // just the conversions of one goal.
    const wrapper = await mount();

    expect(setGlobalProp).toHaveBeenCalledWith(
      `arm:${HOME_DEFAULT_EXPERIMENT.id}`,
      "map",
    );
    // Registered before the first goal is sent, so the denominator sits inside
    // the same filter as the things it is a denominator for.
    expect(setGlobalProp.mock.invocationCallOrder[0]!).toBeLessThan(
      trackGoal.mock.invocationCallOrder[0]!,
    );
    expect(wrapper.text()).toContain("Mapa koryciarstwa");
  });

  it("counts a switch to the chart, and back", async () => {
    const wrapper = await mount();

    await tabs(wrapper, "Wykres")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:tab", {
      tab: "graph",
    });
    expect(wrapper.text()).toContain("Stanowiska w czasie");

    trackGoal.mockClear();
    await tabs(wrapper, "Mapa")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:tab", { tab: "map" });
  });

  it("does not count a click on the tab already open", async () => {
    const wrapper = await mount();
    trackGoal.mockClear();

    await tabs(wrapper, "Mapa")[0]!.trigger("click");

    expect(trackGoal).not.toHaveBeenCalled();
  });

  it("counts a powiat picked on the map", async () => {
    const wrapper = await mount();
    const map = wrapper.findComponent({ name: "ChartPolandMap" });

    map.vm.$emit("click", { teryt: "1261", d: "", name: "Kraków" });
    await wrapper.vm.$nextTick();

    expect(trackGoal).toHaveBeenCalledWith("home-explorer:pick", {
      panel: "map",
      value: "1261",
    });
  });
});
