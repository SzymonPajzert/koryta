import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { getHeader, getQuery } from "h3";
import { computed, defineComponent, h, ref } from "vue";
import { clearNuxtData } from "#app";
import Timeline from "../../../app/components/home/Timeline.vue";
import { OTHER_KEY } from "../../../shared/homeTimeline";
import type {
  HomeTimelineResponse,
  TimelineGrouping,
} from "../../../server/api/stats/homeTimeline.get";

/** Who is signed in: null for nobody, as `tests/setup.ts` has it. */
const { authUser } = vi.hoisted(() => ({
  authUser: { value: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("vuefire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuefire")>();
  return {
    ...actual,
    useFirestore: vi.fn(() => ({})),
    useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
    useCurrentUser: vi.fn(() => computed(() => authUser.value)),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
  };
});

/** What the endpoint answers with. Replaced per test. */
let response: HomeTimelineResponse;

/** What each request for it carried. */
let asked: { latest: unknown; token: boolean }[] = [];

registerEndpoint("/api/stats/homeTimeline", (event): HomeTimelineResponse => {
  asked.push({
    latest: getQuery(event).latest,
    token: !!getHeader(event, "authorization"),
  });
  return response;
});

/** `months` counted forward from a start, so a case can say "two years of
 * data" without writing 24 strings out. */
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
  over: Partial<HomeTimelineResponse> = {},
): HomeTimelineResponse {
  const axis = over.months ?? months("2024-01", 24);
  const line = (key: string, label: string, base: number) => ({
    key,
    label,
    counts: axis.map((_, i) => base + i),
  });
  return {
    groupings: {
      party: [line("PO", "PO", 100), line("PiS", "PiS", 40)],
      region: [
        line("14", "Województwo mazowieckie", 80),
        line("24", "Województwo śląskie", 30),
        {
          key: OTHER_KEY,
          label: "Pozostałe województwa",
          counts: axis.map(() => 7),
        },
      ],
      category: [line("szpitale", "Szpitale", 20)],
    },
    coverage: {
      party: { posts: 3009, people: 880 },
      region: { posts: 3088, people: 900 },
      category: { posts: 1315, people: 500 },
    },
    posts: 3103,
    today: axis[axis.length - 1] ?? "",
    ...over,
    months: axis,
  };
}

/** Mounts and waits for the first response.
 *
 * `apexchart` is stubbed out: it measures a real element on mount and jsdom
 * gives it none, so the live component throws „Element not found” and takes the
 * card down with it. Everything asserted below - the heading, the subtitle and
 * the table view of the same numbers - is the part the component owns anyway;
 * the drawing is apexcharts'.
 */
async function mountTimeline(
  grouping: TimelineGrouping = "party",
  range: "5" | "10" | "all" = "all",
) {
  const wrapper = await mountSuspended(Timeline, {
    props: { grouping, range },
    global: { stubs: { apexchart: true } },
  });
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="home-timeline"]').exists() ||
      wrapper.find('[data-testid="home-timeline-empty"]').exists(),
    { timeout: 2000 },
  );
  return wrapper;
}

/** Switches the card to its table view, which is where the numbers are.
 *
 * The chart is the default and the table is the relief the party palette
 * obliges - PO's orange against Polska 2050's yellow is ΔE 10.9 to a reader
 * with full colour vision - so it is also the only place a test can read a
 * count without going through apexcharts. */
async function showTable(wrapper: Awaited<ReturnType<typeof mountTimeline>>) {
  await wrapper.find('button[aria-label="Tabela z liczbami"]').trigger("click");
  await flushPromises();
}

describe("HomeTimeline", () => {
  beforeEach(() => {
    clearNuxtData();
    response = timeline();
    asked = [];
  });

  it("asks for what everybody gets, signed in too", async () => {
    // The chart counts published posts only. Asked with `latest=true` and a
    // token, a signed-in reader skipped the six-hour cache and Cloud CDN, and
    // on an instance just started waited for the whole count.
    authUser.value = { getIdToken: async () => "token" };
    try {
      await mountTimeline();
      expect(asked).toEqual([{ latest: undefined, token: false }]);
    } finally {
      authUser.value = null;
    }
  });

  it("says so rather than drawing an empty chart when a grouping has no lines", async () => {
    response = timeline({
      groupings: { party: [], region: [], category: [] },
    });

    const wrapper = await mountTimeline();

    expect(wrapper.find('[data-testid="home-timeline-empty"]').exists()).toBe(
      true,
    );
  });

  it("draws the grouping it is asked for and no other", async () => {
    const wrapper = await mountTimeline("region");
    await showTable(wrapper);

    expect(wrapper.text()).toContain("Województwo mazowieckie");
    expect(wrapper.text()).not.toContain("PiS");
  });

  it("switches grouping without refetching", async () => {
    const wrapper = await mountTimeline("party");
    await showTable(wrapper);
    expect(wrapper.text()).toContain("PO");

    // The whole reason all three arrive in one response: the picker is a
    // client-side cut of data already in hand.
    await wrapper.setProps({ grouping: "category" });
    await flushPromises();

    expect(wrapper.text()).toContain("Szpitale");
    expect(wrapper.text()).not.toContain("PO");
  });

  it("names the folded remainder in the table like any other line", async () => {
    const wrapper = await mountTimeline("region");
    await showTable(wrapper);

    expect(wrapper.text()).toContain("Pozostałe województwa");
  });

  it("states a plain count when a grouping places every post", async () => {
    response = timeline({
      coverage: {
        party: { posts: 3103, people: 880 },
        region: { posts: 3088, people: 900 },
        category: { posts: 1315, people: 500 },
      },
    });

    const wrapper = await mountTimeline("party");

    expect(wrapper.text()).toContain("880");
    // No "x z y": there is nothing the grouping could not place.
    expect(wrapper.text()).not.toMatch(/z 3\u00a0?103 stanowisk/);
  });

  it("admits it when a grouping cannot place every post", async () => {
    // 1,315 of 3,103 carry a sector. A reader comparing „Branże” with „Partie”
    // and finding half the people gone is owed the ratio on the chart itself.
    const wrapper = await mountTimeline("category");

    expect(wrapper.text()).toMatch(/1\u00a0?315 z 3\u00a0?103 stanowisk/);
  });

  it("lists the tooltip's rows in the order of the lines at the hovered month", async () => {
    // As under „Województwa” on production: the folded remainder comes last
    // in the series and is the highest line.
    response = timeline();
    response.groupings.region[2]!.counts = response.months.map(() => 500);

    /** Stands in for apexcharts, to read what the component hands it. */
    const Apexchart = defineComponent({
      name: "apexchart",
      props: { options: Object, series: Array, type: String, height: String },
      setup: () => () => h("div"),
    });
    // Opened on „Partie” and switched, as a reader does it. The tooltip is the
    // one the chart was first given: vue3-apexcharts drops functions from
    // every later options update, so apexcharts keeps calling that one.
    const wrapper = await mountSuspended(Timeline, {
      props: { grouping: "party", range: "all" },
      global: { stubs: { apexchart: Apexchart } },
    });
    await vi.waitUntil(() => wrapper.findComponent(Apexchart).exists(), {
      timeout: 2000,
    });
    const chart = wrapper.findComponent(Apexchart);
    const { tooltip } = chart.props("options") as {
      tooltip: {
        custom: (point: {
          series: number[][];
          dataPointIndex: number;
        }) => string;
      };
    };
    await wrapper.setProps({ grouping: "region" });
    await flushPromises();
    const series = (chart.props("series") as { data: { y: number }[] }[]).map(
      (line) => line.data.map((point) => point.y),
    );

    const box = document.createElement("div");
    box.innerHTML = tooltip.custom({
      series,
      dataPointIndex: series[0]!.length - 1,
    });

    expect(box.querySelector(".apexcharts-tooltip-title")?.textContent).toBe(
      "Grudzień 2025",
    );
    expect(
      [...box.querySelectorAll(".apexcharts-tooltip-text-y-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual([
      "Pozostałe województwa: ",
      "Województwo mazowieckie: ",
      "Województwo śląskie: ",
    ]);
  });

  it("keeps a series shorter than the picked range whole", async () => {
    // Two years of data under a five year range: the window must not run off
    // the front of the array and pad the chart with undefined.
    const wrapper = await mountTimeline("party", "5");

    expect(wrapper.html()).not.toContain("undefined");
  });
});
