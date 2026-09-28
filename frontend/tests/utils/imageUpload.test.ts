// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cropFor, fitImage } from "../../app/utils/imageUpload";
import { fitsImageLimits, type ImagePurpose } from "../../shared/images";

describe("fitImage", () => {
  it("leaves an ordinary screenshot at its own size", () => {
    expect(fitImage(1920, 1080, "feedback")).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(fitImage(3840, 2160, "feedback")).toEqual({
      width: 3840,
      height: 2160,
    });
  });

  it("scales a phone photo down to the pixel budget, keeping its shape", () => {
    const { width, height } = fitImage(4032, 3024, "feedback");
    expect(width * height).toBeLessThanOrEqual(4096 * 2048);
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  // A capture of a whole page is narrow and very tall; scaled to the pixel
  // budget alone it could still be longer than an image may be.
  it("keeps the longest side of a full-page capture within bounds", () => {
    const { width, height } = fitImage(1200, 12000, "feedback");
    expect(height).toBeLessThanOrEqual(8000);
    expect(width / height).toBeCloseTo(0.1, 2);
  });

  it("shrinks again for a retry, and never to nothing", () => {
    expect(fitImage(1000, 500, "feedback", 0.5)).toEqual({
      width: 500,
      height: 250,
    });
    expect(fitImage(3, 1, "feedback", 0.3)).toEqual({ width: 1, height: 1 });
  });

  it("draws an avatar at 512 px at most, and square", () => {
    expect(fitImage(3024, 3024, "avatar")).toEqual({ width: 512, height: 512 });
    expect(fitImage(200, 200, "avatar")).toEqual({ width: 200, height: 200 });
    expect(fitImage(3024, 3024, "avatar", 0.8)).toEqual({
      width: 409,
      height: 409,
    });
  });

  it("draws a portrait at 1600 px a side at most", () => {
    const { width, height } = fitImage(3024, 4032, "person");
    expect(height).toBe(1600);
    expect(width / height).toBeCloseTo(3024 / 4032, 2);
  });

  // Whatever the browser draws, the server has to take.
  it.each([
    [1920, 1080],
    [5120, 2880],
    [4032, 3024],
    [1170, 2532],
    [1440, 30000],
    [30000, 200],
    [8191, 8191],
    [1, 1],
  ])("fits %ix%i within what the server accepts, for every use", (w, h) => {
    for (const purpose of ["feedback", "avatar", "person"] as ImagePurpose[]) {
      const crop = cropFor(w, h, purpose);
      expect(
        fitsImageLimits(fitImage(crop.width, crop.height, purpose), purpose),
      ).toBe(true);
    }
  });
});

describe("cropFor", () => {
  it("keeps all of a screenshot and a portrait", () => {
    expect(cropFor(1600, 900, "feedback")).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    });
    expect(cropFor(900, 1600, "person")).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 1600,
    });
  });

  it("takes the middle square of a photo for an avatar", () => {
    expect(cropFor(4032, 3024, "avatar")).toEqual({
      x: 504,
      y: 0,
      width: 3024,
      height: 3024,
    });
    expect(cropFor(1170, 2532, "avatar")).toEqual({
      x: 0,
      y: 681,
      width: 1170,
      height: 1170,
    });
  });
});
