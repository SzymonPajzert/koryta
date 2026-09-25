import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent, h, nextTick } from "vue";
import PublicationCandidates from "../../../app/components/stats/PublicationCandidates.vue";
import type { PublicationBucket } from "../../../server/utils/databaseStats";

/** Production's buckets on 2026-09-25: published people are a sliver of each. */
const buckets: PublicationBucket[] = [
  { floor: 1, open: false, pending: 2834, approved: 9 },
  { floor: 2, open: false, pending: 1534, approved: 25 },
  { floor: 3, open: false, pending: 2011, approved: 89 },
  { floor: 4, open: false, pending: 880, approved: 57 },
  { floor: 5, open: true, pending: 307, approved: 67 },
];

/** Stands in for apexcharts, which measures a real element on mount; the
 * geometry is all in the options the component hands over. */
const Apexchart = defineComponent({
  name: "apexchart",
  props: { options: Object, series: Array, type: String, height: String },
  setup: () => () => h("div", { class: "apexchart-stub" }),
});

type ChartOptions = {
  stroke: { width: number };
  plotOptions: { bar: { columnWidth: string } };
};

async function chartOptions() {
  const wrapper = await mountSuspended(PublicationCandidates, {
    props: { buckets },
    global: { stubs: { apexchart: Apexchart } },
  });
  await nextTick();
  return wrapper.findComponent(Apexchart).props("options") as ChartOptions;
}

describe("StatsPublicationCandidates", () => {
  /** „Zielony bar nie jest widoczny, ponieważ spacing od niebieskiego go prawie
   * całkowicie zasłania”. apexcharts insets a segment by half its stroke and
   * paints the stroke inside it, so a stroke `s` wide takes `s` off both ends
   * of every segment: the gap between blue and green is 2s, and a green
   * segment shorter than 2s is not drawn at all. At the shared 2px that was a
   * 4px gap and 4px of every green segment gone - most of them. */
  it("separates the published segment by the method's 2px and no more", async () => {
    const { stroke } = await chartOptions();

    expect(2 * stroke.width).toBe(2);
  });

  /** „ma problem z kolumnami tak samo jak aktywność”: at 62% of the slot,
   * five buckets on a half-width card were ~58px columns with ~35px of white
   * between them. */
  it("fills most of each bucket's slot with its column", async () => {
    const { plotOptions } = await chartOptions();

    expect(parseFloat(plotOptions.bar.columnWidth)).toBeGreaterThanOrEqual(85);
  });
});
