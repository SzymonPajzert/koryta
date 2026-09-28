// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fitScreenshot } from "../../app/utils/screenshotImage";
import { fitsFeedbackScreenshotLimits } from "../../shared/feedbackScreenshots";

describe("fitScreenshot", () => {
  it("leaves an ordinary screenshot at its own size", () => {
    expect(fitScreenshot(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitScreenshot(3840, 2160)).toEqual({ width: 3840, height: 2160 });
  });

  it("scales a phone photo down to the pixel budget, keeping its shape", () => {
    const { width, height } = fitScreenshot(4032, 3024);
    expect(width * height).toBeLessThanOrEqual(4096 * 2048);
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  // A capture of a whole page is narrow and very tall; scaled to the pixel
  // budget alone it could still be longer than an image may be.
  it("keeps the longest side of a full-page capture within bounds", () => {
    const { width, height } = fitScreenshot(1200, 12000);
    expect(height).toBeLessThanOrEqual(8000);
    expect(width / height).toBeCloseTo(0.1, 2);
  });

  it("shrinks again for a retry, and never to nothing", () => {
    expect(fitScreenshot(1000, 500, 0.5)).toEqual({ width: 500, height: 250 });
    expect(fitScreenshot(3, 1, 0.3)).toEqual({ width: 1, height: 1 });
  });

  // Whatever the dialog draws, the server has to take.
  it.each([
    [1920, 1080],
    [5120, 2880],
    [4032, 3024],
    [1170, 2532],
    [1440, 30000],
    [30000, 200],
    [8191, 8191],
  ])("fits %ix%i within what the server accepts", (width, height) => {
    expect(fitsFeedbackScreenshotLimits(fitScreenshot(width, height))).toBe(
      true,
    );
  });
});
