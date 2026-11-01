import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Answered from "../../../app/components/oswiadczenia/Answered.vue";
import type { AnsweredCrop } from "../../../app/composables/declarationQueue";

const crop = (over: Partial<AnsweredCrop> = {}): AnsweredCrop => ({
  id: "crop-1",
  verdict: "date",
  value: "1979-07-15",
  settled: true,
  ...over,
});

const mount = (over: Partial<AnsweredCrop> = {}) =>
  mountSuspended(Answered, { props: { crop: crop(over) } });

/** The line under the next crop about the one just answered. Its declaration
 * is linked on its own card, not here: a link under the next crop read as
 * that crop's. */
describe("OswiadczeniaAnswered", () => {
  it("says what was saved and when the crop has its readings, and links nothing", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Zapisane: 15 lipca 1979");
    expect(wrapper.text()).toContain("ten wycinek ma już komplet odczytów");
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Zobacz całe oświadczenie");
  });

  it("says a skip was a skip, and nothing was saved", async () => {
    const wrapper = await mount({
      verdict: "skip",
      value: null,
      settled: false,
    });

    expect(wrapper.text()).toContain("Pominięte");
    expect(wrapper.text()).not.toContain("Zapisane");
  });

  it("claims no full set of readings for a crop that is still open", async () => {
    const wrapper = await mount({ settled: false });

    expect(wrapper.text()).toContain("Zapisane: 15 lipca 1979");
    expect(wrapper.text()).not.toContain("komplet odczytów");
  });
});
