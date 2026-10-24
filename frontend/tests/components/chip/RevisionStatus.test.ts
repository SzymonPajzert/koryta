import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import { VTooltip } from "vuetify/components";
import RevisionStatus from "../../../app/components/chip/RevisionStatus.vue";

/** Answers `(hover: hover)` as a mouse (true) or a phone's finger (false)
 * would. */
function pointer(canHover: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(hover: hover)" && canHover,
        media: query,
      }) as MediaQueryList,
  );
}

async function mountStatus() {
  const wrapper = await mountSuspended(RevisionStatus, {
    props: { status: "pending", derived: true },
  });
  await nextTick();
  return wrapper;
}

/** Where a proposal stands - on a company's and a person's page above the
 * history, once the reader has proposed something there, and on their own
 * profile. */
describe("ChipRevisionStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says where the proposal stands, and that a derived status was read off the entry", async () => {
    const wrapper = await mountStatus();

    expect(wrapper.get("[data-testid='revision-status']").text()).toBe(
      "Oczekuje",
    );
    expect(wrapper.get("[data-testid='revision-status-derived']").text()).toBe(
      "odczytany",
    );
  });

  // A phone's tap sends an emulated hover and then a click: on a tooltip open
  // on both, the hover opened it and the click shut it again.
  it("opens its tooltips on a tap alone where nothing hovers", async () => {
    pointer(false);
    const wrapper = await mountStatus();

    const tooltips = wrapper.findAllComponents(VTooltip);
    expect(tooltips).toHaveLength(2);
    for (const tooltip of tooltips) {
      expect(tooltip.props("openOnHover")).toBe(false);
      expect(tooltip.props("openOnClick")).toBe(true);
    }
  });

  it("opens them on hover too where the pointer can", async () => {
    pointer(true);
    const wrapper = await mountStatus();

    for (const tooltip of wrapper.findAllComponents(VTooltip)) {
      expect(tooltip.props("openOnHover")).toBe(true);
    }
  });
});
