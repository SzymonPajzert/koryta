import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createSSRApp, defineComponent, h, nextTick } from "vue";
import { renderToString } from "vue/server-renderer";
import { useCanHover } from "~/composables/canHover";

/** Answers `(hover: hover)` as a pointer that can (a mouse) or cannot (a
 * phone's finger) would, and every other query as not matching. */
function pointer(canHover: boolean) {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(hover: hover)" && canHover,
        media: query,
      }) as MediaQueryList,
  );
}

/** Prints what the composable answers, so a render can be read. */
const Probe = defineComponent({
  setup() {
    const canHover = useCanHover();
    return () => h("span", String(canHover.value));
  },
});

/** On a tooltip that opens on hover and on click, a phone's tap sent an
 * emulated hover that opened it and a click that shut it again half a second
 * later - every (i) on the site did that. */
describe("useCanHover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says so where the pointer can hover", async () => {
    pointer(true);
    const wrapper = mount(Probe);
    await nextTick();
    expect(wrapper.text()).toBe("true");
  });

  it("says no where nothing hovers, once mounted", async () => {
    const media = pointer(false);
    const wrapper = mount(Probe);
    await nextTick();
    expect(wrapper.text()).toBe("false");
    expect(media).toHaveBeenCalledWith("(hover: hover)");
  });

  it("answers yes on the server, so its render and the browser's first agree", async () => {
    // Read after mounting: the server cannot know the pointer, and a first
    // render in the browser that disagreed with it would be a hydration
    // mismatch on every tooltip.
    const media = pointer(false);
    const html = await renderToString(createSSRApp(Probe));
    expect(html).toBe("<span>true</span>");
    expect(media).not.toHaveBeenCalled();
  });
});
