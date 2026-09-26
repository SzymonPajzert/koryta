import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent, h, ref } from "vue";
import ExpandRow from "../../../app/components/admin/ExpandRow.vue";

/** A row with every slot filled, and its open state held by the caller the
 * way the pages hold it (so a `#fb-<id>` link can open a row). */
const Harness = defineComponent({
  props: { initiallyOpen: { type: Boolean, default: false } },
  setup(props) {
    const open = ref(props.initiallyOpen);
    return () =>
      h(
        ExpandRow,
        {
          rowId: "fb-abc",
          tone: "danger",
          expanded: open.value,
          "onUpdate:expanded": (value: boolean) => (open.value = value),
        },
        {
          summary: () => h("span", { class: "arow-grow" }, "Jedna linia"),
          actions: () => h("button", { "data-action": "" }, "Do kolejki"),
          meta: () => h("span", { "data-meta": "" }, "Autor"),
          default: () => h("textarea", { "aria-label": "Notatka" }),
          footer: () => h("button", { "data-footer": "" }, "Zatwierdź"),
        },
      );
  },
});

describe("AdminExpandRow", () => {
  it("keeps the open part out of the DOM until the line is clicked", async () => {
    const wrapper = await mountSuspended(Harness);
    const toggle = wrapper.get("[data-row-toggle]");

    expect(wrapper.get("#fb-abc").classes()).toContain("arow--tone-danger");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).toContain("Jedna linia");
    expect(wrapper.find("[data-action]").exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find("[data-meta]").exists()).toBe(false);

    await toggle.trigger("click");

    expect(toggle.attributes("aria-expanded")).toBe("true");
    const panel = wrapper.get("[data-row-panel]");
    expect(toggle.attributes("aria-controls")).toBe(panel.attributes("id"));
    expect(panel.find("textarea").exists()).toBe(true);
    expect(panel.find("[data-meta]").exists()).toBe(true);
    expect(panel.find("[data-footer]").exists()).toBe(true);
    expect(wrapper.get("#fb-abc").classes()).toContain("arow--open");
  });

  it("puts the actions beside the toggle, not inside it", async () => {
    const wrapper = await mountSuspended(Harness);
    // A button inside a button is invalid, and a click on "Do kolejki" must
    // not open the row.
    expect(
      wrapper.get("[data-row-toggle]").find("[data-action]").exists(),
    ).toBe(false);
    await wrapper.get("[data-action]").trigger("click");
    expect(wrapper.find("[data-row-panel]").exists()).toBe(false);
  });

  it("opens when the caller opens it", async () => {
    const wrapper = await mountSuspended(Harness, {
      props: { initiallyOpen: true },
    });
    expect(wrapper.find("[data-row-panel]").exists()).toBe(true);
  });
});
