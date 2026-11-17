import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { useRouter } from "#app";
import Explorer from "../../../app/components/home/Explorer.vue";
import { brand, contrastRatio, themeColors } from "../../../shared/colors";
import {
  assignArm,
  HOME_DEFAULT_EXPERIMENT,
} from "../../../shared/experiments";
import type { DeclarationPeople } from "../../../shared/declarations";

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

/** `route` is where the page is: mountSuspended navigates there first, so a
 * query set on the router beforehand would be gone by the time it mounts. */
const mount = (people: DeclarationPeople | null = null, route = "/") =>
  mountSuspended(Explorer, {
    props: { people },
    route,
    global: {
      stubs: {
        // The map is an svg of 380 powiaty, the chart needs apexcharts and both
        // side cards need firestore. None of them is what is under test here.
        ChartPolandMap: true,
        CardPeopleList: true,
        HomeTimeline: true,
        HomeTimelineControls: true,
        OswiadczeniaPeoplePanel: true,
        OswiadczeniaPeopleSide: true,
      },
    },
  });

/** Both breakpoints render a tab strip bound to the same value, so "the Stanowiska
 * tab" is two elements. Clicking either has to do the same thing - and firing
 * twice for one reader is exactly the bug the controlled model-value guards
 * against. */
const tabs = (wrapper: Awaited<ReturnType<typeof mount>>, label: string) =>
  wrapper.findAll(".v-tab").filter((tab) => tab.text() === label);

/** Which tab each strip is underlining. Two entries, one per breakpoint. */
const underlined = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper.findAll(".v-tab--selected").map((tab) => tab.text());

/** A session id that `home-default` puts in `arm`, stored where the
 * composable looks for it: the split is live, so an unseeded session lands in
 * any of the three arms. */
function seatIn(arm: string) {
  for (let i = 0; i < 10_000; i++) {
    const id = `test-session-${i}`;
    if (assignArm(HOME_DEFAULT_EXPERIMENT, id) === arm) {
      sessionStorage.setItem("koryta:session", id);
      return;
    }
  }
  throw new Error(`no session id lands in ${arm}`);
}

/** The night's people snapshot, as small as the panel needs. */
const PEOPLE: DeclarationPeople = {
  at: "2026-11-14T06:30:00.000Z",
  exportDay: "2026-11-14",
  people: 10,
  published: 3,
  namesakes: 1,
  mismatched: 0,
  held: 1,
  reading: 1,
  cropped: 1,
  downloaded: 1,
  searching: 2,
  searchingBy: [{ reason: "unreachable", count: 2 }],
  expectedNamesakes: null,
  bySurname: [],
  topUnits: [],
  publishedByDay: [],
};

beforeEach(() => {
  trackGoal.mockClear();
  setGlobalProp.mockClear();
  sessionStorage.clear();
  seatIn("map");
  // happy-dom calls itself automated, and an automated browser sits every
  // split out; a reader's browser does not.
  Object.defineProperty(navigator, "webdriver", {
    value: false,
    configurable: true,
  });
});

describe("HomeExplorer", () => {
  it("opens on the map in the map's arm", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Mapa koryciarstwa");
    expect(wrapper.text()).not.toContain("Zmiany na stanowiskach");
  });

  it("opens on the declarations in their arm", async () => {
    seatIn("oswiadczenia");
    const wrapper = await mount(PEOPLE);

    expect(underlined(wrapper)).toEqual(["Oświadczenia", "Oświadczenia"]);
    expect(wrapper.text()).toContain("Oświadczenia majątkowe");
  });

  it("falls back to the map when the declarations have no snapshot", async () => {
    // Before the job's first night there is no panel to open: the strip keeps
    // two tabs and the reader gets the map rather than an empty window.
    seatIn("oswiadczenia");
    const wrapper = await mount(null);

    expect(tabs(wrapper, "Oświadczenia")).toHaveLength(0);
    expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);
  });

  it("sits an automated browser out of the split", async () => {
    // The site's own Playwright suites and any scraper driving Chrome: the
    // control arm every run, and no reader counted in an arm.
    seatIn("oswiadczenia");
    Object.defineProperty(navigator, "webdriver", {
      value: true,
      configurable: true,
    });
    try {
      const wrapper = await mount(PEOPLE);
      expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);
      expect(
        trackGoal.mock.calls.some((call) => call[0] === "experiment:assigned"),
      ).toBe(false);
      expect(setGlobalProp).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "webdriver", {
        value: false,
        configurable: true,
      });
    }
  });

  it("shows its panels once the arm is set", async () => {
    // Hidden until then while the split is live, for every arm alike, so no
    // arm paints the map first. After mounting nothing is held back.
    const wrapper = await mount(PEOPLE);

    expect(wrapper.get("[data-testid=home-explorer]").classes()).not.toContain(
      "explorer--pending",
    );
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

  it("never re-creates the side card, only hides it", async () => {
    // The regression, and why it is asserted as identity rather than presence.
    // The card used to sit behind a `v-else`, so opening the chart panel
    // destroyed it and coming back built a new one - and `CardPeopleList`
    // awaits its data in `setup`. Re-created after the page's `<Suspense>` has
    // settled, it came back as nothing at all and the column was empty.
    //
    // A presence check cannot see this: any stub renders on a fresh instance
    // just as happily. Holding the instance is what pins "it was never torn
    // down", which is the property the fix actually provides.
    const wrapper = await mount();
    const before = wrapper.findComponent({ name: "CardPeopleList" });
    expect(before.exists()).toBe(true);

    await tabs(wrapper, "Stanowiska")[0]!.trigger("click");
    await tabs(wrapper, "Mapa")[0]!.trigger("click");
    await flushPromises();

    const after = wrapper.findComponent({ name: "CardPeopleList" });
    expect(after.exists()).toBe(true);
    expect(after.vm).toBe(before.vm);
  });

  it("keeps the underline, both strips and the panel on one tab", async () => {
    // The bug this guards. The strip used to be `:model-value` plus a handler
    // that wrote the emitted value back, and the handler could refuse it - so
    // the strip underlined „Mapa” while the window showed „Stanowiska”, and the
    // click back was then a no-op: the strip already thought „Mapa” was
    // selected, so it had nothing new to emit and the reader was stuck.
    //
    // Asserted on the way out *and* on the way back, because the wedge only
    // shows itself on the return trip.
    const wrapper = await mount();
    expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);

    await tabs(wrapper, "Stanowiska")[0]!.trigger("click");
    expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
    expect(wrapper.text()).toContain("Zmiany na stanowiskach");

    await tabs(wrapper, "Mapa")[0]!.trigger("click");
    expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);
    expect(wrapper.text()).toContain("Mapa koryciarstwa");
  });

  it("follows a click on either breakpoint's strip", async () => {
    // Both strips are bound to the same panel, and only one is on screen at a
    // time - so a click on the second has to move the first.
    const wrapper = await mount();

    await tabs(wrapper, "Stanowiska")[1]!.trigger("click");

    expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
    expect(wrapper.text()).toContain("Zmiany na stanowiskach");
  });

  describe("a link to a panel", () => {
    /** Where the url says the page is, as `?widok=`. */
    const widok = () => useRouter().currentRoute.value.query.widok;
    const assignedGoals = () =>
      trackGoal.mock.calls.filter((call) => call[0] === "experiment:assigned");
    /** A click's `router.replace` settles after more than one tick. */
    const untilWidok = (value: string) =>
      vi.waitUntil(() => widok() === value, { timeout: 2000 });

    it("opens the panel ?widok= names, whatever the arm", async () => {
      const wrapper = await mount(null, "/?widok=stanowiska");

      expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
      expect(wrapper.text()).toContain("Zmiany na stanowiskach");
      // Nothing random chose the panel, so nobody is counted in an arm.
      expect(assignedGoals()).toHaveLength(0);
      expect(setGlobalProp).not.toHaveBeenCalled();
    });

    it("keeps the session out of the split when it comes back without one", async () => {
      seatIn("graph");
      (await mount(PEOPLE, "/?widok=oswiadczenia")).unmount();

      const wrapper = await mount(PEOPLE);

      // The control panel, not the chart its arm would have opened.
      expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);
      expect(assignedGoals()).toHaveLength(0);
    });

    it("keeps the arm of a session counted before the link", async () => {
      seatIn("oswiadczenia");
      (await mount(PEOPLE)).unmount();
      setGlobalProp.mockClear();

      const wrapper = await mount(PEOPLE, "/?widok=stanowiska");

      // The link still decides the panel; what the session does next still
      // counts for the arm it was put in.
      expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
      expect(setGlobalProp).toHaveBeenCalledWith(
        `arm:${HOME_DEFAULT_EXPERIMENT.id}`,
        "oswiadczenia",
      );
    });

    it("leaves an unknown ?widok= to the arm", async () => {
      seatIn("graph");
      const wrapper = await mount(null, "/?widok=wykres");

      expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
      expect(assignedGoals()).toHaveLength(1);
    });

    it("leaves the url alone when the arm opens a panel", async () => {
      // A copied home page address would otherwise take everybody it reaches
      // out of the split.
      seatIn("graph");
      const wrapper = await mount();

      expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
      expect(widok()).toBeUndefined();
    });

    it("names a clicked tab in the url", async () => {
      const wrapper = await mount(PEOPLE);

      await tabs(wrapper, "Stanowiska")[0]!.trigger("click");
      await untilWidok("stanowiska");

      await tabs(wrapper, "Oświadczenia")[1]!.trigger("click");
      await untilWidok("oswiadczenia");
    });

    it("names the open tab too when it is clicked", async () => {
      // A reader the arm put on a panel shares it by clicking its tab.
      const wrapper = await mount();
      expect(widok()).toBeUndefined();

      await tabs(wrapper, "Mapa")[0]!.trigger("click");
      await untilWidok("mapa");

      expect(underlined(wrapper)).toEqual(["Mapa", "Mapa"]);
    });

    it("follows a link to another panel from the same page", async () => {
      const wrapper = await mount();

      await useRouter().replace({ query: { widok: "stanowiska" } });
      await flushPromises();

      expect(underlined(wrapper)).toEqual(["Stanowiska", "Stanowiska"]);
    });
  });

  it("counts a switch to the chart, and back", async () => {
    const wrapper = await mount();

    await tabs(wrapper, "Stanowiska")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:tab", {
      tab: "graph",
    });
    expect(wrapper.text()).toContain("Zmiany na stanowiskach");

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
