import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import FeedbackScreenshots from "../../../app/components/feedback/Screenshots.vue";
import { fetchFeedbackScreenshot } from "~/composables/feedbackAdmin";
import type { FeedbackScreenshot } from "~~/shared/model";

vi.mock("~/composables/feedbackAdmin", () => ({
  fetchFeedbackScreenshot: vi.fn(),
}));

// Vuetify's overlay measures the viewport and observes resizes; neither exists
// in the test DOM.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const shot = (width: number, height: number): FeedbackScreenshot => ({
  contentType: "image/webp",
  width,
  height,
  bytes: 100,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("FeedbackScreenshots", () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    vi.spyOn(console, "error").mockImplementation(() => {});
    created = [];
    revoked = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/${created.length}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads each image through the admin route, and says which failed", async () => {
    vi.mocked(fetchFeedbackScreenshot).mockImplementation(async (_, index) => {
      if (index === 1) throw new Error("404");
      return new Blob(["x"], { type: "image/webp" });
    });

    const wrapper = await mountSuspended(FeedbackScreenshots, {
      props: {
        reportId: "fb-1",
        screenshots: [shot(1920, 1080), shot(390, 844)],
      },
    });
    await settle();

    expect(vi.mocked(fetchFeedbackScreenshot).mock.calls).toEqual([
      ["fb-1", 0],
      ["fb-1", 1],
    ]);
    const thumbs = wrapper.findAll("[data-report-screenshot]");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.find("img").attributes("src")).toBe("blob:test/0");
    // The second failed: no image, and nothing to open.
    expect(thumbs[1]!.find("img").exists()).toBe(false);
    expect(thumbs[1]!.attributes("disabled")).toBeDefined();
    // Room kept for each image in its own shape before it arrives.
    expect(thumbs[1]!.attributes("style")).toContain("aspect-ratio: 390 / 844");
  });

  it("opens an image whole on a click", async () => {
    vi.mocked(fetchFeedbackScreenshot).mockResolvedValue(
      new Blob(["x"], { type: "image/webp" }),
    );
    const wrapper = await mountSuspended(FeedbackScreenshots, {
      props: { reportId: "fb-1", screenshots: [shot(1920, 1080)] },
    });
    await settle();

    await wrapper.find("[data-report-screenshot]").trigger("click");
    await settle();

    const full = document.querySelector<HTMLImageElement>(
      ".v-overlay-container img",
    );
    expect(full?.getAttribute("src")).toBe("blob:test/0");
    wrapper.unmount();
  });

  it("lets go of the images when the row closes", async () => {
    vi.mocked(fetchFeedbackScreenshot).mockResolvedValue(
      new Blob(["x"], { type: "image/webp" }),
    );
    const wrapper = await mountSuspended(FeedbackScreenshots, {
      props: { reportId: "fb-1", screenshots: [shot(10, 10), shot(20, 20)] },
    });
    await settle();

    wrapper.unmount();

    expect(revoked.sort()).toEqual(created.sort());
    expect(created).toHaveLength(2);
  });
});
