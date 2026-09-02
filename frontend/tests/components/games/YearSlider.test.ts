import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import YearSlider from "../../../app/components/games/YearSlider.vue";

const vuetify = createVuetify({ components, directives });

function slider(props: Record<string, unknown> = {}) {
  return mount(YearSlider, {
    props: { modelValue: 2012, min: 2000, max: 2026, ...props },
    global: { plugins: [vuetify] },
  });
}

/** The steppers are the phone affordance: dragging 27 years across a 375px
 * screen cannot reliably land on one, and the scoring pays full marks only for
 * the exact year. These tests are about that, not about the slider. */
describe("YearSlider steppers", () => {
  it("moves one year at a time in each direction", async () => {
    const wrapper = slider();
    await wrapper.find('[data-testid="year-slider-up"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([2013]);

    // Back to where it started: the steppers move the year they are on, so
    // one tap each way is a round trip. A player correcting an overshoot has
    // to land exactly where they were.
    await wrapper.find('[data-testid="year-slider-down"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([2012]);
  });

  it("stops at the ends of the axis rather than running past them", async () => {
    const atTop = slider({ modelValue: 2026 });
    expect(
      atTop.find('[data-testid="year-slider-up"]').attributes("disabled"),
    ).toBeDefined();

    const atBottom = slider({ modelValue: 2000 });
    expect(
      atBottom.find('[data-testid="year-slider-down"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("does nothing once the round is answered", async () => {
    const wrapper = slider({ disabled: true });
    await wrapper.find('[data-testid="year-slider-up"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("shows the year it is on", () => {
    const wrapper = slider({ modelValue: 2017 });
    expect(wrapper.find('[data-testid="year-slider-value"]').text()).toBe(
      "2017",
    );
  });
});

describe("YearSlider marks", () => {
  it("places a mark by its share of the axis", () => {
    const wrapper = slider({
      marks: [{ key: "a", year: 2013 }],
    });
    const pin = wrapper.find(".marks__pin");
    expect(pin.attributes("style")).toContain("50%");
  });

  it("pins a mark outside the axis to the edge rather than off it", () => {
    const wrapper = slider({ marks: [{ key: "a", year: 1990 }] });
    expect(wrapper.find(".marks__pin").attributes("style")).toContain("0%");
  });

  it("draws a missed round differently from a landed one", () => {
    const wrapper = slider({
      marks: [
        { key: "a", year: 2010, missed: true },
        { key: "b", year: 2020 },
      ],
    });
    expect(wrapper.findAll(".marks__pin--miss")).toHaveLength(1);
  });
});
