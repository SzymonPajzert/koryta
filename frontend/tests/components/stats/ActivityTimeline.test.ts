import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent, h, nextTick } from "vue";
import ActivityTimeline from "../../../app/components/stats/ActivityTimeline.vue";

/** Thirty days ending Thursday 24 September 2026, something on each. */
const daily = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 26 + index));
  return {
    date: date.toISOString().slice(0, 10),
    counts: { vote: 3, revision: 2, noteSource: 1, publication: 0, reading: 0 },
    total: 6,
  };
});

/** Reports every observed element as `width` wide, once, as a browser does on
 * `observe`. happy-dom ships no ResizeObserver of its own. */
function chartDrawnAt(width: number) {
  globalThis.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Stands in for apexcharts, which measures a real element on mount; what the
 * component decides is all in the options it hands over. */
const Apexchart = defineComponent({
  name: "apexchart",
  props: { options: Object, series: Array, type: String, height: String },
  setup: () => () => h("div", { class: "apexchart-stub" }),
});

type Formatter = (value: string, raw: unknown, opts?: { i?: number }) => string;

async function labelsUnderColumns() {
  const wrapper = await mountSuspended(ActivityTimeline, {
    props: { daily },
    global: { stubs: { apexchart: Apexchart } },
  });
  await nextTick();
  const { xaxis, tooltip } = wrapper
    .findComponent(Apexchart)
    .props("options") as {
    xaxis: { categories: string[]; labels: { formatter?: Formatter } };
    tooltip: { x?: { formatter?: (value: string) => string } };
  };
  const format: Formatter = xaxis.labels.formatter ?? ((value) => value);
  return {
    shown: xaxis.categories
      .map((category, i) => format(category, category, { i }))
      .filter(Boolean),
    tooltipTitle: (value: string) =>
      (tooltip.x?.formatter ?? ((v: string) => format(v, v, {})))(value),
  };
}

describe("StatsActivityTimeline", () => {
  const realResizeObserver = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  /** Reported from a 375px phone: „Daty zlewają się na telefonie”. The axis
   * printed every other day, fifteen dates in about 230px, each wider than
   * the space it had. */
  it("labels a phone's month once a week, ending on today", async () => {
    chartDrawnAt(277);
    const { shown } = await labelsUnderColumns();

    expect(shown).toEqual(["27 sie", "3 wrz", "10 wrz", "17 wrz", "24 wrz"]);
  });

  it("keeps every other day on a desktop", async () => {
    chartDrawnAt(1100);
    const { shown } = await labelsUnderColumns();

    expect(shown).toHaveLength(15);
    expect(shown.at(-1)).toBe("24 wrz");
  });

  it("still names every day in the tooltip", async () => {
    chartDrawnAt(277);
    const { tooltipTitle } = await labelsUnderColumns();

    expect(tooltipTitle("13 wrz")).toBe("13 wrz");
  });

  describe("with readings", () => {
    const withReadings = daily.map((day, index) => ({
      ...day,
      counts: { ...day.counts, reading: index === 29 ? 1200 : 0 },
      total: day.total + (index === 29 ? 1200 : 0),
    }));

    type ChartOptions = {
      chart: { group?: string; id?: string };
      xaxis: { labels: { style?: { colors?: unknown } } };
      yaxis: { labels: { minWidth?: number } };
    };

    async function charts() {
      chartDrawnAt(1100);
      const wrapper = await mountSuspended(ActivityTimeline, {
        props: { daily: withReadings },
        global: { stubs: { apexchart: Apexchart } },
      });
      await nextTick();
      return {
        wrapper,
        drawn: wrapper.findAllComponents(Apexchart).map((chart) => ({
          options: chart.props("options") as ChartOptions,
          series: chart.props("series") as { name: string; data: number[] }[],
        })),
      };
    }

    it("stacks the four kinds of change and draws the readings apart under them", async () => {
      const { drawn } = await charts();

      expect(drawn).toHaveLength(2);
      expect(drawn[0]!.series.map((series) => series.name)).toEqual([
        "Ocena",
        "Propozycja zmiany",
        "Źródło lub zgłoszenie",
        "Opublikowane osoby",
      ]);
      expect(drawn[1]!.series.map((series) => series.name)).toEqual([
        "Odczyt oświadczenia",
      ]);
      expect(drawn[1]!.series[0]!.data.at(-1)).toBe(1200);
    });

    it("lines the two charts' days up", async () => {
      const { drawn } = await charts();
      const [stack, band] = drawn.map((chart) => chart.options);

      // One group shows the pointer's day in both.
      expect(stack!.chart.group).toBe(band!.chart.group);
      expect(stack!.chart.id).not.toBe(band!.chart.id);
      expect(stack!.yaxis.labels.minWidth).toBe(band!.yaxis.labels.minWidth);
      // The dates are laid out under both, so the columns are as wide, and
      // drawn under the readings alone.
      expect(stack!.xaxis.labels.style?.colors).toBe("transparent");
      expect(band!.xaxis.labels.style?.colors).not.toBe("transparent");
    });

    it("counts every action in the subtitle", async () => {
      const { wrapper } = await charts();

      expect(wrapper.text()).toContain("1380 działań w 30 dniach");
    });
  });
});
