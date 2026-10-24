import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import SegmentedToggle from "../../app/components/SegmentedToggle.vue";

// Plain mount rather than `mountSuspended`: the toggle touches no Nuxt
// composable, so there is nothing here that needs an app around it.
const vuetify = createVuetify({ components, directives });

/** A page's use of it: two or three `v-btn`s with a `value` each, and the
 * chosen one bound with `v-model`. */
const Host = defineComponent({
  components: { SegmentedToggle },
  setup() {
    const days = ref<number>(30);
    return { days };
  },
  template: `
    <SegmentedToggle v-model="days" data-testid="toggle">
      <v-btn :value="7" data-testid="days-7">7 dni</v-btn>
      <v-btn :value="30" data-testid="days-30">30 dni</v-btn>
      <v-btn :value="90" data-testid="days-90">90 dni</v-btn>
    </SegmentedToggle>
  `,
});

const mountHost = () =>
  mount(Host, { global: { plugins: [vuetify] }, attachTo: document.body });

type Wrapper = ReturnType<typeof mountHost>;
const option = (wrapper: Wrapper, days: number) =>
  wrapper.get(`[data-testid="days-${days}"]`);

/** One segmented control for every neutral two- or three-way toggle on the
 * site: the chosen option a white tab on the tinted track
 * (`k-segmented`, assets/css/edges.css). */
describe("SegmentedToggle", () => {
  it("is Vuetify's button group, drawn as the segmented control", () => {
    const wrapper = mountHost();
    const group = wrapper.get(".v-btn-toggle");

    expect(group.classes()).toContain("k-segmented");
    // 40px high, so inside the track's 2px inset each tab keeps a button's 36.
    expect(group.classes()).toContain("v-btn-group--density-comfortable");
    // Text buttons, not Vuetify's outlined toggle undone in CSS.
    for (const days of [7, 30, 90]) {
      expect(option(wrapper, days).classes()).toContain("v-btn--variant-text");
    }
    // What the caller passes lands on the group.
    expect(group.attributes("data-testid")).toBe("toggle");
    wrapper.unmount();
  });

  it("marks the option the model holds as chosen", () => {
    const wrapper = mountHost();

    expect(option(wrapper, 30).classes()).toContain("v-btn--active");
    expect(option(wrapper, 7).classes()).not.toContain("v-btn--active");
    expect(option(wrapper, 90).classes()).not.toContain("v-btn--active");
    wrapper.unmount();
  });

  it("hands the pressed option's value back through v-model", async () => {
    const wrapper = mountHost();

    await option(wrapper, 90).trigger("click");

    expect(wrapper.vm.days).toBe(90);
    expect(option(wrapper, 90).classes()).toContain("v-btn--active");
    expect(option(wrapper, 30).classes()).not.toContain("v-btn--active");
    wrapper.unmount();
  });

  it("always has one option chosen: pressing the chosen one keeps it", async () => {
    // A view of one thing is always some view - an empty choice would leave
    // the page showing nothing.
    const wrapper = mountHost();

    await option(wrapper, 30).trigger("click");

    expect(wrapper.vm.days).toBe(30);
    expect(option(wrapper, 30).classes()).toContain("v-btn--active");
    wrapper.unmount();
  });
});
