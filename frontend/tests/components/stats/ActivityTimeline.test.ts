import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent, h, nextTick } from "vue";
import ActivityTimeline from "../../../app/components/stats/ActivityTimeline.vue";

/** Thirty days ending Thursday 24 September 2026, something on each. */
const daily = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 26 + index));
  return {
    date: date.toISOString().slice(0, 10),
    counts: { vote: 3, revision: 2, noteSource: 1, publication: 0 },
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
});
