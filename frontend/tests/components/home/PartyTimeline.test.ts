import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import PartyTimeline from "../../../app/components/home/PartyTimeline.vue";
import type { PartyTimelineResponse } from "../../../server/api/stats/partyTimeline.get";

/** What the endpoint answers with. Replaced per test. */
let response: PartyTimelineResponse;

registerEndpoint(
  "/api/stats/partyTimeline",
  (): PartyTimelineResponse => response,
);

/** `months` counted forward from a start, so a case can say "twelve years of
 * data" without writing 144 strings out. */
function months(from: string, count: number): string[] {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + month - 1 + i;
    return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(
      (index % 12) + 1,
    ).padStart(2, "0")}`;
  });
}

function timeline(
  over: Partial<PartyTimelineResponse> = {},
): PartyTimelineResponse {
  const axis = over.months ?? months("2024-01", 24);
  return {
    series: [
      { party: "PO", counts: axis.map((_, i) => 100 + i) },
      { party: "PiS", counts: axis.map((_, i) => 90 - i) },
    ],
    today: axis[axis.length - 1] ?? "",
    posts: 3009,
    people: 880,
    ...over,
    months: axis,
  };
}

/** Mounts and waits for the first response.
 *
 * The component does not await its own fetch - Nuxt settles `useAsyncData`
 * before it serialises a server rendered page - so `mountSuspended` returns
 * with the card not yet drawn, exactly as `HomeEventFeed`'s suite describes.
 *
 * `apexchart` is stubbed out: it measures a real element on mount and jsdom
 * gives it none, so the live component throws „Element not found” and takes the
 * card down with it. Everything asserted below - the heading, the range control
 * and the table view of the same numbers - is the part the component owns
 * anyway; the drawing is apexcharts'.
 */
async function mountTimeline() {
  const wrapper = await mountSuspended(PartyTimeline, {
    global: { stubs: { apexchart: true } },
  });
  await vi.waitUntil(
    () => wrapper.find('[data-testid="party-timeline"]').exists(),
    { timeout: 2000 },
  );
  return wrapper;
}

/** Switches the card to its table view, which is where the numbers are.
 *
 * The chart is the default and the table is the relief the party palette
 * obliges - PO's orange against Polska 2050's yellow is ΔE 10.9 to a reader
 * with full colour vision - so it is also the only place a test can read a
 * count without going through apexcharts.
 */
async function showTable(wrapper: Awaited<ReturnType<typeof mountTimeline>>) {
  await wrapper.find('button[aria-label="Tabela z liczbami"]').trigger("click");
  await flushPromises();
}

describe("HomePartyTimeline", () => {
  beforeEach(() => {
    clearNuxtData();
    response = timeline();
  });

  it("draws nothing at all when the endpoint knows no party", async () => {
    // Not an empty chart and not an alert: on a fresh local stack this section
    // has nothing to say, and a card saying so on the home page is worse than
    // no card.
    response = timeline({ months: [], series: [] });

    const wrapper = await mountSuspended(PartyTimeline, {
      global: { stubs: { apexchart: true } },
    });
    await flushPromises();

    expect(wrapper.text()).toBe("");
  });

  it("names the party and its numbers in the table", async () => {
    const wrapper = await mountTimeline();
    expect(wrapper.text()).toContain("Kto trzyma stanowiska");

    await showTable(wrapper);

    expect(wrapper.text()).toContain("PO");
    expect(wrapper.text()).toContain("PiS");
  });

  it("says how much the picture is built from", async () => {
    const wrapper = await mountTimeline();

    // Thousands separated the Polish way, which is a space rather than a comma.
    expect(wrapper.text()).toContain("880");
    expect(wrapper.text()).toContain("009");
  });

  it("labels a merged party by both of its names", async () => {
    response = timeline({
      series: [
        { party: "Nowa Lewica", counts: months("2024-01", 24).map(() => 3) },
      ],
    });

    const wrapper = await mountTimeline();
    await showTable(wrapper);

    expect(wrapper.text()).toContain("Nowa Lewica / SLD");
  });

  it("offers the three ranges", async () => {
    const wrapper = await mountTimeline();

    const toggle = wrapper.find('[data-testid="party-timeline-range"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain("5 lat");
    expect(toggle.text()).toContain("10 lat");
    expect(toggle.text()).toContain("Wszystko");
  });

  it("keeps a series shorter than the picked range whole", async () => {
    // Two years of data under a ten year default: the window must not run off
    // the front of the array and pad the chart with undefined.
    const wrapper = await mountTimeline();

    expect(wrapper.html()).not.toContain("undefined");
  });
});
